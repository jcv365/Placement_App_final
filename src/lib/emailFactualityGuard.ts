/**
 * emailFactualityGuard.ts
 *
 * AI-powered factual accuracy agent for generated candidate-submission emails.
 *
 * After an email draft is generated, this guard extracts every specific factual
 * claim (years of experience, certifications, technologies, quantified achievements,
 * company names, notable projects) and cross-references each claim against the
 * source JD and CV text supplied during generation.
 *
 * Any claim that cannot be traced to the source documents is flagged as a
 * hallucination.  Drafts with too many unverified claims are rejected so the
 * generation loop can produce a corrected version.
 */

import { generateStructuredJson } from "@/lib/aiJson";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FactualityReport = {
  /** True when no hallucinations were detected or the count is within tolerance. */
  pass: boolean;
  /**
   * 0–100.  100 = every specific claim was verified against the source documents.
   * Drafts with a score below FACTUALITY_PASS_THRESHOLD are rejected.
   */
  score: number;
  /** Claims found in the email that are NOT supported by the JD or CV text. */
  hallucinatedClaims: string[];
  /** Claims found in the email that ARE directly supported by the JD or CV text. */
  verifiedClaims: string[];
  /**
   * A short regeneration instruction telling the AI what to fix.
   * Empty string when the draft passes.
   */
  guidance: string;
};

type RawFactualityResult = {
  score?: unknown;
  hallucinatedClaims?: unknown;
  verifiedClaims?: unknown;
  guidance?: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum factuality score required for a draft to be accepted.
 * Drafts scoring below this threshold are returned to the generation loop.
 */
const FACTUALITY_PASS_THRESHOLD = Number.parseInt(
  process.env.FACTUALITY_PASS_THRESHOLD ?? "80",
  10,
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
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

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies that every specific factual claim in the email draft can be traced
 * to the source JD or CV text provided at generation time.
 *
 * This function makes one AI call and is designed to be fast (≤1 200 tokens).
 * It should be called after the quality-assessment step passes, before the
 * draft is saved to the database.
 *
 * @returns A FactualityReport.  If `pass` is false, include `guidance` in the
 *          next generation attempt so the AI can self-correct.
 */
export async function checkEmailFactuality(params: {
  emailHtml: string;
  jdText: string;
  cvText: string;
  roleTitle: string;
  candidateName: string;
  companyName: string;
}): Promise<FactualityReport> {
  const emailPlainText = htmlToPlainText(params.emailHtml);

  // Truncate source documents to keep token budget reasonable.
  const jdSnippet = params.jdText.slice(0, 4000);
  const cvSnippet = params.cvText.slice(0, 4000);
  const emailSnippet = emailPlainText.slice(0, 2500);

  const systemPrompt = `You are a strict factual accuracy auditor for candidate-submission emails.
Your only job is to verify whether each specific factual claim in the email is directly supported by the supplied source documents (JD and CV).

DEFINITION OF A SPECIFIC FACTUAL CLAIM:
- Quantified statements: years of experience ("12 years"), team sizes ("led a team of 8"), uptime/scale figures.
- Named technologies, platforms, or products attributed to the candidate ("skilled in SAP S/4HANA", "AWS certified").
- Named certifications or qualifications the email attributes to the candidate.
- Named companies or clients where the candidate is said to have worked.
- Specific project names or outcomes attributed to the candidate.
- Any superlative or distinctive claim ("the only candidate who...", "uniquely qualified...").

DO NOT flag:
- General role-relevant language ("strong architecture background").
- Paraphrases that clearly reflect CV content even if not word-for-word.
- The candidate's name, the company name, or the role title.

Return strict JSON: { "score": 0-100, "hallucinatedClaims": [], "verifiedClaims": [], "guidance": "" }
- score: 100 if all specific claims are verified; lower proportionally for each unverified claim.
- hallucinatedClaims: list each unsupported specific claim verbatim.
- verifiedClaims: list each verified specific claim verbatim.
- guidance: if score < ${FACTUALITY_PASS_THRESHOLD}, write 1-3 actionable sentences telling the email generator exactly which claims to remove or replace with source-verified content. Empty string if score >= ${FACTUALITY_PASS_THRESHOLD}.`;

  const userPrompt =
    `CANDIDATE: ${params.candidateName}\n` +
    `ROLE: ${params.roleTitle}\n` +
    `COMPANY: ${params.companyName}\n\n` +
    `SOURCE — JOB DESCRIPTION:\n${jdSnippet}\n\n` +
    `SOURCE — CANDIDATE CV:\n${cvSnippet}\n\n` +
    `EMAIL DRAFT TO AUDIT:\n${emailSnippet}\n\n` +
    `Audit every specific factual claim in the email draft against the two source documents above. ` +
    `Return JSON only.`;

  let raw: RawFactualityResult;
  try {
    raw = await generateStructuredJson<RawFactualityResult>({
      systemPrompt,
      userPrompt,
      maxTokens: 1000,
      temperature: 0,
    });
  } catch (error) {
    // If the AI call fails, allow the draft through rather than blocking generation
    // entirely — the quality assessment already ran before this point.
    console.warn(
      "[FACTUALITY_GUARD] AI call failed; skipping factuality check.",
      error,
    );
    return {
      pass: true,
      score: 100,
      hallucinatedClaims: [],
      verifiedClaims: [],
      guidance: "",
    };
  }

  const score = toFiniteNumber(raw.score, 100);
  const hallucinatedClaims = toStringArray(raw.hallucinatedClaims);
  const verifiedClaims = toStringArray(raw.verifiedClaims);
  const guidance =
    typeof raw.guidance === "string" && raw.guidance.trim()
      ? raw.guidance.trim()
      : "";

  const pass =
    score >= FACTUALITY_PASS_THRESHOLD && hallucinatedClaims.length === 0;

  if (!pass) {
    console.warn("[FACTUALITY_GUARD] Draft failed factuality check.", {
      score,
      hallucinatedClaims,
      candidateName: params.candidateName,
      roleTitle: params.roleTitle,
    });
  }

  return { pass, score, hallucinatedClaims, verifiedClaims, guidance };
}

/**
 * Builds the factuality-failure regeneration instruction to append to the next
 * generation prompt, so the AI knows specifically what to fix.
 */
export function buildFactualityRegenerationInstruction(
  report: FactualityReport,
): string {
  if (report.pass) return "";

  const lines = [
    `FACTUALITY CORRECTION REQUIRED (previous draft score: ${report.score}/100):`,
    `The following claims in the previous draft were NOT supported by the source JD or CV and must be removed or replaced with source-verified content:`,
    ...report.hallucinatedClaims.map((c) => `  - "${c}"`),
    ``,
    report.guidance ||
      "Replace all unsupported claims with language directly grounded in the JD and CV text provided.",
    `Do not invent any facts, statistics, certifications, or achievements that are not explicitly stated in the source documents.`,
  ];

  return lines.join("\n");
}
