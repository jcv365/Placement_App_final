import { generateStructuredJson } from "@/lib/aiJson";
import { inferMetadataFromUploadedText } from "@/lib/aiMetadata";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { generateEmail } from "@/lib/azureOpenAi";
import { redactCvContactDetails } from "@/lib/cvRedaction";
import { readSharedGithubAccessToken } from "@/lib/githubAuthStore";
import { generateEmailViaGithubModels } from "@/lib/githubModels";
import { createOutlookDraft, createOutlookDraftForMailbox } from "@/lib/graph";
import {
  decryptGraphAccessToken,
  isGraphConnectionUsable,
} from "@/lib/graphConnectionStore";
import { computeOpportunityId } from "@/lib/opportunity";
import { prisma } from "@/lib/prisma";
import {
  EMAIL_SYSTEM_PROMPT,
  EMAIL_USER_PROMPT,
  resolvePreferredWordRange,
  type CompanyType,
} from "@/lib/prompts";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";
import { emailGenerateSchema } from "@/lib/validation";
import { DEFAULT_VOSS_TOGGLES, type VossToggles } from "@/lib/voss";
import crypto from "crypto";

export const runtime = "nodejs";

const MIN_VOSS_TECHNIQUE_COVERAGE = 0.9;
const DEFAULT_OUTLOOK_MAILBOX = "placements@dotcloud.africa";

type OutlookDraftResult = {
  status: "created" | "skipped" | "failed";
  mailbox?: string;
  reason?: string;
};

function safeAttachmentName(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "candidate";
}

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  const parts = cookieHeader.split(";").map((part) => part.trim());
  for (const part of parts) {
    const [cookieName, ...cookieValueParts] = part.split("=");
    if (cookieName !== name) continue;
    return decodeURIComponent(cookieValueParts.join("="));
  }

  return undefined;
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
): string[] {
  if (!rawRecipients) {
    return [];
  }

  return Array.from(
    new Set(
      rawRecipients
        .split(/[;,]/)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)),
    ),
  );
}

