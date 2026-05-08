import { generateStructuredJson } from "@/lib/aiJson";
import { inferMetadataFromUploadedText } from "@/lib/aiMetadata";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { getAppSessionFromRequest } from "@/lib/appAuth";
import { resolveCompanyForTenant } from "@/lib/companyResolution";
import { classifyJob } from "@/lib/jobClassification";
import { getAiGatewayEnvHint, isAiGatewayConfigured } from "@/lib/liteLlm";
import { computeOpportunityId } from "@/lib/opportunity";
import { prisma } from "@/lib/prisma";
import {
    buildRoleMatchGuardPromptRules,
    guardCandidateForOpportunity,
} from "@/lib/roleMatchGuard";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import {
    completeUploadProgress,
    failUploadProgress,
    sanitiseUploadId,
    startUploadProgress,
    updateUploadProgress,
} from "@/lib/uploadProgress";
import { NextResponse } from "next/server";
import { read, utils } from "xlsx";

export const runtime = "nodejs";

type OpportunityRow = {
  companyName: string;
  role: string;
  description: string;
  opportunityEmail: string;
  opportunityUrl: string;
  requiredSkills: string;
  requiredCertifications: string;
};

type EmailFailure = {
  role: string;
  candidateName: string;
  reason: string;
};

type SkippedOpportunityReason =
  | "duplicate_in_upload"
  | "already_exists_in_system"
  | "no_opportunity_email";

type SkippedOpportunityDetail = {
  role: string;
  companyName: string;
  reason: SkippedOpportunityReason;
};

type CandidateWithProfile = {
  id: string;
  fullName: string;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
  preferredRolesCsv: string;
  rawCV: string;
};

type RoleMatchAssessment = {
  match: boolean;
  confidence: number;
  rationale: string;
};

type OpportunityExtractionResult = {
  opportunities?: OpportunityRow[];
};

type CandidateMatchSelection = {
  candidateId: string;
  match: boolean;
  confidence?: number;
  rationale?: string;
};

type CandidateMatchSelectionResult = {
  matches?: CandidateMatchSelection[];
};

const MAX_EXTRACTION_ROWS = 300;
const MAX_EXTRACTION_CHARS = 12_000;
const MAX_EXTRACTION_RESPONSE_TOKENS = 3000;
const MAX_CELL_TEXT_LENGTH = 120;
const MAX_COLUMNS_PER_ROW = 8;
const CANDIDATE_MATCH_BATCH_SIZE = 15;
const MAX_RAW_CV_SNIPPET_LENGTH = 500;
const EMAIL_GENERATION_TIMEOUT_MS = 60_000;
const MAX_SKIPPED_DETAILS = 200;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function isGithubDailyQuotaError(message: string): boolean {
  return /daily limit reached|retry after quota reset|UserByModelByDay|ByDay/i.test(
    message,
  );
}

function toCellString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function normaliseOpportunityEmail(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const match = value.match(EMAIL_PATTERN)?.[0];
  return match?.trim().toLowerCase() ?? "";
}

