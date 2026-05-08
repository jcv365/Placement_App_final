/**
 * roleMatchGuard.ts
 *
 * Deterministic pre-validation layer for candidate-to-opportunity role matching.
 *
 * Prevents two known hallucination patterns:
 *  1. Role-family mismatch  – e.g. "Network Engineer" recommended for "Architect" position.
 *  2. Specialisation gap    – e.g. "Enterprise Architect" matched to "Enterprise Infrastructure
 *                             Architect" despite the critical "Infrastructure" domain being absent.
 *
 * The guard is intentionally conservative: it is a first-pass filter before the AI step.
 * Any candidate that passes the guard is still subject to the AI confidence threshold (≥90).
 */

/** Primary role-type nouns.  Two roles must share at least one of these to be compatible. */
const ROLE_FAMILY_WORDS = new Set([
  // Classic
  "architect",
  "developer",
  "engineer",
  "programmer",
  "analyst",
  "administrator",
  "manager",
  "consultant",
  "specialist",
  "officer",
  "designer",
  "scientist",
  "technician",
  "coordinator",
  "director",
  "executive",
  // Modern IT / cloud-native roles
  "sre",
  "devops",
  "operator",
  "practitioner",
  "engineer",
  "writer",
  "tester",
  "trainer",
  "researcher",
  "steward",
  "evangelist",
  "strategist",
  "coach",
  "owner",
  "master",
  // Executive / leadership
  "cto",
  "ciso",
  "cio",
  "vp",
  "president",
]);

/**
 * Seniority / level qualifiers.  These are excluded from both the family check and
 * the specialisation-coverage calculation because they carry no domain information.
 */
const SENIORITY_WORDS = new Set([
  "senior",
  "junior",
  "lead",
  "principal",
  "chief",
  "associate",
  "graduate",
  "staff",
  "mid",
  "entry",
  "intermediate",
  "expert",
  "head",
  "deputy",
  "assistant",
  // Additional modern seniority qualifiers
  "founding",
  "group",
  "regional",
  "global",
  "practice",
  "distinguished",
  "emeritus",
  "honorary",
  // Engagement-type qualifiers — describe the engagement model, not the domain
  "advisory",
  "strategic",
  "business",
  "dex",
  "digital",
  "transformation",
]);

/**
 * Minimum fraction of the opportunity's specialisation tokens that must appear in the
 * candidate's role title for the match to be allowed.  Configurable via the
 * ROLE_COVERAGE_THRESHOLD environment variable (0–1). Defaults to 0.75.
 */
const SPECIALISATION_COVERAGE_THRESHOLD = (() => {
  const env = parseFloat(process.env.ROLE_COVERAGE_THRESHOLD ?? "");
  return Number.isFinite(env) && env > 0 && env <= 1 ? env : 0.75;
})();

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Compound-word expansions applied before tokenising. */
const COMPOUND_EXPANSIONS: Array<[RegExp, string]> = [
  [/\bfrontend\b/gi, "front end"],
  [/\bfront-end\b/gi, "front end"],
  [/\bbackend\b/gi, "back end"],
  [/\bback-end\b/gi, "back end"],
  [/\bfullstack\b/gi, "full stack"],
  [/\bfull-stack\b/gi, "full stack"],
];

/** Noise phrases stripped from opportunity titles before analysis. */
const TITLE_NOISE_PHRASES = [
  /\bmultiple\s+roles?\b/gi,
  /\band\s+above\b/gi,
  /\bor\s+similar\b/gi,
  /\(.*?\)/g,
];

