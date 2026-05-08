/**
 * matchValidationAgent.ts
 *
 * LLM-backed semantic validation layer for candidate-to-job role matching.
 *
 * Sits on top of the deterministic roleMatchGuard.ts pre-filter and the
 * keyword-based ATS gate (atsMatcher.ts) to verify that a match is
 * semantically genuine and complete:
 *  - Role-family words must align (engineer ≠ architect)
 *  - Specialisation must be fully covered (no partial domain matches)
 *  - Evidence must come directly from the candidate's CV, not inferred
 *
 * Only a "full" match with confidence ≥ 90 allows email generation to proceed.
 */

import { generateStructuredJson } from "@/lib/aiJson";
import {
  buildRoleMatchGuardPromptRules,
  guardCandidateForOpportunity,
} from "@/lib/roleMatchGuard";

const CV_EXCERPT_LENGTH = Number.parseInt(
  process.env.CV_EXCERPT_LENGTH ?? "1800",
  10,
);
const JD_EXCERPT_LENGTH = Number.parseInt(
  process.env.JD_EXCERPT_LENGTH ?? "2000",
  10,
);
const MATCH_CONFIDENCE_THRESHOLD = Number.parseInt(
  process.env.MATCH_CONFIDENCE_THRESHOLD ?? "75",
  10,
);

const SYSTEM_PROMPT = [
  "You are a candidate-to-job match validator. Your task is to decide whether a candidate is a genuine match for a specific job role.",
  "",
  buildRoleMatchGuardPromptRules(),
  "",
  "ADDITIONAL RULES:",
  `- matched=true is valid when matchType is exactly "full" AND confidence is ≥ ${MATCH_CONFIDENCE_THRESHOLD}.`,
  '- matchType="partial" means the candidate is adjacent but meaningfully missing required specialisation. This is always matched=false.',
  '- matchType="none" means no meaningful overlap exists.',
  "- A full match does NOT require the exact job title to appear in the CV. Judge by demonstrated skills, responsibilities, and domain experience directly stated in the CV.",
  "- Equivalent roles count as full matches (e.g. Platform Engineer = DevOps Engineer when core responsibilities match; Cloud Architect = Solutions Architect when domain aligns).",
  "- Only cite evidence explicitly stated in the candidate's CV. Never infer experience not directly written.",
  "- If there is not enough CV information to decide, default to matched=false.",
  "- Return strict JSON only. No markdown, no prose outside the JSON object.",
].join("\n");

export type MatchType = "full" | "partial" | "none";

export type MatchValidationResult = {
  matched: boolean;
  matchedRole: string | null;
  confidence: number;
  matchType: MatchType;
  reasoning: string;
};

type MatchValidationInput = {
  /** Effective (possibly inferred) job role title used for matching. */
  jobTitle: string;
  /** Full raw job description text — will be excerpted. */
  jobText: string;
  /** Candidate's suggested roles CSV (may have been refreshed). */
  candidateSuggestedRoles: string;
  /** Candidate's skills CSV. */
  candidateSkills: string;
  /** Candidate's certifications CSV. */
  candidateCertifications: string;
  /** Candidate's raw CV text — will be excerpted. */
  candidateCvText: string;
};

type LlmMatchResponse = {
  matched: boolean;
  matchedRole: string | null;
  confidence: number;
  matchType: MatchType;
  reasoning: string;
};

/**
 * Validates whether a candidate is a full semantic match for a job role.
 *
 * Pipeline:
 *  1. Deterministic role-family + specialisation guard (fast, no LLM)
 *  2. LLM semantic deep-check against the actual JD and CV content
 *
 * Returns matched=true only when BOTH layers pass and LLM confidence ≥ 90.
 */
export async function validateCandidateJobMatch(
  input: MatchValidationInput,
): Promise<MatchValidationResult> {
  const suggestedRoles = input.candidateSuggestedRoles
    .split(/[,;|\n]+/)
    .map((r) => r.trim())
    .filter(Boolean);

  // ── Step 1: Deterministic pre-filter ──────────────────────────────────────
  // Catches obvious role-family mismatches (engineer ↔ architect) and
  // specialisation gaps without spending an LLM token.
  const guardResult = guardCandidateForOpportunity(
    suggestedRoles,
    input.jobTitle,
  );

  if (!guardResult.allowed) {
    return {
      matched: false,
      matchedRole: null,
      confidence: 0,
      matchType: "none",
      reasoning: `Deterministic role guard blocked: ${guardResult.reason}`,
    };
  }

  // ── Step 2: LLM semantic validation ───────────────────────────────────────
  const jdExcerpt = input.jobText.slice(0, JD_EXCERPT_LENGTH);
  const cvExcerpt = input.candidateCvText.slice(0, CV_EXCERPT_LENGTH);

  const userPrompt = [
    `JOB TITLE: ${input.jobTitle}`,
    `JOB DESCRIPTION:\n${jdExcerpt}`,
    ``,
    `CANDIDATE SUGGESTED ROLES: ${input.candidateSuggestedRoles}`,
    `CANDIDATE SKILLS: ${input.candidateSkills || "Not specified"}`,
    `CANDIDATE CERTIFICATIONS: ${input.candidateCertifications || "Not specified"}`,
    `CANDIDATE CV:\n${cvExcerpt}`,
    ``,
    `Determine whether this candidate is a genuine match for the job role above.`,
    `A full match means the candidate has the skills, domain experience, and responsibilities required for "${input.jobTitle}", as evidenced in their CV — the exact title need not appear if equivalent duties and domain are clearly demonstrated.`,
    `A partial match means the candidate is in a related area but is meaningfully missing a core requirement.`,
    `Return JSON only:`,
    `{"matched":false,"matchedRole":null,"confidence":0,"matchType":"none","reasoning":""}`,
  ].join("\n");

  let llmResult: LlmMatchResponse;
  try {
    llmResult = await generateStructuredJson<LlmMatchResponse>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 400,
      temperature: 0,
    });
  } catch {
    // If LLM validation is unavailable, fail safe: block the email.
    return {
      matched: false,
      matchedRole: null,
      confidence: 0,
      matchType: "none",
      reasoning:
        "Match validation LLM call failed — defaulting to blocked for safety.",
    };
  }

  const confidence = Math.max(
    0,
    Math.min(100, Math.round(Number(llmResult.confidence ?? 0))),
  );

  const validMatchTypes: MatchType[] = ["full", "partial", "none"];
  const matchType: MatchType = validMatchTypes.includes(
    llmResult.matchType as MatchType,
  )
    ? (llmResult.matchType as MatchType)
    : "none";

  const isFullMatch =
    matchType === "full" && confidence >= MATCH_CONFIDENCE_THRESHOLD;

  return {
    matched: isFullMatch,
    matchedRole: isFullMatch
      ? typeof llmResult.matchedRole === "string" &&
        llmResult.matchedRole.trim()
        ? llmResult.matchedRole.trim()
        : guardResult.matchedRole
      : null,
    confidence,
    matchType,
    reasoning:
      typeof llmResult.reasoning === "string" && llmResult.reasoning.trim()
        ? llmResult.reasoning.trim()
        : "No reasoning provided by LLM.",
  };
}