function parseListField(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(/[\n,;|]+/)
        .map((item) => item.replace(/^[-*\u2022\s]+/, "").trim())
        .filter(Boolean)
        .map((item) => item.replace(/\s+/g, " ")),
    ),
  ];
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function parseWorkbookRows(buffer: Buffer): string[][] {
  const workbook = read(buffer, {
    type: "buffer",
    cellDates: false,
    dense: false,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }

  const worksheet = workbook.Sheets[sheetName];
  const matrixRows = utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  const rows = matrixRows.map((row) => row.map(toCellString));
  return rows;
}

/**
 * Technical/IT role keywords. A title must contain at least one of these to
 * be considered a genuine technical contracting opportunity.
 * Deliberately excludes generic business words (consultant, manager, director,
 * associate, head, owner, coordinator) that match recruiter/sales titles.
 */
const ROLE_KEYWORDS = new Set([
  "engineer",
  "developer",
  "architect",
  "analyst",
  "administrator",
  "devops",
  "sre",
  "programmer",
  "designer",
  "scientist",
  "researcher",
  "tester",
  "qa",
  "dba",
  "scrum",
  "frontend",
  "backend",
  "fullstack",
  "full-stack",
  "technician",
]);

/**
 * Domain qualifiers — when paired with a generic word like "consultant" or
 * "manager" or "specialist", the title is technical enough to keep.
 */
const TECHNICAL_DOMAIN_WORDS = new Set([
  "software",
  "cloud",
  "data",
  "network",
  "infrastructure",
  "security",
  "cyber",
  "cybersecurity",
  "platform",
  "devops",
  "azure",
  "aws",
  "gcp",
  "kubernetes",
  "database",
  "systems",
  "linux",
  "windows",
  "java",
  "python",
  ".net",
  "dotnet",
  "react",
  "angular",
  "node",
  "ai",
  "machine",
  "learning",
  "automation",
  "integration",
  "api",
  "web",
  "mobile",
  "iot",
  "blockchain",
  "salesforce",
  "sap",
  "oracle",
  "cisco",
  "vmware",
  "terraform",
  "ansible",
  "docker",
  "microservices",
  "etl",
  "bi",
  "erp",
  "crm",
  "ux",
  "ui",
  "testing",
  "test",
  "pen",
  "penetration",
  "forensic",
  "soc",
  "noc",
  "it",
  "ict",
  "telecom",
  "telco",
  "voip",
  "firmware",
  "embedded",
  "fpga",
  "hardware",
  "rf",
  "signal",
  "electrical",
  "mechanical",
  "civil",
  "structural",
  "bim",
  "cad",
  "gis",
]);

/**
 * Regex patterns that identify non-technical / recruiter / sales roles.
 * Matched against the full lowercased title.
 */
const NON_TECHNICAL_ROLE_PATTERNS: RegExp[] = [
  /\brecruitment\b/,
  /\brecruiter\b/,
  /\brecruiting\b/,
  /\btalent\s+(?:acquisition|partner|sourcer|advisor)\b/,
  /\bhiring\s+(?:manager|partner|specialist|lead)\b/,
  /\baccount\s+manager\b/,
  /\bbusiness\s+development\b/,
  /\bsales\s+(?:manager|director|executive|consultant|lead|representative|rep)\b/,
  /\bmarketing\s+(?:manager|director|executive|consultant|lead|coordinator)\b/,
  /\bpractice\s+manager\b/,
  /\bmanaging\s+(?:consultant|director|partner)\b/,
  /\bceo\b/,
  /\bcoo\b/,
  /\bcfo\b/,
  /\bcmo\b/,
  /\bchief\s+(?:sales|marketing|revenue|commercial|people|human|operating|financial)\b/,
  /\bhr\s+(?:manager|director|partner|specialist)\b/,
  /\bhuman\s+resources\b/,
  /\bstaffing\b/,
  /\bplacement\s+(?:consultant|specialist|manager)\b/,
  /\bheadhunt/,
  /\bresourcing\b/,
  /\bclient\s+(?:partner|director|relationship)\b/,
  /\bpartner\s+for\b/,
  /\bfounders?\b/,
  /\bconnecting\b.*\bprofessionals\b/,
  /\bconnecting\b.*\btalent\b/,
  /\bi\s+build\b/,
  /\bwe\s+are\s+looking/,
  /\bafternoon\s+linkedin\b/,
  /\blinkedin\b/,
  /\bfollowers\b/,
  /\b(?:20|10|5)k\b/,
];

function hasRoleKeyword(title: string): boolean {
  const lower = title.toLowerCase();

  // Reject titles that match non-technical patterns regardless of keywords.
  for (const pattern of NON_TECHNICAL_ROLE_PATTERNS) {
    if (pattern.test(lower)) {
      return false;
    }
  }

  // Accept if the title contains a core technical keyword.
  for (const keyword of ROLE_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword.replace(/-/g, "\\-")}\\b`);
    if (pattern.test(lower)) {
      return true;
    }
  }

  // Accept generic titles (consultant, manager, specialist, director, lead,
  // etc.) ONLY when paired with a technical domain qualifier.
  const hasDomain = [...TECHNICAL_DOMAIN_WORDS].some((domain) => {
    const domainPattern = new RegExp(
      `\\b${domain.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`,
    );
    return domainPattern.test(lower);
  });

  if (hasDomain) {
    const GENERIC_ROLE_WORDS = [
      "consultant",
      "manager",
      "specialist",
      "director",
      "lead",
      "head",
      "officer",
      "expert",
      "coordinator",
      "principal",
      "senior",
      "staff",
    ];
    for (const word of GENERIC_ROLE_WORDS) {
      const wordPattern = new RegExp(`\\b${word}\\b`);
      if (wordPattern.test(lower)) {
        return true;
      }
    }
  }

  return false;
}

function cleanOpportunityRows(rows: OpportunityRow[]): OpportunityRow[] {
  const SEARCH_TERM_TOKENS = new Set([
    "contract",
    "contracts",
    "remote",
    "hybrid",
    "onsite",
    "outside",
    "inside",
    "ir35",
    "outsideir35",
    "insideir35",
    "uk",
    "eu",
    "europe",
    "us",
    "usa",
    "india",
    "only",
  ]);

  const sanitiseRoleTitle = (value: string): string => {
    // Strip emoji first, trim, then strip leading junk labels.
    const emojiStripped = value

      .replace(
        /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{200D}\u{20E3}]/gu,
        "",
      )
      .trim();

    const stripped = emojiStripped
      // Strip leading hashtags and asterisks ("#ContractHiring:", "***", "**")
      .replace(/^[#*]+\s*/g, "")
      .replace(
        /^(?:#hiring|hiring|urgent(?:\s+hiring)?|we'?re\s+hiring|we\s+are\s+hiring|now\s+hiring|immediately\s+hiring|looking\s+for|calling\s+(?:all|my))\s*[:\-–]?\s*/i,
        "",
      )
      .replace(
        /^(?:job\s+title|position(?:\s+(?:name|title))?|title|role)\s*[:\-–]\s*/i,
        "",
      )
      // Strip "@CompanyName …" and "- Division/Team/Group at Company" suffixes.
      .replace(/\s*@\s*\S.*$/, "")
      .replace(/\s*[-–]\s*(?:division|team|group|department)\s+at\s+.+$/i, "")
      // Strip trailing "at CompanyName" / "– Location" / "- CompanyName" suffixes.
      .replace(/\s+at\s+[A-Z][A-Za-z\s&.,]+$/i, "")
      .replace(/\s*[-–]\s+[A-Z][A-Za-z\s&.,]+$/, "")
      .trim();

    // If the result is still longer than 80 chars it is almost certainly
    // a sentence/description, not a proper job title — reject it.
    if (stripped.length > 80) {
      return "";
    }

    const cleaned = stripped
      .replace(/[()[\],]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) {
      return "";
    }

    const kept = cleaned
      .split(" ")
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !SEARCH_TERM_TOKENS.has(part.toLowerCase()));

    const title = kept.join(" ").replace(/\s+/g, " ").trim();
    return title || cleaned;
  };

  const splitRoles = (value: string): string[] => {
    const normalised = value.replace(/\s+/g, " ").trim();
    if (!normalised) {
      return [];
    }

    const cleaned = normalised
      .replace(/\bcontract\s+roles?\b.*$/i, "")
      .replace(/\bcontract\s+role\b.*$/i, "")
      .trim();

    const parts = cleaned
      .split(/[\n;|]+|,\s*/)
      .map((part) =>
        part
          .replace(/^[-*\u2022\s]+/, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .map((part) => part.replace(/\bcontract\b.*$/i, "").trim())
      .filter((part) => part.length >= 3);

    if (parts.length <= 1) {
      return cleaned ? [cleaned] : [];
    }

    return [...new Set(parts)];
  };

  return rows.flatMap((row) => {
    const companyName = row.companyName?.trim() ?? "";
    const description = row.description?.trim() ?? "";
    const opportunityEmail = normaliseOpportunityEmail(row.opportunityEmail);
    const opportunityUrl = row.opportunityUrl?.trim() ?? "";
    const requiredSkills = parseListField(row.requiredSkills).join(", ");
    const requiredCertifications = parseListField(
      row.requiredCertifications,
    ).join(", ");
    const roleParts = splitRoles(row.role ?? "");

    return roleParts
      .map((role) => ({
        companyName,
        role: sanitiseRoleTitle(role),
        description,
        opportunityEmail,
        opportunityUrl,
        requiredSkills,
        requiredCertifications,
      }))
      .filter((r) => r.role.length >= 4 && hasRoleKeyword(r.role));
  });
}

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  const normalisedHeaders = headers.map(normaliseHeader);
  for (const candidate of candidates) {
    const normalisedCandidate = normaliseHeader(candidate);
    const exact = normalisedHeaders.indexOf(normalisedCandidate);
    if (exact >= 0) {
      return exact;
    }

    const partial = normalisedHeaders.findIndex((header) =>
      header.includes(normalisedCandidate),
    );
    if (partial >= 0) {
      return partial;
    }
  }

  return -1;
}

function getCell(row: string[], index: number): string {
  if (index < 0) {
    return "";
  }

  return (row[index] ?? "").trim();
}

function extractOpportunitiesFromRowsFallback(
  rows: string[][],
): OpportunityRow[] {
  if (rows.length === 0) {
    return [];
  }

  const headerRow = rows[0] ?? [];
  const companyIndex = findColumnIndex(headerRow, [
    "company",
    "company name",
    "client",
    "account",
    "organisation",
    "organization",
  ]);
  const roleIndex = findColumnIndex(headerRow, [
    "role",
    "title",
    "job title",
    "position",
    "vacancy",
  ]);
  const descriptionIndex = findColumnIndex(headerRow, [
    "description",
    "job description",
    "details",
    "summary",
  ]);
  const emailIndex = findColumnIndex(headerRow, [
    "email",
    "opportunity email",
    "contact email",
    "hiring email",
  ]);
  const urlIndex = findColumnIndex(headerRow, [
    "url",
    "link",
    "opportunity url",
    "job url",
    "source url",
  ]);
  const skillsIndex = findColumnIndex(headerRow, [
    "skills",
    "required skills",
    "must have skills",
    "tech stack",
    "technologies",
  ]);
  const certificationsIndex = findColumnIndex(headerRow, [
    "certifications",
    "required certifications",
    "certification",
    "mandatory certifications",
  ]);

  const extracted: OpportunityRow[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const role = getCell(row, roleIndex) || getCell(row, 1) || getCell(row, 0);
    const companyName =
      getCell(row, companyIndex) || getCell(row, 0) || "Unknown company";
    const description =
      getCell(row, descriptionIndex) || row.join(" | ").trim().slice(0, 1500);
    const opportunityEmail = normaliseOpportunityEmail(
      getCell(row, emailIndex),
    );
    const opportunityUrl = getCell(row, urlIndex);
    const requiredSkills = getCell(row, skillsIndex);
    const requiredCertifications = getCell(row, certificationsIndex);

    extracted.push({
      companyName,
      role,
      description,
      opportunityEmail,
      opportunityUrl,
      requiredSkills,
      requiredCertifications,
    });
  }

  return cleanOpportunityRows(extracted);
}

function normaliseOpportunityKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildOpportunityDedupeKey(opportunity: OpportunityRow): string {
  const company = normaliseOpportunityKeyPart(opportunity.companyName);
  const email = normaliseOpportunityKeyPart(opportunity.opportunityEmail);
  const url = normaliseOpportunityKeyPart(opportunity.opportunityUrl);
  const description = normaliseOpportunityKeyPart(opportunity.description);

  if (url) {
    return `url:${url}|company:${company}`;
  }

  if (email) {
    return `email:${email}|company:${company}`;
  }

  return `company:${company}|description:${description}`;
}

async function extractOpportunitiesWithAi(params: {
  rows: string[][];
}): Promise<OpportunityRow[]> {
  const allRows = params.rows.slice(0, MAX_EXTRACTION_ROWS);
  const headerRow = (allRows[0] ?? [])
    .slice(0, MAX_COLUMNS_PER_ROW)
    .map((cell) => cell.slice(0, MAX_CELL_TEXT_LENGTH));
  const headerLine = `1. ${headerRow.join(" | ")}`;
  const dataRows = allRows.slice(1);

  // Split data rows into char-budget batches so large files are fully processed.
  const batches: string[][][] = [];
  let currentBatch: string[][] = [];
  let usedChars = headerLine.length;

  for (const row of dataRows) {
    const safeRow = row
      .slice(0, MAX_COLUMNS_PER_ROW)
      .map((cell) => cell.slice(0, MAX_CELL_TEXT_LENGTH));
    const lineLength = safeRow.join(" | ").length + 5; // +5 for row-index prefix
    if (
      currentBatch.length > 0 &&
      usedChars + lineLength > MAX_EXTRACTION_CHARS
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      usedChars = headerLine.length;
    }
    currentBatch.push(row);
    usedChars += lineLength;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  const systemPrompt = [
    "You are a specialist IT/engineering contract opportunity extractor.",
    "Your ONLY task is to identify rows that advertise a specific technical or engineering CONTRACT POSITION that a candidate could be submitted to.",
    'A valid opportunity has a concrete technical job title such as "Senior DevOps Engineer", "AWS Solutions Architect", "Java Backend Developer", "Network Security Engineer", "Data Analyst", "Scrum Master".',
    "",
    "REJECT (set role to empty string) any row that is:",
    '- A recruiter\'s own profile/headline (e.g. "Recruitment Consultant", "Talent Acquisition Partner", "I Build Data Teams")',
    "- A sales, marketing, account management, business development, or HR role",
    "- A company announcement, blog post, thought-leadership blurb, or availability notice",
    '- A vague phrase with no identifiable technical job title (e.g. "Specialist", "Senior", "Tech", "Connecting talent...")',
    "- A person's name, company name, or LinkedIn headline used as the role",
    "",
    'The role field must be a SHORT, SPECIFIC professional technical job title (4–60 characters, e.g. "Senior Cloud Architect").',
    "If a row describes a recruiter posting about a technical role they are hiring for, extract the TECHNICAL ROLE being hired — not the recruiter's own title.",
    "",
    "Return strict JSON only with key opportunities as an array of objects with keys companyName, role, description, opportunityEmail, opportunityUrl, requiredSkills, requiredCertifications.",
  ].join("\n");

  const allOpportunities: OpportunityRow[] = [];

  for (const batch of batches) {
    const renderedRows: string[] = [headerLine];
    let rowIndex = 2;
    for (const row of batch) {
      const safeRow = row
        .slice(0, MAX_COLUMNS_PER_ROW)
        .map((cell) => cell.slice(0, MAX_CELL_TEXT_LENGTH));
      renderedRows.push(`${rowIndex}. ${safeRow.join(" | ")}`);
      rowIndex += 1;
    }

    const tableText = renderedRows.join("\n");
    const userPrompt = [
      `SPREADSHEET ROWS:`,
      tableText,
      ``,
      `EXTRACTION RULES:`,
      `1. Parse header + data rows provided above.`,
      `2. ONLY extract rows with a genuine, specific TECHNICAL/IT/ENGINEERING contract vacancy. Examples of VALID roles: "Senior Java Developer", "AWS Solutions Architect", "Network Security Engineer", "Data Analyst", "Scrum Master", "Cloud DevOps Engineer".`,
      `3. SKIP and set role="" for all of these:`,
      `   - Recruiter/staffing profiles ("Recruitment Consultant", "Talent Partner", "I build data teams")`,
      `   - Sales/BD/account management titles ("Account Manager", "Business Development Manager")`,
      `   - Generic/vague titles with no specific technical discipline ("Senior", "Specialist", "Consultant", "Tech", "Expert", "Director", "Associate Director", "Managing Consultant")`,
      `   - Marketing blurbs, company announcements, availability posts, LinkedIn headlines`,
      `   - Rows where the text is a paragraph or sentence rather than a job title`,
      `4. role MUST be a SHORT specific technical job title, 4–60 characters (e.g. "Senior DevOps Engineer"). If a recruiter is posting about a role they are hiring for, extract the TECHNICAL ROLE being hired — not the recruiter's own title.`,
      `5. Strip leading labels ("Hiring:", "Job Title:", emoji, hashtags, asterisks). Strip trailing location/company suffixes ("– London", "at CompanyName").`,
      `6. companyName = the hiring company/client, NOT a staffing agency or recruiter's own company. Never put a person's name in companyName.`,
      `7. Keep missing fields as empty string.`,
      `8. opportunityEmail = email address only. opportunityUrl = URL only.`,
      `9. requiredSkills = comma-separated technical skills. requiredCertifications = comma-separated certs.`,
      `Return JSON only: {"opportunities":[{"companyName":"","role":"","description":"","opportunityEmail":"","opportunityUrl":"","requiredSkills":"","requiredCertifications":""}]}`,
    ].join("\n");

    const extracted = await generateStructuredJson<OpportunityExtractionResult>(
      {
        systemPrompt,
        userPrompt,
        maxTokens: MAX_EXTRACTION_RESPONSE_TOKENS,
        temperature: 0,
      },
    );

    allOpportunities.push(...(extracted.opportunities ?? []));
  }

  return cleanOpportunityRows(allOpportunities);
}

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  if (batchSize <= 0) {
    return [items];
  }

  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

