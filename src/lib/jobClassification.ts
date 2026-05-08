/**
 * Shared utilities for classifying jobs by remote status and work authorisation requirements.
 * These are used at job creation time to populate structured fields, and at email generation
 * time as gates.
 */

/**
 * Returns true if the job description explicitly requires US work authorisation
 * (USC, Green Card, or equivalent).
 */
export function requiresUsWorkAuthorisation(
  title: string,
  rawText: string,
): boolean {
  const haystack = `${title} ${rawText}`.toLowerCase();
  return /\busc(?:itizen)?\b|\bu\.s\.\s*citizen|\bgreen[\s-]card\b|\bgc[\s-]only\b|\bus[\s-]citizen|must\s+be\s+a\s+us|authorized\s+to\s+work\s+in\s+the\s+us|authorised\s+to\s+work\s+in\s+the\s+us|work\s+authoris(?:ed|ation)\s+in\s+the\s+us|us\s+work\s+authoris|\bead\b|employment\s+authoris(?:ation|ed)\s+document|permanent\s+resident|no\s+sponsor(?:ship)?/.test(
    haystack,
  );
}

/**
 * Returns true if the job description explicitly requires UK work authorisation
 * (right to work in the UK, UK citizenship, indefinite leave to remain, SC Clearance, etc.).
 */
export function requiresUkWorkAuthorisation(
  title: string,
  rawText: string,
): boolean {
  const haystack = `${title} ${rawText}`.toLowerCase();
  return /\buk[\s-]citizen|\bright\s+to\s+work\s+in\s+the\s+uk|uk\s+work\s+authoris|indefinite\s+leave\s+to\s+remain|must\s+be\s+a\s+uk|ilr\b|settled\s+status|pre[\s-]settled\s+status|work\s+permit\s+for\s+the\s+uk|uk\s+visa\b|\bsc[\s-]?clearance\b|\besc[\s-]?clearance\b|\bsecurity[\s-]clearance\b|\bsole\s+uk\s+national\b|\bbpss\b|\bdbs[\s-]check\b|\bnpp[\s-]v[\s-]clearance\b|\bctc[\s-]clearance\b/.test(
    haystack,
  );
}

/**
 * Returns true if the job description contains a geographic location restriction
 * that would disqualify South Africa-based candidates. This catches patterns like:
 * - "must be based in Pune/Bengaluru/Chennai" (India-only)
 * - "based in UK only" / "UK-based only" (UK-only, not already caught by UK auth)
 * - "must be based in Europe" (Europe-only)
 * - "Pan India Remote" (India-only)
 *
 * This does NOT block jobs that say "remote from South Africa" or "UK-based client, remote from SA".
 */
export function requiresNonSaLocationRestriction(
  title: string,
  rawText: string,
): boolean {
  const haystack = `${title} ${rawText}`.toLowerCase();

  // India-specific location requirements
  const indiaPatterns =
    /\bbased\s+in\s+(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata)\b|\bmust\s+be\s+based\s+in\s+(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata|india)\b|\blocation[\s:]*\s*(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata)\b|\bpan\s+india\b|\bwork\s+from\s+office\b.*(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi)/;

  // Europe-specific location requirements (but NOT "remote from SA" or "South Africa")
  const europePatterns =
    /\bmust\s+be\s+based\s+in\s+europe\b|\bbased\s+in\s+(?:the\s+)?uk\s+only\b|\buk[\s-]based\s+only\b|\bbased\s+in\s+(?:the\s+)?eu\b/;

  // UK-only patterns not already caught by requiresUkWorkAuthorisation
  // (e.g. "BASED IN UK ONLY" in all caps, "UK / EU only")
  const ukOnlyPatterns =
    /\bbased\s+in\s+uk\s+only\b|\buk\s*\/\s*eu\s+only\b|\buk\s+only\b|\bmust\s+be\s+(?:based\s+in|resident\s+in)\s+(?:the\s+)?uk\b/;

  return (
    indiaPatterns.test(haystack) ||
    europePatterns.test(haystack) ||
    ukOnlyPatterns.test(haystack)
  );
}

/**
 * Returns true if the job description (title + body) signals a fully remote role.
 */
export function isRemoteRole(title: string, rawText: string): boolean {
  const haystack = `${title} ${rawText}`.toLowerCase();
  return /\bfully[\s-]remote\b|\bremote[\s-]first\b|\bremote[\s-]only\b|\b100%[\s-]remote\b|\bwork[\s-]from[\s-]anywhere\b|\bwork[\s-]from[\s-]home\b|\bwfh\b|\bremote\b/.test(
    haystack,
  );
}

/**
 * Classify a job's remote and work-authorisation fields from its title and raw text.
 * Returns the values to store in the Job model's isRemote, requiresUsWorkAuth,
 * and requiresUkWorkAuth fields.
 */
export function classifyJob(
  title: string,
  rawText: string,
): {
  isRemote: boolean | null;
  requiresUsWorkAuth: boolean | null;
  requiresUkWorkAuth: boolean | null;
  requiresNonSaLocation: boolean | null;
} {
  return {
    isRemote: isRemoteRole(title, rawText) || null,
    requiresUsWorkAuth: requiresUsWorkAuthorisation(title, rawText) || null,
    requiresUkWorkAuth: requiresUkWorkAuthorisation(title, rawText) || null,
    requiresNonSaLocation:
      requiresNonSaLocationRestriction(title, rawText) || null,
  };
}
