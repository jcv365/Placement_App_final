import { generateStructuredJson } from "@/lib/aiJson";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { getAppSessionFromRequest } from "@/lib/appAuth";
import { resolveCompanyForTenant } from "@/lib/companyResolution";
import { readSharedGithubAccessToken } from "@/lib/githubAuthStore";
import { computeOpportunityId } from "@/lib/opportunity";
import { prisma } from "@/lib/prisma";
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
};

type EmailFailure = {
  role: string;
  candidateName: string;
  reason: string;
};

type CandidateWithProfile = {
  id: string;
  fullName: string;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
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

type SelectedAiProvider =
  | "auto"
  | "github-models"
  | "azure-openai"
  | "copilot-studio";

const MAX_EXTRACTION_ROWS = 70;
const MAX_EXTRACTION_CHARS = 7000;
const MAX_CELL_TEXT_LENGTH = 120;
const MAX_COLUMNS_PER_ROW = 8;
const CANDIDATE_MATCH_BATCH_SIZE = 15;
const MAX_RAW_CV_SNIPPET_LENGTH = 500;
const EMAIL_GENERATION_TIMEOUT_MS = 60_000;

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  if (!match) {
    return undefined;
  }

  return decodeURIComponent(match.split("=").slice(1).join("="));
}

function isGithubDailyQuotaError(message: string): boolean {
  return /daily limit reached|retry after quota reset|UserByModelByDay|ByDay/i.test(
    message,
  );
}

function toCellString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
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

function cleanOpportunityRows(rows: OpportunityRow[]): OpportunityRow[] {
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
    const opportunityEmail = row.opportunityEmail?.trim().toLowerCase() ?? "";
    const opportunityUrl = row.opportunityUrl?.trim() ?? "";
    const roleParts = splitRoles(row.role ?? "");

    return roleParts.map((role) => ({
      companyName,
      role,
      description,
      opportunityEmail,
      opportunityUrl,
    }));
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

  const extracted: OpportunityRow[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const role = getCell(row, roleIndex) || getCell(row, 1) || getCell(row, 0);
    const companyName =
      getCell(row, companyIndex) || getCell(row, 0) || "Unknown company";
    const description =
      getCell(row, descriptionIndex) || row.join(" | ").trim().slice(0, 1500);
    const opportunityEmail = getCell(row, emailIndex).toLowerCase();
    const opportunityUrl = getCell(row, urlIndex);

    extracted.push({
      companyName,
      role,
      description,
      opportunityEmail,
      opportunityUrl,
    });
  }

  return cleanOpportunityRows(extracted);
}

function normaliseOpportunityKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildOpportunityDedupeKey(opportunity: OpportunityRow): string {
  const role = normaliseOpportunityKeyPart(opportunity.role);
  const company = normaliseOpportunityKeyPart(opportunity.companyName);
  const email = normaliseOpportunityKeyPart(opportunity.opportunityEmail);
  const url = normaliseOpportunityKeyPart(opportunity.opportunityUrl);
  const description = normaliseOpportunityKeyPart(opportunity.description);

  if (url) {
    return `url:${url}|role:${role}|company:${company}`;
  }

  if (email) {
    return `email:${email}|role:${role}|company:${company}`;
  }

  return `role:${role}|company:${company}|description:${description}`;
}