function normaliseRoleText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokeniseRole(value: string): string[] {
  return normaliseRoleText(value)
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function candidateMatchesOpportunityRole(
  candidate: CandidateWithProfile,
  opportunityRole: string,
): boolean {
  if (!opportunityRole.trim()) {
    return false;
  }

  // Use preferredRolesCsv when the candidate has made selections; fall back to
  // the full AI-suggested list so unreviewed candidates are still matched.
  const rolesCsv =
    candidate.preferredRolesCsv.trim() || candidate.suggestedRolesCsv;

  const suggestedRoles = rolesCsv
    .split(/[;,\n|]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (suggestedRoles.length === 0) {
    return false;
  }

  // Use the strict role-match guard: role-family words must match AND the
  // opportunity's specialisation tokens must be sufficiently covered.
  // This prevents cross-family mismatches (Engineer ↔ Architect) and
  // specialisation gaps (Enterprise Architect ↔ Enterprise Infrastructure Architect).
  const guardResult = guardCandidateForOpportunity(
    suggestedRoles,
    opportunityRole,
  );

  if (guardResult.allowed) {
    return true;
  }

  // Guard blocked all candidate roles — log for diagnostics and reject.
  console.info(
    `[ROLE_GUARD] Pre-filter blocked candidate "${candidate.fullName}" for opportunity "${opportunityRole}": ${guardResult.reason}`,
  );
  return false;
}

function createCandidatePromptSummary(candidate: CandidateWithProfile): string {
  const cvSnippet = candidate.rawCV.slice(0, MAX_RAW_CV_SNIPPET_LENGTH);
  return [
    `candidateId: ${candidate.id}`,
    `name: ${candidate.fullName}`,
    `skills: ${candidate.skillsCsv}`,
    `certifications: ${candidate.certificationsCsv}`,
    `suggestedRoles: ${candidate.suggestedRolesCsv}`,
    `cvSnippet: ${cvSnippet}`,
  ].join("\n");
}

async function selectMatchingCandidatesForOpportunityWithAi(params: {
  opportunity: OpportunityRow;
  candidates: CandidateWithProfile[];
}): Promise<Map<string, RoleMatchAssessment>> {
  const systemPrompt = [
    "Evaluate candidate fit for one opportunity.",
    "Return strict JSON only with key matches as an array.",
    "Each item must include candidateId, match (boolean), confidence (0-100), rationale (short factual string).",
    "Use only the supplied evidence — do not infer or assume any skills, roles, or certifications not explicitly stated.",
    "",
    buildRoleMatchGuardPromptRules(),
  ].join("\n");

  const candidateBatches = splitIntoBatches(
    params.candidates,
    CANDIDATE_MATCH_BATCH_SIZE,
  );
  const matches = new Map<string, RoleMatchAssessment>();

  for (const batch of candidateBatches) {
    const candidateListText = batch
      .map((candidate, index) => {
        return `Candidate ${index + 1}\n${createCandidatePromptSummary(candidate)}`;
      })
      .join("\n\n---\n\n");

    const requiredSkillsText = params.opportunity.requiredSkills
      ? `\nREQUIRED SKILLS: ${params.opportunity.requiredSkills}`
      : "";
    const requiredCertsText = params.opportunity.requiredCertifications
      ? `\nREQUIRED CERTIFICATIONS: ${params.opportunity.requiredCertifications}`
      : "";

    const userPrompt =
      `OPPORTUNITY ROLE (EXACT): ${params.opportunity.role}` +
      `\nCOMPANY: ${params.opportunity.companyName}` +
      requiredSkillsText +
      requiredCertsText +
      `\nDESCRIPTION:\n${params.opportunity.description || "No extra description provided."}` +
      `\n\nCANDIDATES:\n${candidateListText}` +
      `\n\nEvaluation rules:` +
      `\n- Evaluate every listed candidate and include each once in matches.` +
      `\n- match=true ONLY when the candidate's documented role history or title is an EXACT or near-exact match to the opportunity role. Partial keyword overlap is NOT sufficient.` +
      `\n- A candidate whose title differs in role family (e.g. Engineer vs Architect) MUST receive match=false regardless of other similarities.` +
      `\n- A candidate whose title is missing a key specialisation domain (e.g. has \'Enterprise Architect\' for \'Enterprise Infrastructure Architect\') MUST receive match=false.` +
      `\n- confidence must be 0-100. Only assign ≥85 when you can cite specific evidence from the candidate\'s CV text.` +
      `\n- rationale must name the specific CV evidence (role title, years, technology) that supports or contradicts the match.` +
      `\nReturn JSON only: {"matches":[{"candidateId":"","match":false,"confidence":0,"rationale":""}]}`;

    let result: CandidateMatchSelectionResult;
    try {
      result = await generateStructuredJson<CandidateMatchSelectionResult>({
        systemPrompt,
        userPrompt,
        maxTokens: 1200,
        temperature: 0,
      });
    } catch {
      continue;
    }

    for (const item of result.matches ?? []) {
      const confidence = Number(item.confidence ?? 0);
      const clampedConfidence = Number.isFinite(confidence)
        ? Math.max(0, Math.min(100, confidence))
        : 0;
      const assessment: RoleMatchAssessment = {
        match: Boolean(item.match) && clampedConfidence >= 90,
        confidence: clampedConfidence,
        rationale:
          typeof item.rationale === "string" && item.rationale.trim()
            ? item.rationale.trim()
            : "AI did not provide a rationale.",
      };

      if (assessment.match) {
        matches.set(item.candidateId, assessment);
      }
    }
  }

  return matches;
}

async function findExistingOpportunityJob(
  tenantId: string,
  opportunity: OpportunityRow,
): Promise<string | undefined> {
  const companyName = opportunity.companyName.trim();
  const opportunityEmail = opportunity.opportunityEmail.trim().toLowerCase();
  const opportunityUrl = opportunity.opportunityUrl.trim();

  const companyFilter = companyName
    ? { company: { is: { name: companyName, tenantId } } }
    : {};

  if (opportunityUrl) {
    const byUrl = await prisma.job.findFirst({
      where: {
        tenantId,
        opportunityUrl,
        ...companyFilter,
      },
      select: { id: true },
    });

    if (byUrl) {
      return byUrl.id;
    }
  }

  if (opportunityEmail) {
    const byEmailRole = await prisma.job.findFirst({
      where: {
        tenantId,
        opportunityEmail,
        ...companyFilter,
      },
      select: { id: true },
    });

    if (byEmailRole) {
      return byEmailRole.id;
    }
  }

  const rawText =
    opportunity.description ||
    `${opportunity.role.trim()} opportunity ${companyName ? `for ${companyName}` : ""}`.trim();

  const byRoleAndText = await prisma.job.findFirst({
    where: {
      tenantId,
      rawText,
      ...companyFilter,
    },
    select: { id: true },
  });

  return byRoleAndText?.id;
}

async function processUploadBackground(params: {
  workbookRows: string[][];
  uploadId: string;
  tenantId: string;
  session: ReturnType<typeof getAppSessionFromRequest>;
  gatewayConfigured: boolean;
}): Promise<void> {
  const { workbookRows, uploadId, tenantId, session, gatewayConfigured } =
    params;
  try {
    updateUploadProgress({
      uploadId,
      tenantId,
      percent: 30,
      message: "Extracting opportunities using AI.",
    });

    let opportunities: OpportunityRow[] = [];
    let extractionWarning: string | null = null;
    try {
      opportunities = await extractOpportunitiesWithAi({ rows: workbookRows });
    } catch (error) {
      const aiMessage =
        error instanceof Error && error.message
          ? error.message
          : "AI extraction failed for opportunities upload.";

      if (isGithubDailyQuotaError(aiMessage)) {
        failUploadProgress({
          uploadId,
          tenantId,
          message:
            "LiteLLM quota reached. Retry later or update gateway limits.",
        });
        return;
      }

      const fallbackOpportunities =
        extractOpportunitiesFromRowsFallback(workbookRows);
      if (fallbackOpportunities.length > 0) {
        opportunities = fallbackOpportunities;
        extractionWarning =
          "AI extraction returned invalid JSON, so the spreadsheet fallback parser was used.";
        updateUploadProgress({
          uploadId,
          tenantId,
          percent: 35,
          message:
            "AI extraction failed. Continuing with spreadsheet fallback parser.",
        });
      } else {
        failUploadProgress({ uploadId, tenantId, message: aiMessage });
        return;
      }
    }

    if (opportunities.length === 0) {
      failUploadProgress({
        uploadId,
        tenantId,
        message: "No opportunities were found in the uploaded file.",
      });
      return;
    }

    const candidates = await prisma.candidate.findMany({
      where: {
        isActive: true,
        tenantId,
        applications: { none: { currentStage: "PLACED" } },
        ...(session?.role === "USER" ? { ownerUserId: session.uid } : {}),
      },
      select: {
        id: true,
        fullName: true,
        skillsCsv: true,
        certificationsCsv: true,
        suggestedRolesCsv: true,
        preferredRolesCsv: true,
        rawCV: true,
      },
    });

    updateUploadProgress({
      uploadId,
      tenantId,
      percent: 45,
      message: "Creating opportunities.",
    });

    let createdJobs = 0;
    let matchedCandidates = 0;
    let generatedEmails = 0;
    const failedEmails = 0;
    let skippedExistingOpportunities = 0;
    let skippedDuplicateInUpload = 0;
    let skippedAlreadyExistsInSystem = 0;
    const emailFailures: EmailFailure[] = [];
    const skippedOpportunities: SkippedOpportunityDetail[] = [];
    const dedupeKeys = new Set<string>();
    const totalOpportunities = Math.max(opportunities.length, 1);
    let completedOpportunities = 0;

    const reportOpportunityProgress = (message: string) => {
      const percent = 45 + (completedOpportunities / totalOpportunities) * 25;
      updateUploadProgress({ uploadId, tenantId, percent, message });
    };

    type PendingJobForMatching = {
      job: { id: string; title: string };
      opportunity: OpportunityRow;
      resolvedCompanyName: string;
      rolePrefilteredCandidates: CandidateWithProfile[];
    };
    const pendingForMatching: PendingJobForMatching[] = [];

    for (const opportunity of opportunities) {
      const dedupeKey = buildOpportunityDedupeKey(opportunity);
      if (dedupeKeys.has(dedupeKey)) {
        skippedExistingOpportunities += 1;
        skippedDuplicateInUpload += 1;
        if (skippedOpportunities.length < MAX_SKIPPED_DETAILS) {
          skippedOpportunities.push({
            role: opportunity.role,
            companyName: opportunity.companyName,
            reason: "duplicate_in_upload",
          });
        }
        completedOpportunities += 1;
        reportOpportunityProgress("Skipping duplicate opportunities.");
        continue;
      }
      dedupeKeys.add(dedupeKey);

      const companyResolution = await resolveCompanyForTenant(
        tenantId,
        opportunity.companyName,
      );
      const resolvedCompanyName = companyResolution.companyName ?? "";

      const existingJobId = await findExistingOpportunityJob(tenantId, {
        ...opportunity,
        companyName: resolvedCompanyName,
      });
      if (existingJobId) {
        skippedExistingOpportunities += 1;
        skippedAlreadyExistsInSystem += 1;
        if (skippedOpportunities.length < MAX_SKIPPED_DETAILS) {
          skippedOpportunities.push({
            role: opportunity.role,
            companyName: resolvedCompanyName || opportunity.companyName,
            reason: "already_exists_in_system",
          });
        }
        completedOpportunities += 1;
        reportOpportunityProgress(
          "Skipping existing opportunities already in the system.",
        );
        continue;
      }

      if (!opportunity.opportunityEmail.trim()) {
        skippedExistingOpportunities += 1;
        if (skippedOpportunities.length < MAX_SKIPPED_DETAILS) {
          skippedOpportunities.push({
            role: opportunity.role,
            companyName: resolvedCompanyName || opportunity.companyName,
            reason: "no_opportunity_email",
          });
        }
        completedOpportunities += 1;
        reportOpportunityProgress(
          "Skipping opportunities without a contact email.",
        );
        continue;
      }

      const rawText =
        opportunity.description ||
        `${opportunity.role} opportunity ${resolvedCompanyName ? `for ${resolvedCompanyName}` : ""}`.trim();
      const classification = classifyJob(opportunity.role, rawText);
      const job = await prisma.job.create({
        data: {
          tenantId,
          ownerUserId: session?.uid,
          title: opportunity.role,
          description: opportunity.description || null,
          requiredSkillsCsv: opportunity.requiredSkills || null,
          requiredCertificationsCsv: opportunity.requiredCertifications || null,
          rawText,
          opportunityEmail: opportunity.opportunityEmail || null,
          opportunityUrl: opportunity.opportunityUrl || null,
          companyId: companyResolution.companyId,
          isRemote: classification.isRemote,
          requiresUsWorkAuth: classification.requiresUsWorkAuth,
          requiresUkWorkAuth: classification.requiresUkWorkAuth,
          requiresNonSaLocation: classification.requiresNonSaLocation,
        },
      });
      createdJobs += 1;

      pendingForMatching.push({
        job,
        opportunity,
        resolvedCompanyName,
        rolePrefilteredCandidates: candidates.filter((candidate) =>
          candidateMatchesOpportunityRole(candidate, opportunity.role),
        ),
      });

      completedOpportunities += 1;
      reportOpportunityProgress(
        `Created opportunity ${completedOpportunities} of ${totalOpportunities}.`,
      );
    }

    // Phase 2: Parallel AI matching across all new jobs simultaneously.
    updateUploadProgress({
      uploadId,
      tenantId,
      percent: 70,
      message: `Matching candidates for ${pendingForMatching.length} opportunit${pendingForMatching.length === 1 ? "y" : "ies"}.`,
    });

    type MatchedJobResult = {
      pending: PendingJobForMatching;
      matchingCandidates: CandidateWithProfile[];
    };

    const matchedJobResults: MatchedJobResult[] = await Promise.all(
      pendingForMatching.map(async (pending) => {
        const matchingCandidates: CandidateWithProfile[] = [];
        if (gatewayConfigured && pending.rolePrefilteredCandidates.length > 0) {
          try {
            const matchedCandidateMap =
              await selectMatchingCandidatesForOpportunityWithAi({
                opportunity: pending.opportunity,
                candidates: pending.rolePrefilteredCandidates,
              });
            for (const candidate of pending.rolePrefilteredCandidates) {
              if (matchedCandidateMap.has(candidate.id)) {
                matchingCandidates.push(candidate);
              }
            }
          } catch {
            // Matching failure is non-fatal; opportunity is kept with no matches.
          }
        }
        return { pending, matchingCandidates };
      }),
    );

    // Phase 3: Application creation for all matched pairs.
    updateUploadProgress({
      uploadId,
      tenantId,
      percent: 82,
      message: "Creating candidate applications.",
    });

    type EmailTask = {
      jobId: string;
      candidateId: string;
      applicationId: string;
    };
    const emailTasks: EmailTask[] = [];

    for (const { pending, matchingCandidates } of matchedJobResults) {
      const { job, resolvedCompanyName } = pending;

      for (const candidate of matchingCandidates) {
        matchedCandidates += 1;
        const opportunityId = `${tenantId}:${computeOpportunityId({
          candidateName: candidate.fullName,
          roleTitle: job.title,
          companyName: resolvedCompanyName,
        })}`;

        let applicationId: string;
        try {
          const createdApplication = await prisma.application.create({
            data: {
              jobId: job.id,
              candidateId: candidate.id,
              tenantId,
              ownerUserId: session?.uid,
              opportunityId,
              c2cPartner:
                process.env.DEFAULT_C2C_PARTNER_NAME ?? "C2C Partner Ltd",
              history: {
                create: { tenantId, toStage: "NEW" },
              },
            },
          });
          applicationId = createdApplication.id;
        } catch (error) {
          if (!isUniqueConstraintError(error)) {
            throw error;
          }

          const existing = await prisma.application.findFirst({
            where: { opportunityId, tenantId },
          });

          if (!existing) {
            throw error;
          }

          applicationId = existing.id;
        }

        emailTasks.push({
          jobId: job.id,
          candidateId: candidate.id,
          applicationId,
        });
      }
    }

    // Phase 4: Fire-and-forget email generation.
    const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    void Promise.allSettled(
      emailTasks.map(async (task) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          EMAIL_GENERATION_TIMEOUT_MS,
        );
        try {
          await fetch(`${appBaseUrl}/api/email/generate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-tenant-id": tenantId,
            },
            body: JSON.stringify({
              jobId: task.jobId,
              candidateId: task.candidateId,
              applicationId: task.applicationId,
            }),
            signal: controller.signal,
          });
        } catch {
          // Background email errors are non-fatal.
        } finally {
          clearTimeout(timeoutId);
        }
      }),
    );

    generatedEmails = emailTasks.length;

    const uploadOutcome: "success" | "no_changes" =
      createdJobs === 0 && skippedExistingOpportunities > 0
        ? "no_changes"
        : "success";

    const uploadMessage =
      uploadOutcome === "success"
        ? `Opportunity upload completed. ${emailTasks.length > 0 ? `${emailTasks.length} candidate email${emailTasks.length === 1 ? "" : "s"} queued for generation.` : "No candidates matched."}`
        : "Upload completed but no new opportunities were created. Existing records were skipped.";

    completeUploadProgress({
      uploadId,
      tenantId,
      message: uploadMessage,
      summary: {
        uploadOutcome,
        uploadMessage,
        extractionWarning,
        uploadedOpportunities: opportunities.length,
        createdJobs,
        matchedCandidates,
        generatedEmails,
        failedEmails,
        skippedExistingOpportunities,
        skippedDuplicateInUpload,
        skippedAlreadyExistsInSystem,
        skippedOpportunities,
        emailFailures,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unexpected error during background upload processing.";
    console.error("Background upload processing failed", { message, error });
    failUploadProgress({ uploadId, tenantId, message });
  }
}

export async function POST(request: Request) {
  let uploadId: string | undefined;
  let tenantIdForProgress: string | undefined;

  try {
    const tenantId = resolveTenantIdFromRequest(request);
    tenantIdForProgress = tenantId;
    const session = getAppSessionFromRequest(request);
    const contentType = request.headers.get("content-type") ?? "";

    // Support programmatic JSON uploads for testing: accept { text: string }
    if (contentType.includes("application/json")) {
      console.log("[OPPORTUNITIES_UPLOAD] JSON request detected", {
        contentType,
      });
      const body = await request.json();
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const modelOverride =
        typeof body.model === "string" ? body.model.trim() : undefined;
      if (!text) {
        return jsonError("Missing text field in JSON upload", 400);
      }

      // Simple synchronous metadata inference for test scenarios.
      try {
        const inferred = await inferMetadataFromUploadedText({
          jobText: text,
          model: modelOverride,
        });
        return jsonOk({
          role: inferred.roleTitle ?? null,
          candidateName: inferred.candidateName ?? null,
        });
      } catch (err) {
        console.error("Opportunity JSON upload inference failed", {
          message: (err as Error)?.message ?? err,
          stack: (err as Error)?.stack ?? null,
        });
        // RETURN detailed error for local debugging
        return jsonError(
          `Opportunities upload failed: ${(err as Error)?.message ?? String(err)}`,
          500,
        );
      }
    }

    const formData = await request.formData();

    const clientUploadId = sanitiseUploadId(formData.get("uploadId"));
    uploadId =
      clientUploadId ??
      `up${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    startUploadProgress({
      uploadId,
      tenantId,
      message: "Upload received — queued for background processing.",
    });

    const file = formData.get("file");
    if (!(file instanceof File)) {
      failUploadProgress({
        uploadId,
        tenantId,
        message: "No upload file was provided.",
      });
      return jsonError("Upload a CSV or XLSX opportunities file", 400);
    }

    const gatewayConfigured = isAiGatewayConfigured();
    if (!gatewayConfigured) {
      failUploadProgress({
        uploadId,
        tenantId,
        message: "LiteLLM is not configured for opportunities upload.",
      });
      return jsonError("LiteLLM is required for opportunities upload", 400, {
        hint: getAiGatewayEnvHint(),
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    updateUploadProgress({
      uploadId,
      tenantId,
      percent: 20,
      message: "Parsing spreadsheet rows.",
    });

    let workbookRows: string[][] = [];
    try {
      workbookRows = parseWorkbookRows(buffer);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Uploaded file could not be parsed as CSV/XLSX.";
      failUploadProgress({ uploadId, tenantId, message });
      return jsonError("Invalid opportunities file", 400, {
        message,
        hint: "Upload a valid CSV/XLSX file with a header row and opportunity data.",
      });
    }

    // Fire-and-forget all AI work so the HTTP response returns immediately
    // and avoids Cloudflare's 100-second 524 timeout on large uploads.
    updateUploadProgress({
      uploadId,
      tenantId,
      percent: 25,
      message: "Queued for AI extraction and candidate matching.",
    });
    void processUploadBackground({
      workbookRows,
      uploadId,
      tenantId,
      session,
      gatewayConfigured,
    });

    return jsonOk({
      uploadOutcome: "queued" as const,
      uploadMessage:
        "Upload accepted — extracting and matching in the background. Refresh the jobs page shortly to see results.",
      extractionWarning: null,
      uploadedOpportunities: 0,
      createdJobs: 0,
      matchedCandidates: 0,
      generatedEmails: 0,
      failedEmails: 0,
      skippedExistingOpportunities: 0,
      skippedDuplicateInUpload: 0,
      skippedAlreadyExistsInSystem: 0,
      skippedOpportunities: [],
      emailFailures: [],
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : typeof error === "string"
          ? error
          : "Unexpected error while processing opportunities upload.";

    console.error("Opportunity upload pre-processing failed", {
      message,
      error,
    });

    if (uploadId && tenantIdForProgress) {
      failUploadProgress({
        uploadId,
        tenantId: tenantIdForProgress,
        message,
      });
    }

    return jsonError("Opportunities upload failed", 500);
  }
}

export function GET() {
  return NextResponse.json(
    { ok: false, error: { message: "Method not allowed" } },
    { status: 405 },
  );
}
