import { generateStructuredJson } from "@/lib/aiJson";
import { inferMetadataFromUploadedText } from "@/lib/aiMetadata";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { ATS_MIN_SAFE_EMAIL_SCORE, matchCvAgainstAts } from "@/lib/atsMatcher";
import { generateEmail } from "@/lib/azureOpenAi";
import { inferSuggestedRolesFromSkillsAndCertifications } from "@/lib/candidateProfile";
import { DEFAULT_OUTLOOK_MAILBOX } from "@/lib/constants";
import {
    buildFactualityRegenerationInstruction,
    checkEmailFactuality,
} from "@/lib/emailFactualityGuard";
import { createOutlookDraftForMailbox } from "@/lib/graph";
import {
    isRemoteRole,
    requiresNonSaLocationRestriction,
    requiresUsWorkAuthorisation,
} from "@/lib/jobClassification";
import {
    getAiGatewayEnvHint,
    isAiGatewayConfigured,
    requireAiGatewayConfig,
    resolveAiGatewayModel,
} from "@/lib/liteLlm";
import { computeOpportunityId } from "@/lib/opportunity";
import {
    buildRedactedCvPdfFromText,
    redactContactDetailsInPdf,
} from "@/lib/pdfRedaction";
import { prisma } from "@/lib/prisma";
import {
    EMAIL_SYSTEM_PROMPT,
    EMAIL_USER_PROMPT,
    resolvePreferredWordRange,
    type CompanyType,
} from "@/lib/prompts";
import { guardCandidateForOpportunity } from "@/lib/roleMatchGuard";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";
import { emailGenerateSchema } from "@/lib/validation";
import { DEFAULT_VOSS_TOGGLES, type VossToggles } from "@/lib/voss";
import crypto from "crypto";

export const runtime = "nodejs";
const EMAIL_GENERATION_DISABLED =
  (process.env.EMAIL_GENERATION_DISABLED ?? "false").toLowerCase() === "true";
// ATS safety gate is ON by default. Set ENFORCE_ATS_EMAIL_SAFETY_GATE=false in env only to
// temporarily bypass for admin tooling that has already verified the match independently.
const ENFORCE_ATS_EMAIL_SAFETY_GATE =
  (process.env.ENFORCE_ATS_EMAIL_SAFETY_GATE ?? "true").toLowerCase() ===
  "true";
// Role match guard is ON by default. Set BYPASS_ROLE_MATCH_GUARD=true in env only to
// temporarily bypass for bulk admin generation where matches have been pre-verified.
const BYPASS_ROLE_MATCH_GUARD =
  (process.env.BYPASS_ROLE_MATCH_GUARD ?? "false").toLowerCase() === "true";

type OutlookDraftResult = {
  status: "created" | "skipped" | "failed";
  mailbox?: string;
  reason?: string;
};

type ParsedRecipients = {
  valid: string[];
  invalid: string[];
};

function safeAttachmentName(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "candidate";
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const rawItem of items) {
    const item = rawItem.trim();
    if (!item) continue;

    const key = item.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(item);
  }

  return output;
}

