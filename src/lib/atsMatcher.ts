type AtsDecision = "PASS" | "REVIEW" | "FLAGGED";

type AtsFlagSeverity = "LOW" | "MEDIUM" | "HIGH";

type AtsFlagCode =
  | "MISSING_EMAIL"
  | "MISSING_PHONE"
  | "LOW_KEYWORD_COVERAGE"
  | "MISSING_CORE_KEYWORDS"
  | "ROLE_MISMATCH"
  | "WEAK_CV_STRUCTURE"
  | "VERY_SHORT_CV";

export type AtsFlag = {
  code: AtsFlagCode;
  severity: AtsFlagSeverity;
  message: string;
};

export type AtsMatchBreakdown = {
  keywordCoverage: number;
  roleAlignment: number;
  sectionCoverage: number;
  contactCompleteness: number;
  cvLengthScore: number;
};

export type AtsMatchResult = {
  score: number;
  decision: AtsDecision;
  summary: string;
  matchedKeywords: string[];
  missingKeywords: string[];
  flags: AtsFlag[];
  fixes: AtsFixRecommendation[];
  breakdown: AtsMatchBreakdown;
};

export type AtsFixRecommendation = {
  id:
    | "ADD_EMAIL"
    | "ADD_PHONE"
    | "ADD_MISSING_KEYWORDS"
    | "VERIFY_ROLE_ALIGNMENT"
    | "IMPROVE_STRUCTURE"
    | "EXPAND_CV_DETAIL";
  title: string;
  details: string;
  targetArea: "CONTACT" | "SKILLS" | "EXPERIENCE" | "STRUCTURE";
  aiFixable: boolean;
};

export type AtsMatchInput = {
  cvText: string;
  jobText: string;
  candidateEmail?: string | null;
  candidatePhone?: string | null;
  skillsCsv?: string | null;
  certificationsCsv?: string | null;
  suggestedRolesCsv?: string | null;
  topKeywordLimit?: number;
};

const DEFAULT_TOP_KEYWORD_LIMIT = 16;
export const ATS_MIN_SAFE_EMAIL_SCORE = 85;
const ATS_ROLE_ALIGNMENT_WEAK_CAP = ATS_MIN_SAFE_EMAIL_SCORE - 1;

const ROLE_FAMILIES: Array<{ family: string; keywords: string[] }> = [
  {
    family: "security",
    keywords: [
      "security",
      "cyber",
      "soc",
      "siem",
      "iam",
      "infosec",
      "zero trust",
      "threat",
      "iso27001",
    ],
  },
  {
    family: "network",
    keywords: [
      "network",
      "routing",
      "switching",
      "firewall",
      "sdwan",
      "wan",
      "lan",
      "cisco",
      "palo alto",
    ],
  },
  {
    family: "devops",
    keywords: [
      "devops",
      "sre",
      "platform engineer",
      "ci/cd",
      "cicd",
      "kubernetes",
      "docker",
      "terraform",
      "ansible",
      "jenkins",
      "gitops",
    ],
  },
  {
    family: "cloud",
    keywords: [
      "cloud",
      "aws",
      "azure",
      "gcp",
      "cloud architect",
      "solution architect",
      "data center",
      "datacenter",
    ],
  },
  {
    family: "data",
    keywords: [
      "data engineer",
      "data architect",
      "data platform",
      "etl",
      "warehouse",
      "analytics",
      "power bi",
      "sql",
      "spark",
      "databricks",
    ],
  },
  {
    family: "software",
    keywords: [
      "software engineer",
      "developer",
      "backend",
      "frontend",
      "full stack",
      "java",
      "dotnet",
      "nodejs",
      "python",
      "typescript",
    ],
  },
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "this",
  "to",
  "we",
  "with",
  "you",
  "your",
  "will",
  "must",
  "should",
  "can",
  "could",
  "would",
  "role",
  "candidate",
  "experience",
  "team",
  "work",
  "working",
  "years",
  "skills",
  "required",
  "essential",
  "strong",
  "knowledge",
  "using",
  "ability",
  "excellent",
  "good",
]);