async function extractOpportunitiesWithAi(params: {
  provider: "github-models" | "azure-openai";
  githubAccessToken?: string;
  rows: string[][];
}): Promise<OpportunityRow[]> {
  const limitedRows = params.rows.slice(0, MAX_EXTRACTION_ROWS);
  const renderedRows: string[] = [];
  let usedChars = 0;

  for (let index = 0; index < limitedRows.length; index += 1) {
    const row = limitedRows[index] ?? [];
    const safeRow = row
      .slice(0, MAX_COLUMNS_PER_ROW)
      .map((cell) => cell.slice(0, MAX_CELL_TEXT_LENGTH));
    const line = `${index + 1}. ${safeRow.join(" | ")}`;

    if (usedChars + line.length > MAX_EXTRACTION_CHARS) {
      break;
    }

    renderedRows.push(line);
    usedChars += line.length;
  }

  const tableText = renderedRows.join("\n");

  const systemPrompt =
    "Extract opportunity records from uploaded spreadsheet rows. Return strict JSON only with key opportunities as an array of objects with keys companyName, role, description, opportunityEmail, opportunityUrl.";

  const userPrompt = `SPREADSHEET ROWS:\n${tableText}\n\nRules:\n- Parse header and data rows from the provided rows only.\n- Include an opportunity only when role/title can be identified.\n- companyName should be inferred from company/client/account fields when present.\n- Keep missing fields as empty string.\n- opportunityEmail must contain only the email address string when present.\n- opportunityUrl must contain only the URL string when present.\nReturn JSON only: {"opportunities":[{"companyName":"","role":"","description":"","opportunityEmail":"","opportunityUrl":""}]}`;

  const extracted = await generateStructuredJson<OpportunityExtractionResult>({
    provider: params.provider,
    githubAccessToken: params.githubAccessToken,
    systemPrompt,
    userPrompt,
    maxTokens: 1400,
  });

  return cleanOpportunityRows(extracted.opportunities ?? []);
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
  const roleNeedle = normaliseRoleText(opportunityRole);
  if (!roleNeedle) {
    return false;
  }

  const suggestedRoles = candidate.suggestedRolesCsv
    .split(/[;,\n|]+/)
    .map((part) => normaliseRoleText(part))
    .filter(Boolean);

  if (suggestedRoles.length === 0) {
    return false;
  }

  const requiredTokens = new Set(tokeniseRole(roleNeedle));

  for (const suggestedRole of suggestedRoles) {
    if (
      suggestedRole === roleNeedle ||
      suggestedRole.includes(roleNeedle) ||
      roleNeedle.includes(suggestedRole)
    ) {
      return true;
    }

    const suggestedTokens = new Set(tokeniseRole(suggestedRole));
    let overlap = 0;
    for (const token of requiredTokens) {
      if (suggestedTokens.has(token)) {
        overlap += 1;
      }
    }

    if (
      overlap >= 2 ||
      (requiredTokens.size > 0 && overlap / requiredTokens.size >= 0.5)
    ) {
      return true;
    }
  }

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
  provider: "github-models" | "azure-openai";
  githubAccessToken?: string;
  opportunity: OpportunityRow;
  candidates: CandidateWithProfile[];
}): Promise<Map<string, RoleMatchAssessment>> {
  const systemPrompt =
    "Evaluate candidate fit for one opportunity. Return strict JSON only with key matches as an array. Each item must include candidateId, match (boolean), confidence (0-100), rationale (short factual string). Use only the supplied evidence.";

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

    const userPrompt = `OPPORTUNITY ROLE: ${params.opportunity.role}\nCOMPANY: ${params.opportunity.companyName}\nDESCRIPTION:\n${params.opportunity.description || "No extra description provided."}\n\nCANDIDATES:\n${candidateListText}\n\nRules:\n- Evaluate every listed candidate and include each once in matches.\n- match is true only for clear alignment.\n- confidence must be 0-100.\n- rationale must be concise and factual.\nReturn JSON only: {"matches":[{"candidateId":"","match":false,"confidence":0,"rationale":""}]}`;

    let result: CandidateMatchSelectionResult;
    try {
      result = await generateStructuredJson<CandidateMatchSelectionResult>({
        provider: params.provider,
        githubAccessToken: params.githubAccessToken,
        systemPrompt,
        userPrompt,
        maxTokens: 1200,
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
        match: Boolean(item.match) && clampedConfidence >= 60,
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
  const role = opportunity.role.trim();
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
        title: role,
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
        title: role,
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
    `${role} opportunity ${companyName ? `for ${companyName}` : ""}`.trim();

  const byRoleAndText = await prisma.job.findFirst({
    where: {
      tenantId,
      title: role,
      rawText,
      ...companyFilter,
    },
    select: { id: true },
  });

  return byRoleAndText?.id;
}

export async function POST(request: Request) {
  let uploadId: string | undefined;
  let tenantIdForProgress: string | undefined;

  try {
    const tenantId = resolveTenantIdFromRequest(request);
    tenantIdForProgress = tenantId;
    const session = getAppSessionFromRequest(request);
    const formData = await request.formData();
    uploadId = sanitiseUploadId(formData.get("uploadId"));
    if (uploadId) {
      startUploadProgress({
        uploadId,
        tenantId,
        message: "Reading uploaded opportunities file.",
      });
      updateUploadProgress({
        uploadId,
        tenantId,
        percent: 10,
        message: "Validating upload settings.",
      });
    }

    const file = formData.get("file");
    const githubAccessToken = formData.get("githubAccessToken");

    if (!(file instanceof File)) {
      if (uploadId) {
        failUploadProgress({
          uploadId,
          tenantId,
          message: "No upload file was provided.",
        });
      }
      return jsonError("Upload a CSV or XLSX opportunities file", 400);
    }

    const githubTokenFromForm =
      typeof githubAccessToken === "string" && githubAccessToken.trim()
        ? githubAccessToken.trim()
        : undefined;
    const githubTokenFromCookie = getCookieValue(
      request,
      "githubAccessToken",
    )?.trim();
    const githubTokenFromSharedStore =
      (await readSharedGithubAccessToken())?.trim() || undefined;
    const githubToken =
      githubTokenFromForm ??
      githubTokenFromCookie ??
      githubTokenFromSharedStore;
    const selectedProviderRaw = formData.get("aiProvider");
    const selectedProvider: SelectedAiProvider =
      selectedProviderRaw === "github-models" ||
      selectedProviderRaw === "azure-openai" ||
      selectedProviderRaw === "copilot-studio"
        ? selectedProviderRaw
        : "auto";

    const githubConfigured = Boolean(
      githubToken?.trim() || process.env.GITHUB_MODELS_TOKEN?.trim(),
    );
    const azureConfigured = Boolean(
      process.env.AZURE_OPENAI_ENDPOINT?.trim() &&
      process.env.AZURE_OPENAI_API_KEY?.trim() &&
      process.env.AZURE_OPENAI_DEPLOYMENT?.trim(),
    );

    let activeProvider: "github-models" | "azure-openai" | undefined;
    if (selectedProvider === "github-models") {
      if (!githubConfigured) {
        return jsonError(
          "GitHub Models is selected but no token is configured",
          400,
          {
            hint: "Provide githubAccessToken in the upload request or set GITHUB_MODELS_TOKEN in the app environment.",
          },
        );
      }
      activeProvider = "github-models";
    } else if (selectedProvider === "azure-openai") {
      if (!azureConfigured && githubConfigured) {
        activeProvider = "github-models";
      } else if (!azureConfigured) {
        return jsonError(
          "Azure OpenAI is selected but required environment variables are missing",
          400,
          {
            hint: "Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT in the app environment.",
          },
        );
      }
      activeProvider = "azure-openai";
    } else {
      // Auto mode prefers GitHub Models when available, then Azure OpenAI.
      if (githubConfigured) {
        activeProvider = "github-models";
      } else if (azureConfigured) {
        activeProvider = "azure-openai";
      }
    }

    if (!activeProvider) {
      if (uploadId) {
        failUploadProgress({
          uploadId,
          tenantId,
          message: "No AI provider is configured for opportunities upload.",
        });
      }
      return jsonError(
        "AI provider is required for opportunities upload",
        400,
        {
          hint: "Connect GitHub Models or configure Azure OpenAI before uploading opportunities.",
        },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (uploadId) {
      updateUploadProgress({
        uploadId,
        tenantId,
        percent: 20,
        message: "Parsing spreadsheet rows.",
      });
    }

    let workbookRows: string[][] = [];
    try {
      workbookRows = parseWorkbookRows(buffer);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Uploaded file could not be parsed as CSV/XLSX.";
      if (uploadId) {
        failUploadProgress({
          uploadId,
          tenantId,
          message,
        });
      }
      return jsonError("Invalid opportunities file", 400, {
        message,
        hint: "Upload a valid CSV/XLSX file with a header row and opportunity data.",
      });
    }

    if (uploadId) {
      updateUploadProgress({
        uploadId,
        tenantId,
        percent: 30,
        message: "Extracting opportunities using AI.",
      });
    }

    let opportunities: OpportunityRow[] = [];
    let extractionWarning: string | null = null;
    try {
      opportunities = await extractOpportunitiesWithAi({
        provider: activeProvider,
        githubAccessToken: githubToken,
        rows: workbookRows,
      });
    } catch (error) {
      const aiMessage =
        error instanceof Error && error.message
          ? error.message
          : "AI extraction failed for opportunities upload.";

      if (isGithubDailyQuotaError(aiMessage)) {
        if (uploadId) {
          failUploadProgress({
            uploadId,
            tenantId,
            message:
              "GitHub Models daily quota reached. Connect another token or retry later.",
          });
        }
        return jsonError(aiMessage, 429, {
          message:
            "GitHub Models daily quota has been reached for the connected token. Reconnect with a different GitHub token or retry after quota reset.",
          requiresInvestigation: true,
          popupMessage:
            "GitHub Models daily quota reached. Reconnect with another GitHub token in Settings, or retry after quota reset.",
        });
      }

      const fallbackOpportunities =
        extractOpportunitiesFromRowsFallback(workbookRows);
      if (fallbackOpportunities.length > 0) {
        opportunities = fallbackOpportunities;
        extractionWarning =
          "AI extraction returned invalid JSON, so the spreadsheet fallback parser was used.";
        if (uploadId) {
          updateUploadProgress({
            uploadId,
            tenantId,
            percent: 35,
            message:
              "AI extraction failed. Continuing with spreadsheet fallback parser.",
          });
        }
      } else {
        if (uploadId) {
          failUploadProgress({
            uploadId,
            tenantId,
            message: aiMessage,
          });
        }
        return jsonError(aiMessage, 422, {
          message: aiMessage,
          requiresInvestigation: true,
          popupMessage:
            "AI extraction failed. Investigate token/model/file quality and fix before retrying.",
        });
      }
    }

    if (opportunities.length === 0) {
      if (uploadId) {
        failUploadProgress({
          uploadId,
          tenantId,
          message: "No opportunities were found in the uploaded file.",
        });
      }
      return jsonError("No opportunities found in the uploaded file", 400, {
        hint: "AI could not extract opportunities from this file. Investigate file quality and retry.",
        requiresInvestigation: true,
        popupMessage:
          "AI could not extract opportunities. Investigate and fix the source file before retrying.",
      });
    }

    const candidates = await prisma.candidate.findMany({
      where: {
        isActive: true,
        tenantId,
        applications: {
          none: {
            currentStage: "PLACED",
          },
        },
        ...(session?.role === "USER" ? { ownerUserId: session.uid } : {}),
      },
      select: {
        id: true,
        fullName: true,
        skillsCsv: true,
        certificationsCsv: true,
        suggestedRolesCsv: true,
        rawCV: true,
      },
    });

    if (uploadId) {
      updateUploadProgress({
        uploadId,
        tenantId,
        percent: 45,
        message: "Matching opportunities to candidates.",
      });
    }

    let createdJobs = 0;
    let matchedCandidates = 0;
    let generatedEmails = 0;
    let failedEmails = 0;
    let skippedExistingOpportunities = 0;
    const emailFailures: EmailFailure[] = [];
    const dedupeKeys = new Set<string>();
    const totalOpportunities = Math.max(opportunities.length, 1);
    let completedOpportunities = 0;
    let totalEmailTasks = 0;
    let completedEmailTasks = 0;

    const reportOpportunityProgress = (message: string) => {
      if (!uploadId) {
        return;
      }

      const percent = 45 + (completedOpportunities / totalOpportunities) * 35;
      updateUploadProgress({
        uploadId,
        tenantId,
        percent,
        message,
      });
    };

    const reportEmailProgress = (message: string) => {
      if (!uploadId) {
        return;
      }

      const percent =
        totalEmailTasks > 0
          ? 80 + (completedEmailTasks / totalEmailTasks) * 19
          : 80;
      updateUploadProgress({
        uploadId,
        tenantId,
        percent,
        message,
      });
    };

    for (const opportunity of opportunities) {
      const dedupeKey = buildOpportunityDedupeKey(opportunity);
      if (dedupeKeys.has(dedupeKey)) {
        skippedExistingOpportunities += 1;
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
        completedOpportunities += 1;
        reportOpportunityProgress(
          "Skipping existing opportunities already in the system.",
        );
        continue;
      }

      const job = await prisma.job.create({
        data: {
          tenantId,
          ownerUserId: session?.uid,
          title: opportunity.role,
          rawText:
            opportunity.description ||
            `${opportunity.role} opportunity ${resolvedCompanyName ? `for ${resolvedCompanyName}` : ""}`.trim(),
          opportunityEmail: opportunity.opportunityEmail || null,
          opportunityUrl: opportunity.opportunityUrl || null,
          companyId: companyResolution.companyId,
        },
      });
      createdJobs += 1;

      const matchingCandidates: CandidateWithProfile[] = [];
      const rolePrefilteredCandidates = candidates.filter((candidate) =>
        candidateMatchesOpportunityRole(candidate, opportunity.role),
      );

      if (activeProvider) {
        if (rolePrefilteredCandidates.length > 0) {
          const matchedCandidateMap =
            await selectMatchingCandidatesForOpportunityWithAi({
              provider: activeProvider,
              githubAccessToken: githubToken,
              opportunity,
              candidates: rolePrefilteredCandidates,
            });

          for (const candidate of rolePrefilteredCandidates) {
            if (matchedCandidateMap.has(candidate.id)) {
              matchingCandidates.push(candidate);
            }
          }
        }
      }

      totalEmailTasks += matchingCandidates.length;
      reportOpportunityProgress(
        `Matched candidates for ${completedOpportunities + 1} of ${totalOpportunities} opportunities.`,
      );

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
        }

        try {
          const appBaseUrl =
            process.env.APP_BASE_URL ?? "http://localhost:3000";
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort();
          }, EMAIL_GENERATION_TIMEOUT_MS);
          let response: Response;
          try {
            response = await fetch(`${appBaseUrl}/api/email/generate`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-tenant-id": tenantId,
              },
              body: JSON.stringify({
                jobId: job.id,
                candidateId: candidate.id,
                applicationId,
                aiProvider: activeProvider,
                githubAccessToken: githubToken,
              }),
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeoutId);
          }

          if (response.ok) {
            generatedEmails += 1;
            completedEmailTasks += 1;
            reportEmailProgress("Generating candidate submission emails.");
            continue;
          }

          let reason = `Request failed (${response.status})`;
          try {
            const payload = await response.json();
            reason =
              payload?.error?.message ||
              payload?.error?.details?.message ||
              reason;
          } catch {
            // Ignore parse errors and keep fallback reason.
          }

          failedEmails += 1;
          completedEmailTasks += 1;
          reportEmailProgress("Generating candidate submission emails.");
          emailFailures.push({
            role: opportunity.role,
            candidateName: candidate.fullName,
            reason,
          });
        } catch (error) {
          const reason =
            (error as Error).name === "AbortError"
              ? "Email generation timed out"
              : "Request failed before email generation completed";
          failedEmails += 1;
          completedEmailTasks += 1;
          reportEmailProgress("Generating candidate submission emails.");
          emailFailures.push({
            role: opportunity.role,
            candidateName: candidate.fullName,
            reason,
          });
        }
      }

      completedOpportunities += 1;
      reportOpportunityProgress(
        `Processed ${completedOpportunities} of ${totalOpportunities} opportunities.`,
      );
    }

    const uploadOutcome: "success" | "partial" | "no_changes" =
      createdJobs === 0 && skippedExistingOpportunities > 0
        ? "no_changes"
        : failedEmails > 0
          ? "partial"
          : "success";

    const uploadMessage =
      uploadOutcome === "success"
        ? "Opportunity upload completed successfully."
        : uploadOutcome === "partial"
          ? "Opportunity upload completed with warnings. Some candidate emails failed to generate."
          : "Upload completed but no new opportunities were created. Existing records were skipped.";

    if (uploadId) {
      completeUploadProgress({
        uploadId,
        tenantId,
        message: uploadMessage,
      });
    }

    return jsonOk({
      uploadOutcome,
      uploadMessage,
      extractionWarning,
      uploadedOpportunities: opportunities.length,
      createdJobs,
      matchedCandidates,
      generatedEmails,
      failedEmails,
      skippedExistingOpportunities,
      emailFailures,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : typeof error === "string"
          ? error
          : "Unexpected error while processing opportunities upload.";

    console.error("Opportunity upload failed", {
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

    return jsonError(message, 500, {
      message,
    });
  }
}

export function GET() {
  return NextResponse.json(
    { ok: false, error: { message: "Method not allowed" } },
    { status: 405 },
  );
}