function parseDraftRecipients(
  rawRecipients: string | null | undefined,
): ParsedRecipients {
  if (!rawRecipients) {
    return { valid: [], invalid: [] };
  }

  const uniqueValues = Array.from(
    new Set(
      rawRecipients
        .split(/[;,]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  const valid = uniqueValues.filter((item) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item),
  );
  const invalid = uniqueValues.filter(
    (item) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item),
  );

  return { valid, invalid };
}

async function createAutomaticOutlookDraft(params: {
  tenantId: string;
  companyId?: string | null;
  subject: string;
  htmlBody: string;
  recipients: ParsedRecipients;
  candidateName: string;
  candidateCvText: string;
  candidateEmail?: string | null;
  candidatePhone?: string | null;
  candidateCvFileName?: string | null;
  candidateCvMimeType?: string | null;
  candidateCvFileData?: Uint8Array | Buffer | null;
  /** Pre-formatted ATS PDF — used as the attachment when available. */
  candidateFormattedCvPdfData?: Uint8Array | Buffer | null;
  candidateFormattedCvFileName?: string | null;
}): Promise<OutlookDraftResult> {
  if (params.recipients.valid.length === 0) {
    if (params.recipients.invalid.length > 0) {
      return {
        status: "skipped",
        reason:
          "Opportunity contact email is invalid. Update the job contact email and regenerate.",
      };
    }

    return {
      status: "skipped",
      reason: "No opportunity email was captured for this job.",
    };
  }

  // Resolve mailbox: prefer per-company setting, then process-level env, then constant.
  let mailbox =
    process.env.OUTLOOK_SHARED_MAILBOX?.trim().toLowerCase() ||
    DEFAULT_OUTLOOK_MAILBOX;

  if (params.companyId) {
    const companySettings = await prisma.companySettings.findUnique({
      where: { companyId: params.companyId },
      select: { outlookMailbox: true },
    });
    if (companySettings?.outlookMailbox?.trim()) {
      mailbox = companySettings.outlookMailbox.trim().toLowerCase();
    }
  }

  try {
    // Prefer the pre-formatted ATS PDF — it is already redacted and professionally
    // structured. Only fall back to the original PDF redaction path when it is absent.
    const hasFormattedPdf =
      Boolean(params.candidateFormattedCvPdfData) &&
      (params.candidateFormattedCvPdfData?.byteLength ?? 0) > 0;

    let redactedPdfBase64: string | undefined;

    if (hasFormattedPdf && params.candidateFormattedCvPdfData) {
      redactedPdfBase64 = Buffer.from(
        params.candidateFormattedCvPdfData,
      ).toString("base64");
    } else {
      const hasBinaryCv =
        Boolean(params.candidateCvFileData) &&
        (params.candidateCvFileData?.byteLength ?? 0) > 0;
      const looksLikePdfCv =
        hasBinaryCv &&
        ((params.candidateCvMimeType?.trim().toLowerCase() || "") ===
          "application/pdf" ||
          (params.candidateCvFileName?.trim().toLowerCase().endsWith(".pdf") ??
            false));

      if (looksLikePdfCv && params.candidateCvFileData) {
        try {
          const redactedPdf = await redactContactDetailsInPdf({
            pdfBytes: Buffer.from(params.candidateCvFileData),
            email: params.candidateEmail,
            phone: params.candidatePhone,
          });
          redactedPdfBase64 = redactedPdf.toString("base64");
        } catch (error) {
          // Keep the proper generation journey running even when runtime PDF
          // redaction dependencies are unavailable in the current environment.
          console.warn("[OUTLOOK_DRAFT_REDaction_FALLBACK]", {
            reason: (error as Error)?.message ?? "unknown",
          });
          redactedPdfBase64 = undefined;
        }
      }

      if (!redactedPdfBase64 && params.candidateCvText.trim()) {
        const fallbackRedactedPdf = await buildRedactedCvPdfFromText({
          cvText: params.candidateCvText,
          candidateName: params.candidateName,
          email: params.candidateEmail,
          phone: params.candidatePhone,
        });
        redactedPdfBase64 = fallbackRedactedPdf.toString("base64");
      }
    }

    // Attach only a redacted version of the original uploaded PDF.
    // If no binary PDF is available, no CV attachment is added.
    const attachments = redactedPdfBase64
      ? [
          {
            filename:
              (hasFormattedPdf
                ? params.candidateFormattedCvFileName?.trim()
                : params.candidateCvFileName?.trim()) ||
              `${safeAttachmentName(params.candidateName)}-cv.pdf`,
            contentBase64: redactedPdfBase64,
            contentType: "application/pdf",
          },
        ]
      : [];

    await createOutlookDraftForMailbox({
      mailbox,
      subject: params.subject,
      htmlBody: params.htmlBody,
      to: params.recipients.valid,
      attachments,
    });

    return { status: "created", mailbox };
  } catch (error) {
    console.error("[OUTLOOK_DRAFT]", error);
    return {
      status: "failed",
      mailbox,
      reason: "Failed to create Outlook draft",
    };
  }
}

function cleanItem(item: string): string {
  return item.replace(/\s+/g, " ").trim();
}

function isGenericRoleTitle(title: string | undefined): boolean {
  if (!title) return true;
  const cleaned = cleanItem(title);
  const normalised = cleaned.toLowerCase();

  const looksLikeSocialPostBlob =
    cleaned.length > 120 ||
    /\bfeed post\b|\blike\b\s+\bcomment\b\s+\brepost\b|\breact(?:ion)?s?\b|\bcomments?\b|\breposts?\b/i.test(
      cleaned,
    );

  return (
    !normalised ||
    normalised === "role" ||
    normalised === "untitled role" ||
    normalised === "untitled" ||
    normalised === "uploaded role" ||
    normalised === "contract role" ||
    looksLikeSocialPostBlob
  );
}

function isPlaceholderCandidateName(name: string | undefined): boolean {
  if (!name) return true;
  const normalised = name.trim().toLowerCase();
  return (
    !normalised ||
    normalised === "uploaded candidate" ||
    normalised === "unknown candidate" ||
    normalised === "candidate" ||
    normalised === "certified information security manager"
  );
}

function isJunkRoleLine(value: string): boolean {
  const line = cleanItem(value).toLowerCase();
  if (!line) return true;

  return /@|\b(?:thank you for applying|application|dear|hi\b|hello\b|regards|best regards|kind regards|email|phone|contact|cv|candidate|salary|rate|location|must\s*have|required)\b/.test(
    line,
  );
}

function looksLikeRoleTitle(value: string): boolean {
  const line = cleanItem(value);
  if (line.length < 3 || line.length > 90) {
    return false;
  }

  return /\b(?:engineer|manager|architect|analyst|consultant|specialist|developer|administrator|officer|lead|security|network|data)\b/i.test(
    line,
  );
}

function deriveRolesFromText(text: string): string[] {
  const lines = text.split(/\r?\n/).map(cleanItem).filter(Boolean);

  return unique(
    lines.filter(
      (line) =>
        /\b(?:engineer|architect|developer|manager|analyst|administrator|consultant)\b/i.test(
          line,
        ) &&
        !/\b(?:skills|education|contact|references|summary|profile)\b/i.test(
          line,
        ) &&
        line.length <= 90,
    ),
  ).slice(0, 5);
}

function findRoleTitleInText(text: string): string | undefined {
  const match = text.match(
    /\b(?:role|position|job title)\s*[:\-]\s*([^\n]+)/i,
  )?.[1];
  if (match && !isJunkRoleLine(match)) {
    return cleanItem(match);
  }

  const lines = text.split(/\r?\n/).map(cleanItem).filter(Boolean);
  for (const line of lines.slice(0, 12)) {
    if (isJunkRoleLine(line)) continue;
    const candidate = line.split(/[|]/)[0]?.trim() ?? "";
    if (looksLikeRoleTitle(candidate)) {
      return candidate;
    }
  }

  const firstRole = deriveRolesFromText(text)[0];
  return firstRole ? cleanItem(firstRole) : undefined;
}

function hashInputs(
  jobText: string,
  cvText: string,
  rulesJson: unknown,
): string {
  return crypto
    .createHash("sha256")
    .update(jobText)
    .update(cvText)
    .update(JSON.stringify(rulesJson))
    .digest("hex");
}

function parseVossTogglesFromRules(
  rulesJson: Record<string, unknown>,
): VossToggles {
  const includeSections =
    typeof rulesJson.include_sections === "object" &&
    rulesJson.include_sections !== null
      ? (rulesJson.include_sections as Record<string, unknown>)
      : {};

  return {
    accusations_audit:
      typeof includeSections.accusations_audit === "boolean"
        ? includeSections.accusations_audit
        : DEFAULT_VOSS_TOGGLES.accusations_audit,
    tactical_empathy:
      typeof includeSections.tactical_empathy === "boolean"
        ? includeSections.tactical_empathy
        : DEFAULT_VOSS_TOGGLES.tactical_empathy,
    labelling:
      typeof includeSections.labelling === "boolean"
        ? includeSections.labelling
        : DEFAULT_VOSS_TOGGLES.labelling,
    mirroring:
      typeof includeSections.mirroring === "boolean"
        ? includeSections.mirroring
        : DEFAULT_VOSS_TOGGLES.mirroring,
    calibrated_questions:
      typeof includeSections.calibrated_questions === "boolean"
        ? includeSections.calibrated_questions
        : DEFAULT_VOSS_TOGGLES.calibrated_questions,
    no_oriented_closing:
      typeof includeSections.no_oriented_closing === "boolean"
        ? includeSections.no_oriented_closing
        : DEFAULT_VOSS_TOGGLES.no_oriented_closing,
  };
}

function resolveAdminCustomPrompt(
  rulesJson: Record<string, unknown>,
): string | undefined {
  const raw = rulesJson.custom_email_prompt;
  if (typeof raw !== "string") {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, 4000);
}

async function generatePartnerPositioning(
  partnerName: string,
  companyType: CompanyType,
): Promise<string> {
  const typeLabel =
    companyType === "support"
      ? "specialist support and services partner"
      : "specialist professional services firm";
  const systemPrompt =
    "You write concise, factual company positioning statements in British English. Output only the positioning paragraph — no preamble, no quotes, no JSON wrapper.";
  const userPrompt = `Write a 3–4 sentence company positioning statement for "${partnerName}", a ${typeLabel}. Cover: what the firm does, how it supports clients, its accountability model (B2B services basis, delivery quality, continuity), and why it is credible. Do not invent specific technologies or geographies unless they are obvious from the company name. Keep it under 80 words.`;

  const { apiBase, apiKey } = requireAiGatewayConfig(
    "AI gateway not configured for positioning generation",
  );
  const model = resolveAiGatewayModel();
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 200,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Positioning generation failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Positioning generation returned empty content");
  }

  return content.slice(0, 1000);
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks that the partner company name appears somewhere in the generated email body.
 * A draft that omits the C2C partner cannot fulfil our positioning requirement.
 */
function detectCompanyPositioning(
  plainText: string,
  partnerName: string,
): boolean {
  if (!partnerName.trim()) return true;
  return plainText.toLowerCase().includes(partnerName.trim().toLowerCase());
}

function containsExpectedCandidateName(params: {
  expectedName: string;
  subject: string;
  htmlBody: string;
}): boolean {
  const expected = cleanItem(params.expectedName);
  if (!expected) return false;

  const pattern = new RegExp(
    `\\b${escapeRegExp(expected).replace(/\\s+/g, "\\\\s+")}\\b`,
    "i",
  );

  const bodyPlainText = htmlToPlainText(params.htmlBody);
  return pattern.test(params.subject) || pattern.test(bodyPlainText);
}

/** Truncate text to stay within the LLM's input token budget.
 *  Rough heuristic: ~4 characters per token. The system prompt and template
 *  consume ~3 000 tokens, so we cap user-provided text to `maxChars`. */
function truncateForLlm(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n…[truncated]";
}

function resolveEmailCompletionTokenBudget(preferredWordRange: {
  max: number;
}): number {
  // Reasoning models (e.g. deepseek, glm) consume tokens for chain-of-thought
  // before producing visible output.  Budget must be large enough to cover both
  // the thinking phase AND the final email JSON.  Observed: glm-5.1 uses ~20k
  // tokens for reasoning alone.  Using 16384 as the floor ensures most reasoning
  // models can complete, but callers should pass an explicit value when they
  // know the model needs more.
  return Math.max(
    16384,
    Math.min(32768, Math.round(preferredWordRange.max * 4)),
  );
}

function buildLearningExamples(
  drafts: Array<{ subject: string; htmlBody: string }>,
): string {
  return drafts
    .map((draft, index) => {
      const body = htmlToPlainText(draft.htmlBody).slice(0, 900);
      return `Example ${index + 1}\nSubject: ${draft.subject}\nBody sample: ${body}`;
    })
    .join("\n\n");
}

function buildRecentDraftsToAvoid(
  drafts: Array<{ subject: string; htmlBody: string; roleTitle?: string }>,
): string {
  return drafts
    .map((draft, index) => {
      const body = htmlToPlainText(draft.htmlBody);
      const opener = body.split(/[.!?]\s+/)[0]?.trim() ?? "";
      const close = body.slice(-220).trim();
      return [
        `Recent draft ${index + 1}${draft.roleTitle ? ` (${draft.roleTitle})` : ""}`,
        `Subject: ${draft.subject}`,
        `Opening line: ${opener}`,
        `Closing style sample: ${close}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function pickVariationHint(): string {
  const hints = [
    "Lead with the hiring team's most urgent delivery pressure, then pivot to candidate impact evidence.",
    "Open with a specific operational consequence of leaving this role unfilled, then introduce the candidate as the resolution.",
    "Start with the single most impressive CV fact that directly addresses the JD's primary requirement.",
    "Frame the opening around the commercial risk the brief implies, then show how the candidate's track record mitigates it.",
    "Use a consultative opening that names a specific technical challenge from the JD, then bridge to candidate evidence.",
    "Open with a forward-looking impact statement — what this candidate could deliver in the first 90 days based on CV evidence.",
    "Lead with the candidate's strongest differentiator relative to the typical talent pool for this role.",
    "Start with a concise market observation relevant to this role's scarcity, then position the candidate as a timely solution.",
    "Open by naming the JD's hardest-to-fill requirement and immediately show the candidate's best evidence against it.",
    "Frame the first paragraph around what the hiring manager likely values most (speed, quality, domain knowledge) based on JD signals.",
    "Use a measured challenger tone: open with a pointed observation about what this role really needs, then evidence it.",
    "Lead with the candidate's most quantifiable achievement that maps to a specific JD deliverable.",
  ];

  return hints[crypto.randomInt(0, hints.length)] ?? hints[0];
}

type EmailEvidenceContext = {
  candidateSummary: string;
  jobHighlights: string;
  cvToJdAlignment: string;
  mirroredPhrase: string;
};

function buildFallbackEvidenceContext(params: {
  jobText: string;
  cvText: string;
  roleTitle?: string;
}): EmailEvidenceContext {
  const jobLines = params.jobText
    .split(/\r?\n/)
    .map(cleanItem)
    .filter(Boolean)
    .slice(0, 8);

  const cvLines = params.cvText
    .split(/\r?\n/)
    .map(cleanItem)
    .filter(Boolean)
    .slice(0, 10);

  const role = params.roleTitle?.trim() || "the role";
  const candidateSummary = [
    `Candidate profile extracted for ${role}.`,
    ...cvLines.slice(0, 5),
  ]
    .filter(Boolean)
    .join("\n");

  const jobHighlights = [`Role focus: ${role}.`, ...jobLines.slice(0, 5)]
    .filter(Boolean)
    .join("\n");

  const cvToJdAlignment = [
    `Role requirement context: ${role}.`,
    "Candidate CV and job description were matched using available extracted details.",
    "Use evidence-led claims and avoid unsupported assumptions.",
  ].join("\n");

  return {
    candidateSummary,
    jobHighlights,
    cvToJdAlignment,
    mirroredPhrase: `filling ${role} with relevant proven capability`,
  };
}

type EmailDraftResult = {
  subject: string;
  html: string;
};

async function generateEmailEvidenceContext(params: {
  jobText: string;
  cvText: string;
  roleTitle?: string;
}): Promise<EmailEvidenceContext> {
  const asCleanText = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || undefined;
    }

    if (Array.isArray(value)) {
      const merged = value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
      return merged || undefined;
    }

    if (value && typeof value === "object") {
      const textCandidate = (value as { text?: unknown }).text;
      if (typeof textCandidate === "string" && textCandidate.trim()) {
        return textCandidate.trim();
      }
    }

    return undefined;
  };

  const systemPrompt =
    "Generate strict JSON only with keys candidateSummary, jobHighlights, cvToJdAlignment, mirroredPhrase from provided JD and CV text. Extract factual evidence only from the documents. Be specific — include quantities, timeframes, team sizes, technologies, certifications, and scale indicators wherever they appear. Keep each value concise, professional, and client-facing in British English.";

  const userPrompt = `JOB DESCRIPTION:\n${params.jobText}\n\nCANDIDATE CV:\n${params.cvText}\n\nRole title hint: ${params.roleTitle ?? "Unknown"}\n\nRules:\n- candidateSummary: 5-8 concise lines. Include: total years of experience, specific domain/industry background, key technical skills with proficiency indicators, certifications, notable scale achievements (team sizes managed, systems delivered, uptime figures), and direct relevance to this role. Prioritise facts that differentiate this candidate from a generic applicant.\n- jobHighlights: 5-8 concise lines. Extract: primary deliverables, must-have technical requirements, stated or implied timeline pressures, team structure context, seniority expectations, any stated business constraints or risks. Separate hard requirements from nice-to-haves.\n- cvToJdAlignment: 6-10 evidence bullets, each following the pattern: "[JD requirement] → [specific CV evidence with quantities/timeframes] → [likely business impact if hired]". Include 1-2 gap bullets where the CV does not directly evidence a JD requirement, stated honestly.\n- mirroredPhrase: one short phrase (5-10 words) capturing the core business pressure or priority implied by the JD.\nReturn JSON only.`;

  let result: Partial<EmailEvidenceContext>;
  try {
    result = await generateStructuredJson<Partial<EmailEvidenceContext>>({
      systemPrompt,
      userPrompt,
      maxTokens: 1200,
      temperature: 0,
    });
  } catch {
    return buildFallbackEvidenceContext({
      jobText: params.jobText,
      cvText: params.cvText,
      roleTitle: params.roleTitle,
    });
  }

  const candidateSummary = asCleanText(result.candidateSummary);
  const jobHighlights = asCleanText(result.jobHighlights);
  const cvToJdAlignment = asCleanText(result.cvToJdAlignment);
  const mirroredPhrase = asCleanText(result.mirroredPhrase);

  if (
    !candidateSummary ||
    !jobHighlights ||
    !cvToJdAlignment ||
    !mirroredPhrase
  ) {
    return buildFallbackEvidenceContext({
      jobText: params.jobText,
      cvText: params.cvText,
      roleTitle: params.roleTitle,
    });
  }

  return {
    candidateSummary,
    jobHighlights,
    cvToJdAlignment,
    mirroredPhrase,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function isDemo(): boolean {
  if (process.env.DEMO_MODE) return true;
  const dbUrl = process.env.DATABASE_URL ?? "";
  return dbUrl.includes("demo.db");
}

export async function POST(request: Request) {
  if (EMAIL_GENERATION_DISABLED) {
    return jsonError("Email generation is currently disabled.", 503, {
      hint: "Contact an admin to re-enable EMAIL_GENERATION_DISABLED.",
    });
  }
  try {
    const scope = resolveTenantAccessScope(request);
    const tenantId = scope.tenantId;
    const body = emailGenerateSchema.parse(await request.json());
    // Allow per-request model override via `model` or `aiProvider` field.
    const bodyExt = body as Record<string, unknown>;
    const modelOverride = (bodyExt.model ?? bodyExt.aiProvider) as
      | string
      | undefined;

    const demoMode = isDemo();

    const [job, candidate, senderUser] = await Promise.all([
      prisma.job.findFirst({
        where: {
          id: body.jobId,
          tenantId,
          ...getOwnerFilter(scope),
        },
        include: { company: true },
      }),
      prisma.candidate.findFirst({
        where: {
          id: body.candidateId,
          tenantId,
          ...getOwnerFilter(scope),
        },
      }),
      scope.userId
        ? prisma.tenantUser.findUnique({
            where: { id: scope.userId },
            select: { fullName: true, email: true },
          })
        : Promise.resolve(null),
    ]);

    if (!job || !candidate) {
      return jsonError("Job or candidate not found", 404);
    }

    if (!job.company?.name?.trim()) {
      return jsonError(
        "Company name is required before generating email",
        400,
        {
          hint: "Start the application with Company name completed.",
        },
      );
    }

    // Gate: a valid opportunity email must be present before committing to generation.
    // Jobs with no contactable address cannot be responded to and must not be catalogued.
    const recipients = parseDraftRecipients(job.opportunityEmail);
    if (recipients.valid.length === 0) {
      return jsonOk({ skipped: true, reason: "no_opportunity_email" });
    }

    const ruleset = body.rulesetId
      ? await prisma.ruleSet.findFirst({
          where: { id: body.rulesetId, tenantId },
        })
      : await prisma.ruleSet.findFirst({
          where: { isDefault: true, tenantId },
        });

    const rulesJson = (ruleset?.rulesJson ?? {}) as Record<string, unknown>;
    const adminCustomPrompt = resolveAdminCustomPrompt(rulesJson);
    const vossToggles = parseVossTogglesFromRules(rulesJson);
    const preferredLength =
      typeof rulesJson.length === "string" && rulesJson.length.trim()
        ? rulesJson.length.trim()
        : undefined;
    const preferredWordRange = resolvePreferredWordRange(preferredLength);
    const maxOutputTokens =
      resolveEmailCompletionTokenBudget(preferredWordRange);
    const companyType: CompanyType =
      rulesJson.company_type === "support" ? "support" : "placement";
    const c2cPartnerName =
      typeof rulesJson.c2c_partner_name === "string" &&
      rulesJson.c2c_partner_name.trim()
        ? rulesJson.c2c_partner_name.trim()
        : (process.env.DEFAULT_C2C_PARTNER_NAME ?? "C2C Partner Ltd");

    // Auto-generate positioning if empty, then cache it back to the ruleset.
    let c2cPartnerPositioning =
      typeof rulesJson.c2c_partner_positioning === "string" &&
      rulesJson.c2c_partner_positioning.trim()
        ? rulesJson.c2c_partner_positioning.trim()
        : undefined;

    if (!c2cPartnerPositioning) {
      try {
        c2cPartnerPositioning = await generatePartnerPositioning(
          c2cPartnerName,
          companyType,
        );
        // Persist so it's only generated once.
        if (ruleset) {
          await prisma.ruleSet.update({
            where: { id: ruleset.id },
            data: {
              rulesJson: {
                ...rulesJson,
                c2c_partner_positioning: c2cPartnerPositioning,
              },
            },
          });
        }
      } catch {
        // Non-fatal — proceed without positioning if generation fails.
      }
    }

    const emailSystemPrompt = EMAIL_SYSTEM_PROMPT(
      preferredWordRange,
      c2cPartnerPositioning,
      companyType,
    );
    const gatewayConfigured = isAiGatewayConfigured();

    if (!gatewayConfigured) {
      return jsonError("LiteLLM is not configured for email generation", 400, {
        hint: getAiGatewayEnvHint(),
      });
    }

    // Deduplicate: compute the content hash early and return a cached draft if the same
    // job/CV/rules inputs have already been used to generate for this pair.
    const generatedFrom = hashInputs(job.rawText, candidate.rawCV, rulesJson);
    {
      const dedupOpportunityId = body.applicationId
        ? null
        : `${tenantId}:${computeOpportunityId({
            candidateName: candidate.fullName,
            roleTitle: job.title,
            companyName: job.company?.name,
          })}`;
      const dedupAppId =
        body.applicationId ??
        (dedupOpportunityId
          ? (
              await prisma.application.findFirst({
                where: { opportunityId: dedupOpportunityId, tenantId },
                select: { id: true },
              })
            )?.id
          : null);
      if (dedupAppId) {
        const cachedDraft = await prisma.emailDraft.findFirst({
          where: { applicationId: dedupAppId, generatedFrom, tenantId },
          orderBy: { createdAt: "desc" },
        });
        if (cachedDraft) {
          return jsonOk(
            { ...cachedDraft, deduplicated: true, cached: true },
            { status: 201 },
          );
        }
      }
    }

    const preferredDrafts = await prisma.emailDraft.findMany({
      where: { preferredForLearning: true, tenantId },
      select: {
        subject: true,
        htmlBody: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 4,
    });

    const recentCandidateDrafts = await prisma.emailDraft.findMany({
      where: {
        tenantId,
        application: {
          candidateId: candidate.id,
        },
      },
      select: {
        subject: true,
        htmlBody: true,
        application: {
          select: {
            job: {
              select: {
                title: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    const roleTitleFromRecord = cleanItem(job.title);
    const roleTitleFromJobText = findRoleTitleInText(job.rawText);
    const needsRoleInference =
      isGenericRoleTitle(roleTitleFromRecord) ||
      !looksLikeRoleTitle(roleTitleFromRecord);
    const needsCandidateInference = isPlaceholderCandidateName(
      candidate.fullName,
    );

    let inferredMetadata: { roleTitle?: string; candidateName?: string } = {};
    if (needsRoleInference || needsCandidateInference) {
      try {
        inferredMetadata = await inferMetadataFromUploadedText({
          jobText: truncateForLlm(job.rawText),
          candidateText: truncateForLlm(candidate.rawCV),
        });
      } catch {
        inferredMetadata = {};
      }
    }

    const effectiveRoleTitle = needsRoleInference
      ? inferredMetadata.roleTitle?.trim() || roleTitleFromJobText || undefined
      : roleTitleFromRecord;
    const effectiveCandidateName = needsCandidateInference
      ? inferredMetadata.candidateName?.trim()
      : candidate.fullName;

    if (!effectiveRoleTitle || !effectiveCandidateName) {
      return jsonError("AI could not infer role title or candidate name", 400, {
        hint: "Ensure uploaded JD/CV text clearly includes role title and candidate name.",
      });
    }

    const learningExamples = buildLearningExamples(preferredDrafts);
    const recentDraftsToAvoid = buildRecentDraftsToAvoid(
      recentCandidateDrafts.map((draft) => ({
        subject: draft.subject,
        htmlBody: draft.htmlBody,
        roleTitle: draft.application.job.title,
      })),
    );
    const evidenceContext = await generateEmailEvidenceContext({
      jobText: truncateForLlm(job.rawText),
      cvText: truncateForLlm(candidate.rawCV),
      roleTitle: effectiveRoleTitle,
    });

    let suggestedRolesForSafety = candidate.suggestedRolesCsv;

    let atsSafety = matchCvAgainstAts({
      cvText: candidate.rawCV,
      jobText: `${job.title}\n${job.rawText}`,
      candidateEmail: candidate.email,
      candidatePhone: candidate.phone,
      skillsCsv: candidate.skillsCsv,
      certificationsCsv: candidate.certificationsCsv,
      suggestedRolesCsv: suggestedRolesForSafety,
    });

    const hasInitialRoleMismatch = atsSafety.flags.some(
      (flag) => flag.code === "ROLE_MISMATCH",
    );

    if (
      (hasInitialRoleMismatch || atsSafety.decision === "FLAGGED") &&
      ((candidate.skillsCsv?.trim() ?? "") ||
        (candidate.certificationsCsv?.trim() ?? ""))
    ) {
      try {
        const refreshedRoles =
          await inferSuggestedRolesFromSkillsAndCertifications({
            skillsCsv: candidate.skillsCsv ?? "",
            certificationsCsv: candidate.certificationsCsv ?? "",
            fastMode: true,
          });

        suggestedRolesForSafety = refreshedRoles.join(", ");

        if (suggestedRolesForSafety.trim()) {
          await prisma.candidate.update({
            where: { id: candidate.id },
            data: { suggestedRolesCsv: suggestedRolesForSafety },
          });
        }

        atsSafety = matchCvAgainstAts({
          cvText: candidate.rawCV,
          jobText: `${job.title}\n${job.rawText}`,
          candidateEmail: candidate.email,
          candidatePhone: candidate.phone,
          skillsCsv: candidate.skillsCsv,
          certificationsCsv: candidate.certificationsCsv,
          suggestedRolesCsv: suggestedRolesForSafety,
        });
      } catch {
        // Keep safety gate strict even if role refresh is unavailable.
      }
    }

    const hasRoleMismatch = atsSafety.flags.some(
      (flag) => flag.code === "ROLE_MISMATCH",
    );

    const failedAtsSafetyGate =
      hasRoleMismatch ||
      atsSafety.decision === "FLAGGED" ||
      atsSafety.score < ATS_MIN_SAFE_EMAIL_SCORE;

    if (ENFORCE_ATS_EMAIL_SAFETY_GATE && failedAtsSafetyGate) {
      return jsonError(
        `Candidate-to-opportunity alignment failed safety checks (minimum score ${ATS_MIN_SAFE_EMAIL_SCORE}). Email generation blocked for manual review.`,
        409,
        {
          ats: {
            score: atsSafety.score,
            decision: atsSafety.decision,
            flags: atsSafety.flags,
            summary: atsSafety.summary,
            suggestedRolesCsv: suggestedRolesForSafety,
          },
          hint: `Open ATS Match, confirm role alignment, and improve ATS score to at least ${ATS_MIN_SAFE_EMAIL_SCORE} before regenerating.`,
        },
      );
    }

    // ── Candidate-confirmed role gate ─────────────────────────────────────────
    // The most important gate: if the candidate has explicitly confirmed they are
    // happy with a role (via email reply → preferredRolesCsv), check that confirmed
    // role against the opportunity. The candidate's own confirmation supersedes any
    // AI-inferred role suggestion.
    const confirmedRoles = (candidate.preferredRolesCsv ?? "")
      .split(/[,;|\n]+/)
      .map((r) => r.trim())
      .filter(Boolean);

    if (!BYPASS_ROLE_MATCH_GUARD && confirmedRoles.length > 0) {
      const confirmedRoleGuard = guardCandidateForOpportunity(
        confirmedRoles,
        effectiveRoleTitle,
      );
      if (!confirmedRoleGuard.allowed) {
        return jsonError(
          "Candidate confirmed roles do not match this opportunity. Email generation blocked — the candidate expressed interest in different roles.",
          409,
          {
            roleGuard: {
              reason: confirmedRoleGuard.reason,
              failedRoles: confirmedRoleGuard.failedRoles,
              confirmedRoles: confirmedRoles,
              jobTitle: effectiveRoleTitle,
            },
            hint: "The candidate confirmed different roles via email. Only generate emails for opportunities that align with their confirmed preferences.",
          },
        );
      }
    } else if (!BYPASS_ROLE_MATCH_GUARD) {
      // No confirmed roles on record — fall back to AI-suggested roles as a
      // conservative guard, but with a softer message since these are inferred.
      const suggestedRoles = suggestedRolesForSafety
        .split(/[,;|\n]+/)
        .map((r) => r.trim())
        .filter(Boolean);

      const suggestedRoleGuard = guardCandidateForOpportunity(
        suggestedRoles,
        effectiveRoleTitle,
      );
      if (!suggestedRoleGuard.allowed) {
        return jsonError(
          "Candidate role family does not match the opportunity. An engineer cannot be placed as an architect and vice versa.",
          409,
          {
            roleGuard: {
              reason: suggestedRoleGuard.reason,
              failedRoles: suggestedRoleGuard.failedRoles,
              suggestedRoles: suggestedRolesForSafety,
              jobTitle: effectiveRoleTitle,
            },
            hint: "Review the candidate's suggested roles. Only candidates whose role family aligns with the opportunity may have emails generated.",
          },
        );
      }
    }

    // ── US work-authorisation gate ─────────────────────────────────────────────
    // Hard-block roles that require USC / Green Card status. Our candidates are
    // Africa-based and cannot satisfy these requirements. Sending an email that
    // "flags" this is pointless — it is a hard disqualification.
    const enforceUsWorkAuthGate = rulesJson.enforce_us_work_auth_gate !== false;
    const needsUsAuth =
      enforceUsWorkAuthGate &&
      (job.requiresUsWorkAuth ??
        requiresUsWorkAuthorisation(job.title ?? "", job.rawText ?? ""));
    if (needsUsAuth) {
      return jsonError(
        "This opportunity requires US work authorisation (USC/Green Card). Email generation is blocked — this is a hard disqualification for candidates without US work authorisation.",
        409,
        {
          hint: "Remove or replace this opportunity. Roles requiring USC/GC status cannot be filled by Africa-based candidates.",
        },
      );
    }

    // ── Location restriction gate ──────────────────────────────────────────────
    // Block roles that require candidates to be based in a specific non-SA location
    // (e.g. India: "must be based in Pune/Bengaluru/Chennai", UK: "UK-based only",
    // Europe: "must be based in Europe"). Our candidates are South Africa-based and
    // cannot satisfy these geographic restrictions.
    const enforceLocationGate = rulesJson.enforce_location_gate !== false;
    const locationRestricted =
      enforceLocationGate &&
      (job.requiresNonSaLocation ??
        requiresNonSaLocationRestriction(job.title ?? "", job.rawText ?? ""));
    if (locationRestricted) {
      return jsonError(
        "This opportunity has a geographic location restriction that excludes South Africa-based candidates (e.g. must be based in India, UK, or Europe). Email generation is blocked.",
        409,
        {
          hint: "Review the job description. If the role genuinely accepts South Africa-based remote candidates, update the JD text to reflect that.",
        },
      );
    }

    // ── Remote-only gate ──────────────────────────────────────────────────────
    // We only place into remote roles. Block any JD that does not signal remote
    // working to avoid unsuitable submissions for on-site positions.
    const enforceRemoteGate = rulesJson.enforce_remote_gate !== false;
    const isRemote =
      !enforceRemoteGate ||
      (job.isRemote ?? isRemoteRole(job.title ?? "", job.rawText ?? ""));
    if (!isRemote) {
      return jsonError(
        "This opportunity does not appear to be remote. Email generation is only supported for remote roles.",
        409,
        {
          hint: 'Review the job description. If the role is genuinely remote, ensure the JD text includes a clear remote-working signal (e.g. "remote", "fully remote", "work from home").',
        },
      );
    }

    let result: EmailDraftResult | undefined;
    let aiErrorMessage: string | undefined;

    const generatedPrompt = EMAIL_USER_PROMPT({
      jobDescription: `${truncateForLlm(job.rawText)}\n\nHighlights:\n${evidenceContext.jobHighlights}\n\nMirrored phrase: "${evidenceContext.mirroredPhrase}"`,
      candidateSummary: evidenceContext.candidateSummary,
      cvToJdAlignment: evidenceContext.cvToJdAlignment,
      learningExamples: learningExamples || undefined,
      companyName: job.company?.name,
      roleTitle: effectiveRoleTitle,
      c2cPartnerName,
      c2cPartnerPositioning,
      companyType,
      rulesJson,
      variationHint: pickVariationHint(),
      preferredLength,
      includeSections: vossToggles,
      recentDraftsToAvoid: recentDraftsToAvoid || undefined,
      recipientName: effectiveCandidateName,
      senderName: senderUser?.fullName,
      senderEmail: senderUser?.email,
    });

    const userPrompt = adminCustomPrompt
      ? `${generatedPrompt}\n\nADMIN CUSTOM PROMPT OVERRIDE:\n${adminCustomPrompt}\n\nApply this override exactly as an additional mandatory instruction when generating this draft.`
      : generatedPrompt;

    try {
      result = await generateEmail({
        systemPrompt: emailSystemPrompt,
        userPrompt,
        maxOutputTokens,
        model: modelOverride,
      });
    } catch (error) {
      aiErrorMessage = (error as Error).message;
      console.error("[EMAIL_GENERATE] generateEmail failed:", aiErrorMessage);
    }

    if (!result) {
      const providerRateLimitReached =
        aiErrorMessage &&
        /RateLimitReached|\b429\b|rate.?limit/i.test(aiErrorMessage);

      const hint = providerRateLimitReached
        ? "LiteLLM rate limit reached. Retry shortly."
        : "Fix LiteLLM configuration or availability, then regenerate.";

      return jsonError("AI email generation failed", 502, {
        provider: "litellm",
        hint,
      });
    }

    if (
      !containsExpectedCandidateName({
        expectedName: effectiveCandidateName,
        subject: result.subject,
        htmlBody: result.html,
      })
    ) {
      return jsonError(
        "Generated email did not preserve the correct candidate name",
        422,
        {
          hint: "Candidate name mismatch detected. Regenerate after reviewing candidate data.",
          expectedCandidateName: effectiveCandidateName,
        },
      );
    }

    // ── Company positioning check ──────────────────────────────────────────
    // Verify that the partner company name appears in the generated draft.
    // A draft that omits the C2C partner cannot fulfil our positioning requirement
    // and must never reach the candidate.
    const draftPlainText = htmlToPlainText(result.html);
    if (!detectCompanyPositioning(draftPlainText, c2cPartnerName)) {
      return jsonError(
        `Generated email does not mention the partner company (${c2cPartnerName}). Email generation blocked.`,
        422,
        {
          hint: `Regenerate — the draft must introduce and position ${c2cPartnerName} as the C2C partner in the email body.`,
          c2cPartnerName,
        },
      );
    }

    // ── Factuality guard ─────────────────────────────────────────────────
    // Verify that every specific factual claim in the generated email can be
    // traced back to the source JD or CV.  If the check fails, attempt one
    // corrected re-generation.  If the corrected draft still fails, the
    // generation is blocked — a hallucinated draft must never be saved.
    // Set SKIP_FACTUALITY_GUARD=true to bypass this check (e.g. for bulk
    // generation with local models that tend to hallucinate).
    const skipFactualityGuard = process.env.SKIP_FACTUALITY_GUARD === "true";
    if (!skipFactualityGuard) {
      const factualityReport = await checkEmailFactuality({
        emailHtml: result.html,
        jdText: truncateForLlm(job.rawText ?? ""),
        cvText: truncateForLlm(candidate.rawCV ?? ""),
        roleTitle: effectiveRoleTitle,
        candidateName: effectiveCandidateName,
        companyName: job.company?.name ?? "",
      });

      if (!factualityReport.pass) {
        const correctionInstruction =
          buildFactualityRegenerationInstruction(factualityReport);
        const correctedPrompt = adminCustomPrompt
          ? `${generatedPrompt}\n\nADMIN CUSTOM PROMPT OVERRIDE:\n${adminCustomPrompt}\n\nApply this override exactly as an additional mandatory instruction when generating this draft.\n\n${correctionInstruction}`
          : `${generatedPrompt}\n\n${correctionInstruction}`;

        let retrySaved = false;
        try {
          const retryResult = await generateEmail({
            systemPrompt: emailSystemPrompt,
            userPrompt: correctedPrompt,
            maxOutputTokens,
          });

          if (
            retryResult &&
            containsExpectedCandidateName({
              expectedName: effectiveCandidateName,
              subject: retryResult.subject,
              htmlBody: retryResult.html,
            })
          ) {
            // Run factuality check on the corrected draft before accepting it.
            const retryFactualityReport = await checkEmailFactuality({
              emailHtml: retryResult.html,
              jdText: truncateForLlm(job.rawText ?? ""),
              cvText: truncateForLlm(candidate.rawCV ?? ""),
              roleTitle: effectiveRoleTitle,
              candidateName: effectiveCandidateName,
              companyName: job.company?.name ?? "",
            });

            if (retryFactualityReport.pass) {
              result = retryResult;
              retrySaved = true;
            } else {
              console.warn(
                "[FACTUALITY_GUARD] Corrected draft still contains hallucinations. Blocking generation.",
                {
                  hallucinatedClaims: retryFactualityReport.hallucinatedClaims,
                },
              );
              return jsonError(
                "Email draft contains hallucinated claims that could not be auto-corrected. Generation blocked to protect brand accuracy.",
                422,
                {
                  hallucinatedClaims: retryFactualityReport.hallucinatedClaims,
                  factualityScore: retryFactualityReport.score,
                  hint: "Review the candidate CV and job description. Remove any claims that cannot be verified against those source documents before regenerating.",
                },
              );
            }
          }
        } catch (retryError) {
          console.warn(
            "[FACTUALITY_GUARD] Retry generation failed.",
            retryError,
          );
        }

        // If retry did not produce a clean draft, block rather than save hallucinations.
        if (!retrySaved) {
          return jsonError(
            "Email draft contains hallucinated claims. Generation blocked to protect brand accuracy.",
            422,
            {
              hallucinatedClaims: factualityReport.hallucinatedClaims,
              factualityScore: factualityReport.score,
              hint: "Review the candidate CV and job description. Remove any claims that cannot be verified against those source documents before regenerating.",
            },
          );
        }
      } // end factuality guard
    } // end if (!skipFactualityGuard)
    // ─────────────────────────────────────────────────────────────────────

    // In demo mode, return the real AI-generated result without DB writes.
    if (demoMode) {
      return jsonOk(
        {
          id: `demo-${Date.now()}`,
          subject: result.subject,
          htmlBody: result.html,
        },
        { status: 201 },
      );
    }

    let applicationId = body.applicationId;
    let deduplicated = false;
    if (applicationId) {
      const existingApplication = await prisma.application.findFirst({
        where: { id: applicationId, tenantId },
        select: { id: true },
      });

      if (!existingApplication) {
        return jsonError("Application not found", 404);
      }
    }

    if (!applicationId) {
      const opportunityId = `${tenantId}:${computeOpportunityId({
        candidateName: candidate.fullName,
        roleTitle: job.title,
        companyName: job.company?.name,
      })}`;

      try {
        const created = await prisma.application.create({
          data: {
            tenantId,
            ownerUserId: scope.userId,
            jobId: job.id,
            candidateId: candidate.id,
            opportunityId,
            c2cPartner: c2cPartnerName,
            history: { create: { toStage: "NEW", tenantId } },
          },
        });
        applicationId = created.id;
      } catch (error) {
        const isUniqueViolation = isUniqueConstraintError(error);

        if (!isUniqueViolation) {
          throw error;
        }

        const existing = await prisma.application.findFirst({
          where: { opportunityId, tenantId },
        });

        if (!existing) {
          throw error;
        }

        applicationId = existing.id;
        deduplicated = true;
      }
    }

    const autoDraft = await createAutomaticOutlookDraft({
      tenantId,
      companyId: job.companyId,
      subject: result.subject,
      htmlBody: result.html,
      recipients,
      candidateName: candidate.fullName,
      candidateCvText: candidate.rawCV,
      candidateEmail: candidate.email,
      candidatePhone: candidate.phone,
      candidateCvFileName: candidate.cvFileName,
      candidateCvMimeType: candidate.cvMimeType,
      candidateCvFileData: candidate.cvFileData,
      candidateFormattedCvPdfData: candidate.formattedCvPdfData,
      candidateFormattedCvFileName: candidate.formattedCvFileName,
    });

    // Do not fail AI draft generation when Outlook delivery is skipped/failed.
    // The UI already surfaces outlookDraft status to users.

    const { emailDraft, stageUpdated } = await prisma.$transaction(
      async (tx) => {
        const draft = await tx.emailDraft.create({
          data: {
            tenantId,
            applicationId,
            subject: result.subject,
            htmlBody: result.html,
            generatedFrom,
          },
        });

        const app = await tx.application.findFirst({
          where: { id: applicationId, tenantId },
        });

        let updated = false;
        if (app && app.currentStage !== "EMAIL_DRAFTED") {
          await tx.application.update({
            where: { id: app.id, tenantId },
            data: {
              currentStage: "EMAIL_DRAFTED",
              history: {
                create: {
                  fromStage: app.currentStage,
                  toStage: "EMAIL_DRAFTED",
                  changedBy: "Email generated",
                  tenantId,
                },
              },
            },
          });
          updated = true;
        }

        return { emailDraft: draft, stageUpdated: updated };
      },
    );

    return jsonOk(
      {
        ...emailDraft,
        deduplicated,
        stageUpdated,
        outlookDraft: autoDraft,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[EMAIL_GENERATE]", error);
    const message =
      error instanceof Error ? error.message : "Unable to generate email";
    return jsonError(message, 400);
  }
}