// Terms that appear in JDs but are logistics / admin / location noise, not technology signals.
const EXTENDED_NOISE_WORDS = new Set([
  // Contract & logistics
  "contract",
  "contracts",
  "contracting",
  "contractor",
  "contractors",
  "remote",
  "hybrid",
  "onsite",
  "office",
  "days",
  "month",
  "months",
  "week",
  "weeks",
  "rate",
  "rates",
  "ir35",
  "b2b",
  "umbrella",
  "rolling",
  "permanent",
  "freelance",
  "salary",
  "budget",
  "hourly",
  "daily",
  "annual",
  "compensation",
  // Location & geopolitical
  "london",
  "uk",
  "europe",
  "european",
  "america",
  "american",
  "africa",
  "african",
  "global",
  "globally",
  "worldwide",
  "international",
  "based",
  "onshore",
  "offshore",
  // Recruiting & admin noise
  "recruiting",
  "recruiter",
  "recruiters",
  "recruitment",
  "hiring",
  "posting",
  "repost",
  "seeking",
  "currently",
  "basis",
  "opening",
  "openings",
  "please",
  "send",
  "confidential",
  "comments",
  "applicants",
  "applicant",
  "positions",
  "vacancy",
  "vacancies",
  "opportunities",
  "opportunity",
  // Vague qualifiers that carry no tech signal
  "higher",
  "growing",
  "join",
  "building",
  "delivering",
  "driving",
  "helping",
  "supporting",
  "enabling",
  "managing",
  "responsible",
  "relevant",
  "ideally",
  "preferred",
  "desired",
  "bonus",
  "advantageous",
  "beneficial",
  "scaling",
  // Generic vague words that add no tech signal
  "fully",
  "being",
  "end",
  "best",
  "its",
  "what",
  "direction",
  "engagement",
  "organisation",
  "organization",
  "roles",
  "engineers",
  "consultancy",
  "inside",
  "outside",
  "across",
  "within",
  "through",
  "including",
]);

// Pattern-based noise: ordinals, rate-ranges, duration strings,
// email/domain fragments, and hyphenated location/buzzword compounds.
const NOISE_TOKEN_PATTERNS = [
  /^\d+(st|nd|rd|th)\+?$/i, // 1st, 2nd, 3rd+, 4th
  /^\d+[-\/]/, // 450-550/day, 6-month, 3-month
  /^\d{3,}$/, // standalone rate numbers: 550, 600, 1500
  /\.(com|co|io|org|africa|za|uk)$/i, // email/domain fragments
  /-(based|aligned|focused|facing|heavy)$/i, // uk-based, nato-aligned, aws-heavy
];