async function createAutomaticOutlookDraft(params: {
  tenantId: string;
  companyId?: string | null;
  subject: string;
  htmlBody: string;
  to: string[];
  candidateName: string;
  candidateCvText: string;
  candidateEmail?: string | null;
  candidatePhone?: string | null;
  candidateCvFileName?: string | null;
  candidateCvMimeType?: string | null;
  candidateCvFileData?: Uint8Array | Buffer | null;
}): Promise<OutlookDraftResult> {
  if (params.to.length === 0) {
    return {
      status: "skipped",
      reason: "No opportunity email was captured for this job.",
    };
  }

  const settings = params.companyId
    ? await prisma.companySettings.findUnique({
        where: { companyId: params.companyId },
        select: {
          outlookMailbox: true,
          graphAccessTokenEncrypted: true,
          graphTokenExpiresAt: true,
          company: { select: { tenantId: true } },
        },
      })
    : null;

  if (settings && settings.company.tenantId !== params.tenantId) {
    return {
      status: "failed",
      reason: "Company mailbox settings could not be resolved for this tenant.",
    };
  }

  const mailbox =
    settings?.outlookMailbox?.trim().toLowerCase() || DEFAULT_OUTLOOK_MAILBOX;

  const hasConnectedCompanyGraph =
    settings &&
    isGraphConnectionUsable({
      graphAccessTokenEncrypted: settings.graphAccessTokenEncrypted,
      graphTokenExpiresAt: settings.graphTokenExpiresAt,
    }) &&
    settings.graphAccessTokenEncrypted;

  try {
    const hasBinaryCv =
      Boolean(params.candidateCvFileData) &&
      (params.candidateCvFileData?.byteLength ?? 0) > 0;

    const redactedCvText = params.candidateCvText.trim()
      ? redactCvContactDetails({
          cvText: params.candidateCvText,
          email: params.candidateEmail,
          phone: params.candidatePhone,
        })
      : "";

    // Always attach the redacted text version of the CV to protect candidate
    // contact details. Binary PDFs cannot be reliably redacted in-memory, so
    // we attach the extracted-and-redacted text instead.
    const attachments = redactedCvText.trim()
      ? [
          {
            filename: `${safeAttachmentName(params.candidateName)}-cv.txt`,
            content: redactedCvText.trim(),
            contentType: "text/plain",
          },
        ]
      : hasBinaryCv
        ? [
            {
              filename:
                params.candidateCvFileName?.trim() ||
                `${safeAttachmentName(params.candidateName)}-cv.pdf`,
              contentBase64: params.candidateCvFileData
                ? Buffer.from(params.candidateCvFileData).toString("base64")
                : undefined,
              contentType:
                params.candidateCvMimeType?.trim() || "application/pdf",
            },
          ]
        : [];

    if (hasConnectedCompanyGraph && settings?.graphAccessTokenEncrypted) {
      await createOutlookDraft({
        accessToken: decryptGraphAccessToken(
          settings.graphAccessTokenEncrypted,
        ),
        subject: params.subject,
        htmlBody: params.htmlBody,
        to: params.to,
        attachments,
      });

      return {
        status: "created",
        mailbox: "connected-company-account",
      };
    }

    await createOutlookDraftForMailbox({
      mailbox,
      subject: params.subject,
      htmlBody: params.htmlBody,
      to: params.to,
      attachments,
    });

    return { status: "created", mailbox };
  } catch (error) {
    return {
      status: "failed",
      mailbox,
      reason: (error as Error).message,
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

function countWords(text: string): number {
  const matches = text.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g);
  return matches?.length ?? 0;
}

function buildLengthFailureAssessment(params: {
  rangeLabel: string;
  min: number;
  max: number;
  actual: number;
}): DraftQualityAssessment {
  return {
    pass: false,
    score: 0,
    failures: [
      `Word count is outside target range (${params.rangeLabel}).`,
      `Actual length was ${params.actual} words.`,
    ],
    fixInstructions: `Regenerate to land strictly within ${params.min}-${params.max} words and preserve factual JD/CV mapping.`,
    standoutStrength: "",
  };
}

function detectTemplateSignals(text: string): string[] {
  const normalised = text.replace(/\s+/g, " ").trim().toLowerCase();
  const signals: string[] = [];

  const genericOpeners = [
    /^hi\s+hiring\s+team\b/,
    /^for\s+your\s+.+\s+role\b/,
    /^based\s+on\s+your\s+.+\s+brief\b/,
    /^would\s+it\s+be\s+a\s+bad\s+idea\s+to\b/,
    /^i\s+hope\s+(this\s+|you('re|\s+are)\s+)/,
    /^i\s+wanted\s+to\s+reach\s+out/,
    /^please\s+find\s+attached/,
    /^i('m|\s+am)\s+(writing|pleased)\s+to\s+(present|submit|introduce)/,
    /^i('d|\s+would)\s+like\s+to\s+introduce/,
    /^thank\s+you\s+for\s+sharing/,
    /^further\s+to\s+our\s+conversation/,
  ];

  if (genericOpeners.some((pattern) => pattern.test(normalised))) {
    signals.push(
      "Opening is banned or too generic — must lead with a role-specific business problem.",
    );
  }

  const genericClosings = [
    /let\s+me\s+know\s+if\s+you('d|\s+would)\s+like\s+to\s+discuss/,
    /please\s+don('t|t)\s+hesitate\s+to\s+reach\s+out/,
    /i\s+look\s+forward\s+to\s+hearing\s+from\s+you/,
    /happy\s+to\s+discuss\s+further/,
    /feel\s+free\s+to\s+reach\s+out/,
  ];

  if (genericClosings.some((pattern) => pattern.test(normalised))) {
    signals.push(
      "Closing is passive and generic — must be decision-oriented with a specific next step.",
    );
  }

  const blandFillerPhrases = [
    /(?:is\s+a\s+)?(?:great|perfect|excellent|ideal)\s+fit\b/,
    /strong\s+fit\s+for\s+your/,
    /key\s+strengths\s+include/,
    /confirm\s+fit\s+and\s+next\s+steps/,
    /proven\s+track\s+record/,
    /strong\s+communicat(?:or|ion\s+skills)/,
    /team\s+player/,
    /highly\s+motivated/,
    /passionate\s+about/,
    /extensive\s+experience\s+in/,
    /wealth\s+of\s+experience/,
    /hit\s+the\s+ground\s+running/,
  ];

  const blandCount = blandFillerPhrases.reduce(
    (count, pattern) => count + (pattern.test(normalised) ? 1 : 0),
    0,
  );
  if (blandCount >= 2) {
    signals.push(
      `Draft uses ${blandCount} bland filler phrases that weaken commercial impact. Replace with evidence-backed specifics.`,
    );
  }

  const unsubstantiatedAdjectives = [
    /(?:excellent|outstanding|brilliant|exceptional|impressive|remarkable)\s+(?!—|–|\(|\d|(?:track\s+record\s+of\s+\d))/,
  ];

  const unsubstantiatedCount = unsubstantiatedAdjectives.reduce(
    (count, pattern) => {
      const matches = normalised.match(pattern);
      return count + (matches ? matches.length : 0);
    },
    0,
  );
  if (unsubstantiatedCount >= 2) {
    signals.push(
      "Multiple empty adjectives without immediate evidence. Each strong adjective must be followed by a specific fact.",
    );
  }

  return signals;
}

function buildTemplateFailureAssessment(
  signals: string[],
): DraftQualityAssessment {
  return {
    pass: false,
    score: 0,
    failures: signals,
    fixInstructions:
      "Rewrite with role-specific phrasing, varied sentence starts, and evidence-led claims that avoid stock agency language.",
    standoutStrength: "",
  };
}

type VossCoverageResult = {
  enabledCount: number;
  detectedCount: number;
  requiredCount: number;
  coverageRatio: number;
  missingTechniques: string[];
};

function detectVossTechniques(
  plainText: string,
  toggles: VossToggles,
): VossCoverageResult {
  const text = plainText.toLowerCase();
  const tail = text.slice(-420);

  const detected = {
    accusations_audit:
      /\b(?:you may be thinking|you might be wondering|you may worry|you might worry|you may be concerned|you could understandably question|at first glance|it may seem)\b/.test(
        text,
      ),
    tactical_empathy:
      /\b(?:it sounds like|it seems like|it looks like|it appears that|given your .*?(?:priority|pressure|timeline)|you(?:'re| are) balancing|you(?:'re| are) under pressure)\b/.test(
        text,
      ),
    labelling: /\b(?:it seems|it sounds|it looks|it appears)\b/.test(text),
    mirroring:
      /(?:^|[.!?]\s+)(?!how\b|what\b|would\b|could\b|should\b|can\b|is\b|are\b)(?:[a-z0-9'-]+\s+){2,7}[a-z0-9'-]+\?/i.test(
        plainText,
      ),
    calibrated_questions: /\b(?:how|what)\b[^?]{0,140}\?/i.test(plainText),
    no_oriented_closing:
      /\b(?:would it be unreasonable|would it be a bad idea|would you be against|would it be out of the question|is it a bad idea)\b[^?]{0,140}\?/i.test(
        tail,
      ),
  } as const;

  const enabledTechniques = (
    Object.keys(toggles) as Array<keyof VossToggles>
  ).filter((key) => toggles[key]);

  const missingTechniques = enabledTechniques
    .filter((key) => !detected[key])
    .map((key) => key.replace(/_/g, " "));

  const enabledCount = enabledTechniques.length;
  const detectedCount = enabledCount - missingTechniques.length;
  const requiredCount =
    enabledCount === 0
      ? 0
      : Math.max(1, Math.ceil(enabledCount * MIN_VOSS_TECHNIQUE_COVERAGE));
  const coverageRatio =
    enabledCount === 0 ? 1 : detectedCount / Math.max(1, enabledCount);

  return {
    enabledCount,
    detectedCount,
    requiredCount,
    coverageRatio,
    missingTechniques,
  };
}

function detectCompanyPositioning(
  plainText: string,
  partnerName: string,
): { mentioned: boolean } {
  if (!partnerName.trim()) return { mentioned: true };
  const text = plainText.toLowerCase();
  const name = partnerName.trim().toLowerCase();
  const mentioned = text.includes(name);
  return { mentioned };
}

function buildCompanyPositioningFailureAssessment(
  partnerName: string,
): DraftQualityAssessment {
  return {
    pass: false,
    score: 0,
    failures: [
      `The sender company (${partnerName}) is not mentioned anywhere in the email. The draft must introduce and position ${partnerName} as the company-to-company partner.`,
    ],
    fixInstructions: `Regenerate and weave ${partnerName} into the narrative — introduce the company naturally as the hiring company's trusted partner. Do not bolt on a generic tagline; integrate it into the credibility framing and evidence presentation.`,
    standoutStrength: "",
  };
}

function buildVossCoverageFailureAssessment(
  coverage: VossCoverageResult,
): DraftQualityAssessment {
  const thresholdPercent = Math.round(MIN_VOSS_TECHNIQUE_COVERAGE * 100);
  const failures = [
    `Voss coverage below threshold: detected ${coverage.detectedCount}/${coverage.enabledCount} enabled techniques (required ${coverage.requiredCount}).`,
  ];

  if (coverage.missingTechniques.length > 0) {
    failures.push(
      `Missing techniques: ${coverage.missingTechniques.join(", ")}.`,
    );
  }

  return {
    pass: false,
    score: 0,
    failures,
    fixInstructions: `Regenerate and include at least ${thresholdPercent}% of enabled techniques in natural language while keeping the draft role-specific and evidence-led.`,
    standoutStrength: "",
  };
}

function resolveEmailCompletionTokenBudget(preferredWordRange: {
  max: number;
}): number {
  // Approximate token budget from word target to avoid truncation on long drafts.
  return Math.max(
    1200,
    Math.min(4000, Math.round(preferredWordRange.max * 2.2)),
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

type EmailDraftResult = {
  subject: string;
  html: string;
};

type DraftQualityAssessment = {
  pass: boolean;
  score: number;
  failures: string[];
  fixInstructions: string;
  standoutStrength: string;
};

function normaliseAssessment(
  raw: Partial<DraftQualityAssessment>,
): DraftQualityAssessment {
  const score = Number.isFinite(raw.score)
    ? Math.max(0, Math.min(100, Math.round(raw.score as number)))
    : 0;

  const failures = Array.isArray(raw.failures)
    ? raw.failures
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const fixInstructions =
    typeof raw.fixInstructions === "string" && raw.fixInstructions.trim()
      ? raw.fixInstructions.trim()
      : "Strengthen specificity, evidence mapping, and commercial impact while keeping British English and Outlook-safe HTML.";

  const standoutStrength =
    typeof raw.standoutStrength === "string" && raw.standoutStrength.trim()
      ? raw.standoutStrength.trim()
      : "";

  const pass =
    raw.pass === true ||
    (score >= 85 && failures.length === 0 && fixInstructions.length < 20);

  return {
    pass,
    score,
    failures,
    fixInstructions,
    standoutStrength,
  };
}

async function assessEmailDraftQuality(params: {
  provider: "github-models" | "azure-openai";
  githubAccessToken?: string;
  companyName: string;
  roleTitle: string;
  jobText: string;
  cvText: string;
  draft: EmailDraftResult;
  preferredLength?: string;
}): Promise<DraftQualityAssessment> {
  const preferredRange = resolvePreferredWordRange(params.preferredLength);
  const systemPrompt =
    "You are an exacting quality reviewer for client-submission emails sent by placement consultants. You score harshly and fail generously. A mediocre agency email should score 40-55. Only a genuinely compelling, evidence-dense, role-specific draft should score above 80. Return strict JSON only.";

  const userPrompt = `Review this draft with the standard of a hiring manager who receives 15 candidate submissions per week and discards most within 10 seconds.

Context:
- Company: ${params.companyName}
- Role: ${params.roleTitle}

JD SOURCE:
${params.jobText}

CV SOURCE:
${params.cvText}

DRAFT SUBJECT:
${params.draft.subject}

DRAFT HTML:
${params.draft.html}

Expected word range:
${preferredRange.label}

Scoring rubric (0-100, be harsh — most agency emails score 40-60):
- Role/company specificity: Would this email break if you swapped the company name? (15)
- Evidence density: How many proof points link a JD requirement to a CV fact to a projected outcome? (20)
- Commercial impact: Does the email project forward to business results, not just list capabilities? (15)
- Opening strength: Does it hook with a specific business problem, not a generic greeting? (10)
- De-risking and urgency: Are both present, specific, and credible? (10)
- Sender company positioning: Is the sender company named and credibly positioned as a trusted partner? (5)
- Distinctive voice: Does it sound like a trusted adviser, not a recruitment template? (5)
- Voss technique execution: Natural integration, not formulaic bolt-on? (10)
- Close decisiveness: Does the close create clear forward momentum with a specific next step? (5)
- British English, structure, and professionalism (5)

Automatic fail criteria (any one triggers pass=false regardless of score):
- Generic agency boilerplate that could apply to any candidate
- Fewer than 3 distinct JD-to-CV evidence connections
- No specific quantities, timeframes, or scale indicators from the CV
- No projected business outcome from any proof point
- Opening uses a banned generic phrase
- Closing is passive ("let me know", "happy to discuss")
- Missing de-risking line or urgency/consequence line
- Sender company is not named or positioned as a trusted partner in the email
- Overblown claims not traceable to JD/CV evidence
- Non-British English spelling
- Empty adjectives ("excellent", "outstanding") without immediate evidence in the same sentence
- Word count outside expected range

Return JSON only with keys:
{"pass":false,"score":0,"failures":[],"fixInstructions":"","standoutStrength":""}

Rules:
- pass=true only if score >= 82 and zero automatic fail criteria are triggered.
- Be specific in failures — name the exact phrase or gap, not vague commentary.
- fixInstructions must be concise, actionable, and prioritised for one regeneration pass.
- standoutStrength: identify the single strongest element worth preserving in regeneration.`;

  const assessed = await generateStructuredJson<
    Partial<DraftQualityAssessment>
  >({
    provider: params.provider,
    githubAccessToken: params.githubAccessToken,
    systemPrompt,
    userPrompt,
    maxTokens: 600,
    temperature: 0,
  });

  return normaliseAssessment(assessed);
}

function buildRegenerationGuidance(assessment: DraftQualityAssessment): string {
  const failureText = assessment.failures.length
    ? assessment.failures.map((item) => `- ${item}`).join("\n")
    : "- No explicit failures listed.";

  return `Quality remediation required before finalising this draft.
Reviewer score: ${assessment.score}/100
Observed weaknesses:
${failureText}
${assessment.standoutStrength ? `Preserve this strength: ${assessment.standoutStrength}` : ""}
Fix instructions:
${assessment.fixInstructions}

Regenerate the draft addressing every listed weakness. The new draft must:
- Fix all listed failures while preserving any noted strengths.
- Include at least 3 distinct JD-requirement → CV-evidence → business-outcome proof points.
- Open with a specific business problem from the JD, not a generic greeting.
- Close with a decisive, specific next step, not a passive sign-off.
- Use British English throughout.
- Keep within the preferred word range.`;
}

async function generateEmailEvidenceContext(params: {
  provider: "github-models" | "azure-openai";
  githubAccessToken?: string;
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

  const result = await generateStructuredJson<Partial<EmailEvidenceContext>>({
    provider: params.provider,
    githubAccessToken: params.githubAccessToken,
    systemPrompt,
    userPrompt,
    maxTokens: 1200,
    temperature: 0,
  });

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
    throw new Error("AI evidence context response is incomplete");
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

export async function POST(request: Request) {
  try {
    const scope = resolveTenantAccessScope(request);
    const tenantId = scope.tenantId;
    const body = emailGenerateSchema.parse(await request.json());
    const selectedProvider =
      body.aiProvider ??
      (process.env.AI_PROVIDER as
        | "auto"
        | "azure-openai"
        | "copilot-studio"
        | "github-models"
        | undefined) ??
      "auto";

    const [job, candidate] = await Promise.all([
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

    const ruleset = body.rulesetId
      ? await prisma.ruleSet.findFirst({
          where: { id: body.rulesetId, tenantId },
        })
      : await prisma.ruleSet.findFirst({
          where: { isDefault: true, tenantId },
        });

    const githubTokenFromCookie = getCookieValue(request, "githubAccessToken");
    const githubTokenFromStore = await readSharedGithubAccessToken();
    const githubToken =
      body.githubAccessToken ??
      githubTokenFromCookie ??
      githubTokenFromStore ??
      process.env.GITHUB_MODELS_TOKEN;

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
    const c2cPartnerPositioning =
      typeof rulesJson.c2c_partner_positioning === "string" &&
      rulesJson.c2c_partner_positioning.trim()
        ? rulesJson.c2c_partner_positioning.trim()
        : undefined;
    const companyType: CompanyType =
      rulesJson.company_type === "support" ? "support" : "placement";
    const emailSystemPrompt = EMAIL_SYSTEM_PROMPT(
      preferredWordRange,
      c2cPartnerPositioning,
      companyType,
    );
    const c2cPartnerName =
      typeof rulesJson.c2c_partner_name === "string" &&
      rulesJson.c2c_partner_name.trim()
        ? rulesJson.c2c_partner_name.trim()
        : (process.env.DEFAULT_C2C_PARTNER_NAME ?? "C2C Partner Ltd");
    const azureConfigured = Boolean(
      process.env.AZURE_OPENAI_ENDPOINT &&
      process.env.AZURE_OPENAI_API_KEY &&
      process.env.AZURE_OPENAI_DEPLOYMENT,
    );
    const githubConfigured = Boolean(githubToken);

    let providerToUse: "azure-openai" | "github-models" | undefined;
    if (selectedProvider === "github-models") {
      if (!githubConfigured) {
        return jsonError(
          "GitHub Models is selected but no token is configured",
          400,
          {
            hint: "Provide githubAccessToken in the request or set GITHUB_MODELS_TOKEN in the app environment.",
          },
        );
      }
      providerToUse = "github-models";
    } else if (selectedProvider === "azure-openai") {
      if (!azureConfigured && githubConfigured) {
        providerToUse = "github-models";
      } else if (!azureConfigured) {
        return jsonError(
          "Azure OpenAI is selected but required environment variables are missing",
          400,
          {
            hint: "Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT in the app environment.",
          },
        );
      }
      providerToUse = "azure-openai";
    } else {
      if (githubConfigured) {
        providerToUse = "github-models";
      } else if (azureConfigured) {
        providerToUse = "azure-openai";
      } else {
        return jsonError(
          "No AI provider is configured for email generation",
          400,
          {
            hint: "Connect GitHub Models or Azure OpenAI in Settings, then generate again.",
          },
        );
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
          jobText: job.rawText,
          candidateText: candidate.rawCV,
          githubAccessToken: githubToken,
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
      provider: providerToUse,
      githubAccessToken:
        providerToUse === "github-models"
          ? (githubToken as string | undefined)
          : undefined,
      jobText: job.rawText,
      cvText: candidate.rawCV,
      roleTitle: effectiveRoleTitle,
    });

    let result: EmailDraftResult | undefined;
    let aiErrorMessage: string | undefined;
    let lastQualityAssessment: DraftQualityAssessment | undefined;

    const maxDraftAttempts = 3;
    for (let attempt = 1; attempt <= maxDraftAttempts; attempt += 1) {
      const generatedPrompt = EMAIL_USER_PROMPT({
        jobDescription: `${job.rawText}\n\nHighlights:\n${evidenceContext.jobHighlights}\n\nMirrored phrase: "${evidenceContext.mirroredPhrase}"`,
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
      });

      const basePrompt = adminCustomPrompt
        ? `${generatedPrompt}\n\nADMIN CUSTOM PROMPT OVERRIDE:\n${adminCustomPrompt}\n\nApply this override exactly as an additional mandatory instruction when generating this draft.`
        : generatedPrompt;

      const userPrompt = lastQualityAssessment
        ? `${basePrompt}\n\n${buildRegenerationGuidance(lastQualityAssessment)}`
        : basePrompt;

      result = undefined;
      aiErrorMessage = undefined;

      try {
        if (providerToUse === "github-models") {
          result = await generateEmailViaGithubModels({
            systemPrompt: emailSystemPrompt,
            userPrompt,
            accessToken: githubToken as string,
            maxOutputTokens,
          });
        } else {
          result = await generateEmail({
            systemPrompt: emailSystemPrompt,
            userPrompt,
            maxOutputTokens,
          });
        }
      } catch (error) {
        aiErrorMessage = (error as Error).message;

        const githubDailyLimitReached =
          providerToUse === "github-models" &&
          /UserByModelByDay|daily request limit/i.test(aiErrorMessage);

        if (githubDailyLimitReached && azureConfigured) {
          try {
            result = await generateEmail({
              systemPrompt: emailSystemPrompt,
              userPrompt,
              maxOutputTokens,
            });
          } catch (azureError) {
            aiErrorMessage = `${aiErrorMessage}\nAzure fallback failed: ${(azureError as Error).message}`;
          }
        }
      }

      if (!result) {
        const providerRateLimitReached =
          aiErrorMessage &&
          /RateLimitReached|\b429\b|UserByModelByDay|UserByModelByMinute|daily request limit|byminute|byday/i.test(
            aiErrorMessage,
          );

        const hint = providerRateLimitReached
          ? "AI provider rate limit reached. Retry shortly or switch provider in Settings."
          : "Fix AI provider configuration or availability, then regenerate.";

        return jsonError("AI email generation failed", 502, {
          provider: providerToUse,
          hint,
          message: aiErrorMessage,
        });
      }

      const draftPlainText = htmlToPlainText(result.html);
      const draftWordCount = countWords(draftPlainText);
      const withinWordRange =
        draftWordCount >= preferredWordRange.min &&
        draftWordCount <= preferredWordRange.max;

      if (!withinWordRange) {
        lastQualityAssessment = buildLengthFailureAssessment({
          rangeLabel: preferredWordRange.label,
          min: preferredWordRange.min,
          max: preferredWordRange.max,
          actual: draftWordCount,
        });
        result = undefined;
        continue;
      }

      const templateSignals = detectTemplateSignals(draftPlainText);
      if (templateSignals.length > 0) {
        lastQualityAssessment = buildTemplateFailureAssessment(templateSignals);
        result = undefined;
        continue;
      }

      const companyPositioning = detectCompanyPositioning(
        draftPlainText,
        c2cPartnerName,
      );
      if (!companyPositioning.mentioned) {
        lastQualityAssessment =
          buildCompanyPositioningFailureAssessment(c2cPartnerName);
        result = undefined;
        continue;
      }

      const vossCoverage = detectVossTechniques(draftPlainText, vossToggles);
      if (vossCoverage.detectedCount < vossCoverage.requiredCount) {
        lastQualityAssessment =
          buildVossCoverageFailureAssessment(vossCoverage);
        result = undefined;
        continue;
      }

      // On the final attempt, accept the draft without AI quality assessment
      // to avoid indefinite waits when the quality gate is too strict.
      if (attempt >= maxDraftAttempts) {
        break;
      }

      const assessment = await assessEmailDraftQuality({
        provider: providerToUse,
        githubAccessToken:
          providerToUse === "github-models"
            ? (githubToken as string | undefined)
            : undefined,
        companyName: job.company?.name ?? "Hiring Team",
        roleTitle: effectiveRoleTitle,
        jobText: job.rawText,
        cvText: candidate.rawCV,
        draft: result,
        preferredLength,
      });

      if (assessment.pass) {
        break;
      }

      lastQualityAssessment = assessment;
      result = undefined;
    }

    if (!result) {
      return jsonError("AI email generation quality gate failed", 502, {
        provider: providerToUse,
        hint: "Draft quality remained below threshold after regeneration attempts.",
        assessment: lastQualityAssessment,
      });
    }

    const generatedFrom = hashInputs(job.rawText, candidate.rawCV, rulesJson);

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

    const autoDraft = await createAutomaticOutlookDraft({
      tenantId,
      companyId: job.companyId,
      subject: result.subject,
      htmlBody: result.html,
      to: parseDraftRecipients(job.opportunityEmail),
      candidateName: candidate.fullName,
      candidateCvText: candidate.rawCV,
      candidateEmail: candidate.email,
      candidatePhone: candidate.phone,
      candidateCvFileName: candidate.cvFileName,
      candidateCvMimeType: candidate.cvMimeType,
      candidateCvFileData: candidate.cvFileData,
    });

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
    return jsonError("Unable to generate email", 400, {
      message: (error as Error).message,
    });
  }
}