function normalise(text: string): string {
  let t = text;
  for (const [pattern, replacement] of COMPOUND_EXPANSIONS) {
    t = t.replace(pattern, replacement);
  }
  return t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTitleNoise(text: string): string {
  let t = text;
  for (const pattern of TITLE_NOISE_PHRASES) {
    t = t.replace(pattern, " ");
  }
  return t.replace(/\s+/g, " ").trim();
}

function tokenise(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((t) => t.length >= 3);
}

function extractFamilyWords(roleTitle: string): Set<string> {
  const family = new Set<string>();
  for (const token of tokenise(roleTitle)) {
    if (ROLE_FAMILY_WORDS.has(token)) {
      family.add(token);
    }
  }
  return family;
}

/**
 * Returns the "meaningful" tokens from a role title: everything that is not a
 * seniority qualifier and not a role-family word.  These represent the domain
 * and specialisation the role actually requires (e.g. "infrastructure", "network",
 * "solutions", "data", etc.).
 */
function extractSpecialisationTokens(roleTitle: string): string[] {
  return tokenise(roleTitle).filter(
    (t) => !SENIORITY_WORDS.has(t) && !ROLE_FAMILY_WORDS.has(t),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export type RoleGuardResult =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string; failureType: RoleGuardFailureType };

export type RoleGuardFailureType = "family_mismatch" | "specialisation_gap";

/**
 * Determines whether a single candidate role title is compatible with an
 * opportunity role title.
 *
 * @example
 *   guardRoleMatch("Enterprise Infrastructure Architect", "Enterprise Architect")
 *   // → { allowed: false, failureType: "specialisation_gap", reason: "..." }
 *
 *   guardRoleMatch("Network Architect", "Network Engineer")
 *   // → { allowed: false, failureType: "family_mismatch", reason: "..." }
 *
 *   guardRoleMatch("Enterprise Infrastructure Architect", "Senior Enterprise Infrastructure Architect")
 *   // → { allowed: true, reason: "..." }
 */
export function guardRoleMatch(
  opportunityRole: string,
  candidateRole: string,
): RoleGuardResult {
  // Strip noise phrases (e.g. "Multiple Roles", "and above") from the opportunity
  // title before analysis — they produce spurious specialisation tokens.
  const cleanedOppRole = stripTitleNoise(opportunityRole);
  const oppFamily = extractFamilyWords(cleanedOppRole);
  const candFamily = extractFamilyWords(candidateRole);

  // Step 1 – Role-family check.
  // If the opportunity names a recognised role-type noun, the candidate MUST share it.
  if (oppFamily.size > 0) {
    const sharedFamily = [...oppFamily].filter((w) => candFamily.has(w));

    if (sharedFamily.length === 0) {
      return {
        allowed: false,
        failureType: "family_mismatch",
        reason:
          `Role-family mismatch: the opportunity requires [${[...oppFamily].join(", ")}] ` +
          `but candidate role "${candidateRole}" belongs to [${candFamily.size > 0 ? [...candFamily].join(", ") : "unknown family"}]. ` +
          `An engineer is not an architect; a developer is not an analyst.`,
      };
    }
  }

  // Step 2 – Specialisation-coverage check.
  // The opportunity may specify a domain or system category beyond the family word
  // (e.g. "Infrastructure", "Network", "Solutions", "Data").  The candidate's role
  // must cover at least SPECIALISATION_COVERAGE_THRESHOLD of those tokens.
  //
  // Uppercase acronyms (e.g. "SRE", "AWS", "API") are excluded from the lexical
  // specialisation check — they are opaque to string matching and are handled by
  // the downstream LLM validation step instead.
  const acronymTokens = new Set(
    (opportunityRole.match(/\b[A-Z]{2,}\b/g) ?? []).map((a) => a.toLowerCase()),
  );
  const oppSpecialisation = extractSpecialisationTokens(opportunityRole).filter(
    (t) => !acronymTokens.has(t),
  );

  if (oppSpecialisation.length > 0) {
    const candTokens = new Set(tokenise(candidateRole));
    const covered = oppSpecialisation.filter((t) => candTokens.has(t));
    const coverageRatio = covered.length / oppSpecialisation.length;

    if (coverageRatio < SPECIALISATION_COVERAGE_THRESHOLD) {
      const missing = oppSpecialisation.filter((t) => !candTokens.has(t));
      return {
        allowed: false,
        failureType: "specialisation_gap",
        reason:
          `Specialisation gap: opportunity "${opportunityRole}" requires domain tokens ` +
          `[${oppSpecialisation.join(", ")}], but candidate role "${candidateRole}" ` +
          `only covers [${covered.join(", ") || "none"}] ` +
          `(${Math.round(coverageRatio * 100)}% — minimum ${Math.round(SPECIALISATION_COVERAGE_THRESHOLD * 100)}% required). ` +
          `Missing: [${missing.join(", ")}].`,
      };
    }
  }

  return {
    allowed: true,
    reason: `Role titles are compatible: "${candidateRole}" covers the required family and domain of "${opportunityRole}".`,
  };
}

export type CandidateGuardResult =
  | { allowed: true; matchedRole: string; reason: string }
  | {
      allowed: false;
      matchedRole: null;
      reason: string;
      failedRoles: Array<{ role: string; failureType: RoleGuardFailureType }>;
    };

/**
 * Checks whether ANY of a candidate's suggested roles is compatible with the
 * opportunity role.  Returns immediately on the first allowed role found.
 *
 * Use this as the deterministic pre-filter before the AI matching step.
 */
export function guardCandidateForOpportunity(
  candidateSuggestedRoles: string[],
  opportunityRole: string,
): CandidateGuardResult {
  // Handle compound/alternative titles joined by "/" (e.g. "Infrastructure Engineer/ SRE").
  // A candidate that passes the guard for ANY alternative is considered compatible;
  // the LLM step then makes the final semantic determination.
  const opportunityAlternatives = opportunityRole
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const failedRoles: Array<{
    role: string;
    failureType: RoleGuardFailureType;
  }> = [];

  for (const candidateRole of candidateSuggestedRoles) {
    let firstFailureType: RoleGuardFailureType | undefined;

    for (const oppAlt of opportunityAlternatives) {
      const result = guardRoleMatch(oppAlt, candidateRole);
      if (result.allowed) {
        return {
          allowed: true,
          matchedRole: candidateRole,
          reason: result.reason,
        };
      }
      firstFailureType ??= result.failureType;
    }

    failedRoles.push({
      role: candidateRole,
      failureType: firstFailureType!,
    });
  }

  const oppFamily = [...extractFamilyWords(opportunityRole)];

  return {
    allowed: false,
    matchedRole: null,
    reason:
      `None of the candidate's suggested roles [${candidateSuggestedRoles.join(", ")}] ` +
      `are compatible with the opportunity "${opportunityRole}" ` +
      `(required family: [${oppFamily.join(", ")}]).`,
    failedRoles,
  };
}

/**
 * Builds a human-readable description of the role guard rules for use inside
 * AI system prompts.  Describes the semantic intent rather than listing specific
 * hardcoded vocabulary so the LLM applies the rule correctly to any role title.
 */
export function buildRoleMatchGuardPromptRules(): string {
  return `STRICT ROLE-MATCHING RULES (NON-NEGOTIABLE):
1. Role-type nouns MUST be semantically equivalent between the opportunity and the candidate's role history. An engineer is NEVER compatible with an architect position, even if they share the same domain. A developer is not an analyst. A manager is not a specialist.
2. Specialisation matters: "Enterprise Infrastructure Architect" is NOT the same as "Enterprise Architect". The missing "Infrastructure" domain is a disqualifying gap. Read every modifier in the opportunity role title as a hard requirement.
3. Seniority or level qualifiers (senior, lead, junior, principal, founding, group, regional, etc.) do NOT relax the role-type or specialisation requirements.
4. When in doubt, set match=false. A false negative (missed match) is far less harmful than a false positive (wrong recommendation).
5. Confidence must reflect precision: only set confidence ≥ 85 when the candidate's exact role history or clearly equivalent title is documented in the CV.`;
}