function isNoiseToken(token: string): boolean {
  return (
    EXTENDED_NOISE_WORDS.has(token) ||
    NOISE_TOKEN_PATTERNS.some((p) => p.test(token))
  );
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normaliseWhitespace(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function canonicaliseToken(rawToken: string): string {
  const token = rawToken.trim().toLowerCase();

  if (!token) {
    return "";
  }

  return token
    .replace(/^\.net$/g, "dotnet")
    .replace(/^net$/g, "dotnet")
    .replace(/^node\.js$/g, "nodejs")
    .replace(/^react\.js$/g, "react")
    .replace(/^c#$/g, "csharp")
    .replace(/^c\+\+$/g, "cplusplus")
    .replace(/^ci\/cd$/g, "cicd")
    .replace(/[^a-z0-9+#.\-/]/g, "")
    .replace(/\.$/, "");
}

function tokenise(text: string): string[] {
  const normalised = text
    .replace(/\.net\b/gi, " dotnet ")
    .replace(/\bc#\b/gi, " csharp ")
    .replace(/\bc\+\+\b/gi, " cplusplus ")
    .replace(/\bnode\.js\b/gi, " nodejs ")
    .replace(/\breact\.js\b/gi, " react ")
    .replace(/\bci\/cd\b/gi, " cicd ");

  const tokens = normalised.match(/[a-z0-9][a-z0-9+#.\-/]{1,}/gi) ?? [];

  return tokens
    .map((token) => canonicaliseToken(token))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function buildKeywordWeights(jobText: string): Map<string, number> {
  const weights = new Map<string, number>();
  const lines = jobText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const mustHaveLine =
    /(must|required|essential|mandatory|need to have|minimum|proficien|hands[-\s]?on|strong knowledge)/i;

  for (const token of tokenise(jobText)) {
    if (token.length < 3 && !/[+#]/.test(token)) {
      continue;
    }
    if (isNoiseToken(token)) {
      continue;
    }
    weights.set(token, (weights.get(token) ?? 0) + 1);
  }

  for (const line of lines) {
    if (!mustHaveLine.test(line)) {
      continue;
    }

    for (const token of tokenise(line)) {
      if (token.length < 3 && !/[+#]/.test(token)) {
        continue;
      }
      if (isNoiseToken(token)) {
        continue;
      }
      weights.set(token, (weights.get(token) ?? 0) + 2);
    }
  }

  return weights;
}

function getTopKeywords(jobText: string, limit: number): string[] {
  const weighted = Array.from(buildKeywordWeights(jobText).entries());

  return weighted
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([keyword]) => keyword);
}

function hasEmail(text: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
}

function hasPhone(text: string): boolean {
  return /\+?\d[\d\s\-()]{7,}\d/.test(text);
}

function buildSectionCoverage(cvText: string): number {
  const signals = [
    /\b(summary|profile|objective)\b/i,
    /\b(skills?|technologies|stack|tools?)\b/i,
    /\b(experience|employment|work history|projects?)\b/i,
    /\b(education|degree|university|college|certifications?)\b/i,
  ];

  const matched = signals.filter((pattern) => pattern.test(cvText)).length;
  return matched / signals.length;
}

function buildLengthScore(wordCount: number): number {
  if (wordCount >= 250 && wordCount <= 1200) {
    return 10;
  }
  if (wordCount >= 120 && wordCount <= 1800) {
    return 6;
  }
  return 2;
}

function detectRoleFamilies(text: string): Set<string> {
  const haystack = text.toLowerCase();
  const families = new Set<string>();

  for (const family of ROLE_FAMILIES) {
    for (const keyword of family.keywords) {
      if (haystack.includes(keyword)) {
        families.add(family.family);
        break;
      }
    }
  }

  return families;
}

function computeRoleAlignment(params: {
  jobText: string;
  cvText: string;
  suggestedRolesCsv?: string | null;
}): { score: number; mismatch: boolean } {
  const jobFamilies = detectRoleFamilies(params.jobText);
  const candidateFamilies = detectRoleFamilies(
    [params.cvText, params.suggestedRolesCsv ?? ""].join("\n"),
  );

  if (jobFamilies.size === 0 || candidateFamilies.size === 0) {
    return { score: 0.5, mismatch: false };
  }

  const overlap = [...jobFamilies].filter((family) =>
    candidateFamilies.has(family),
  ).length;
  const score = overlap / Math.max(1, jobFamilies.size);

  return {
    score,
    mismatch: overlap === 0,
  };
}

function buildDecision(score: number, flags: AtsFlag[]): AtsDecision {
  const hasLowCoverageHighRisk = flags.some(
    (flag) => flag.code === "LOW_KEYWORD_COVERAGE" && flag.severity === "HIGH",
  );
  const hasRoleMismatch = flags.some(
    (flag) => flag.code === "ROLE_MISMATCH" && flag.severity === "HIGH",
  );

  if (score < 45 || hasLowCoverageHighRisk || hasRoleMismatch) {
    return "FLAGGED";
  }
  if (score < 70) {
    return "REVIEW";
  }
  return "PASS";
}

function buildSummary(
  score: number,
  decision: AtsDecision,
  keywordCoverage: number,
  roleAlignment: number,
  matchedCount: number,
  missingCount: number,
): string {
  const coveragePct = Math.round(keywordCoverage * 100);
  const rolePct = Math.round(roleAlignment * 100);

  if (decision === "PASS") {
    return `Strong ATS alignment (${score}/100). Keyword coverage is ${coveragePct}% with role alignment ${rolePct}%. ${matchedCount} core terms matched.`;
  }

  if (decision === "REVIEW") {
    return `Moderate ATS alignment (${score}/100). Coverage is ${coveragePct}% and role alignment is ${rolePct}%. ${missingCount} core terms should be strengthened.`;
  }

  return `High ATS risk (${score}/100). Coverage is ${coveragePct}% and role alignment is ${rolePct}% with significant mismatch/gap risk.`;
}

function buildFixRecommendations(params: {
  flags: AtsFlag[];
  missingKeywords: string[];
  sectionCoverage: number;
  wordCount: number;
}): AtsFixRecommendation[] {
  const fixes: AtsFixRecommendation[] = [];
  const hasFlag = (code: AtsFlagCode) =>
    params.flags.some((flag) => flag.code === code);

  if (hasFlag("MISSING_EMAIL")) {
    fixes.push({
      id: "ADD_EMAIL",
      title: "Add a professional email",
      details:
        "Include a professional email address in the candidate profile and CV header.",
      targetArea: "CONTACT",
      aiFixable: true,
    });
  }

  if (hasFlag("MISSING_PHONE")) {
    fixes.push({
      id: "ADD_PHONE",
      title: "Add a contact number",
      details:
        "Include an active contact number in the candidate profile and CV header.",
      targetArea: "CONTACT",
      aiFixable: true,
    });
  }

  if (
    hasFlag("LOW_KEYWORD_COVERAGE") ||
    hasFlag("MISSING_CORE_KEYWORDS") ||
    params.missingKeywords.length > 0
  ) {
    const suggestedKeywords = params.missingKeywords.slice(0, 6).join(", ");
    fixes.push({
      id: "ADD_MISSING_KEYWORDS",
      title: "Improve role keyword coverage",
      details: suggestedKeywords
        ? `Strengthen evidence for these terms where relevant: ${suggestedKeywords}.`
        : "Strengthen role-specific technical terms across skills and experience bullets.",
      targetArea: "SKILLS",
      aiFixable: true,
    });
  }

  if (hasFlag("ROLE_MISMATCH")) {
    fixes.push({
      id: "VERIFY_ROLE_ALIGNMENT",
      title: "Verify role alignment before submission",
      details:
        "Candidate profile appears to target a different discipline than this opportunity. Review suggested roles and confirm role-family alignment.",
      targetArea: "EXPERIENCE",
      aiFixable: false,
    });
  }

  if (hasFlag("WEAK_CV_STRUCTURE") || params.sectionCoverage < 0.5) {
    fixes.push({
      id: "IMPROVE_STRUCTURE",
      title: "Use ATS-friendly sections",
      details:
        "Ensure clear sections for Summary, Skills, Experience, and Education/Certifications.",
      targetArea: "STRUCTURE",
      aiFixable: true,
    });
  }

  if (hasFlag("VERY_SHORT_CV") || params.wordCount < 180) {
    fixes.push({
      id: "EXPAND_CV_DETAIL",
      title: "Add more measurable project detail",
      details:
        "Expand recent role entries with measurable outcomes, tools used, and delivery scope.",
      targetArea: "EXPERIENCE",
      aiFixable: true,
    });
  }

  return fixes;
}

export function matchCvAgainstAts(input: AtsMatchInput): AtsMatchResult {
  const cvText = normaliseWhitespace(input.cvText ?? "");
  const jobText = normaliseWhitespace(input.jobText ?? "");

  if (cvText.length < 40) {
    throw new Error("CV text is too short to run ATS matching.");
  }

  if (jobText.length < 40) {
    throw new Error("Job text is too short to run ATS matching.");
  }

  const topKeywordLimit = Math.max(
    8,
    Math.min(40, input.topKeywordLimit ?? DEFAULT_TOP_KEYWORD_LIMIT),
  );
  const requiredKeywords = getTopKeywords(jobText, topKeywordLimit);
  const profileEvidence = [
    input.skillsCsv ?? "",
    input.certificationsCsv ?? "",
    input.suggestedRolesCsv ?? "",
  ]
    .join("\n")
    .trim();
  const cvTokenSet = new Set(
    tokenise([cvText, profileEvidence].filter(Boolean).join("\n")),
  );

  const matchedKeywords = requiredKeywords.filter((keyword) =>
    cvTokenSet.has(keyword),
  );
  const missingKeywords = requiredKeywords.filter(
    (keyword) => !cvTokenSet.has(keyword),
  );
  const keywordCoverage =
    requiredKeywords.length === 0
      ? 0
      : matchedKeywords.length / requiredKeywords.length;

  const sectionCoverage = buildSectionCoverage(cvText);
  const roleAlignment = computeRoleAlignment({
    jobText,
    cvText,
    suggestedRolesCsv: input.suggestedRolesCsv,
  });
  const candidateHasEmail =
    Boolean(input.candidateEmail?.trim()) || hasEmail(cvText);
  const candidateHasPhone =
    Boolean(input.candidatePhone?.trim()) || hasPhone(cvText);
  const contactCompleteness =
    [candidateHasEmail, candidateHasPhone].filter(Boolean).length / 2;
  const wordCount = cvText.split(/\s+/).filter(Boolean).length;
  const cvLengthScore = buildLengthScore(wordCount);

  const score = clampScore(
    keywordCoverage * 50 +
      roleAlignment.score * 20 +
      sectionCoverage * 15 +
      contactCompleteness * 10 +
      cvLengthScore * 0.5,
  );

  const roleAlignmentWeak = roleAlignment.score < 0.5;
  const finalScore = roleAlignmentWeak
    ? Math.min(score, ATS_ROLE_ALIGNMENT_WEAK_CAP)
    : score;

  const flags: AtsFlag[] = [];

  if (!candidateHasEmail) {
    flags.push({
      code: "MISSING_EMAIL",
      severity: "MEDIUM",
      message: "No candidate email found in profile or CV text.",
    });
  }

  if (!candidateHasPhone) {
    flags.push({
      code: "MISSING_PHONE",
      severity: "MEDIUM",
      message: "No candidate phone number found in profile or CV text.",
    });
  }

  if (keywordCoverage < 0.28) {
    flags.push({
      code: "LOW_KEYWORD_COVERAGE",
      severity: "HIGH",
      message: "Core ATS keyword coverage is below 28%.",
    });
  }

  if (missingKeywords.length >= 4 && keywordCoverage < 0.5) {
    flags.push({
      code: "MISSING_CORE_KEYWORDS",
      severity:
        missingKeywords.length >= 7 && keywordCoverage < 0.25
          ? "HIGH"
          : "MEDIUM",
      message: `Missing ${missingKeywords.length} core keyword${missingKeywords.length === 1 ? "" : "s"} required by the role.`,
    });
  }

  if (roleAlignment.mismatch) {
    flags.push({
      code: "ROLE_MISMATCH",
      severity: "HIGH",
      message:
        "Candidate role-family signals do not align with the opportunity discipline.",
    });
  }

  if (sectionCoverage < 0.4) {
    flags.push({
      code: "WEAK_CV_STRUCTURE",
      severity: "MEDIUM",
      message:
        "CV structure signals are weak for ATS parsing (skills/experience/education sections).",
    });
  }

  if (wordCount < 120) {
    flags.push({
      code: "VERY_SHORT_CV",
      severity: "HIGH",
      message: "CV appears very short, which often reduces ATS match quality.",
    });
  }

  const decision = buildDecision(finalScore, flags);
  const fixes = buildFixRecommendations({
    flags,
    missingKeywords,
    sectionCoverage,
    wordCount,
  });

  return {
    score: finalScore,
    decision,
    summary: buildSummary(
      finalScore,
      decision,
      keywordCoverage,
      roleAlignment.score,
      matchedKeywords.length,
      missingKeywords.length,
    ),
    matchedKeywords: matchedKeywords.slice(0, 12),
    missingKeywords: missingKeywords.slice(0, 12),
    flags,
    fixes,
    breakdown: {
      keywordCoverage: Number(keywordCoverage.toFixed(3)),
      roleAlignment: Number(roleAlignment.score.toFixed(3)),
      sectionCoverage: Number(sectionCoverage.toFixed(3)),
      contactCompleteness: Number(contactCompleteness.toFixed(3)),
      cvLengthScore,
    },
  };
}
