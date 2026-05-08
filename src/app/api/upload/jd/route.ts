import { generateStructuredJson } from "@/lib/aiJson";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { getAppSessionFromRequest } from "@/lib/appAuth";
import { resolveCompanyForTenant } from "@/lib/companyResolution";
import { classifyJob } from "@/lib/jobClassification";
import { getAiGatewayEnvHint, isAiGatewayConfigured } from "@/lib/liteLlm";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { readTextFromFormData } from "@/lib/upload";
import {
    completeUploadProgress,
    failUploadProgress,
    sanitiseUploadId,
    startUploadProgress,
    updateUploadProgress,
} from "@/lib/uploadProgress";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function cleanField(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return undefined;
  }

  return cleaned.length <= maxLength ? cleaned : cleaned.slice(0, maxLength);
}

function parseListField(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const items = value
    .split(/[\n,;|]+/)
    .map((item) => item.replace(/^[-*\u2022\s]+/, "").trim())
    .filter(Boolean)
    .map((item) => item.replace(/\s+/g, " "));

  return [...new Set(items)];
}

function extractEmailFromText(text: string): string | undefined {
  const match = text.match(EMAIL_PATTERN);
  return match?.[0]?.trim().toLowerCase();
}

function normaliseOpportunityEmail(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(EMAIL_PATTERN)?.[0];
  return match?.trim().toLowerCase();
}

function extractUrlFromText(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)\]]+/i);
  return match?.[0]?.trim();
}

function looksLikeRole(value: string): boolean {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length < 3 || cleaned.length > 120) {
    return false;
  }

  return /\b(lead|head|manager|engineer|architect|analyst|consultant|specialist|developer|administrator|officer|recruitment|talent|director)\b/i.test(
    cleaned,
  );
}

function normaliseRoleCandidate(value: string): string {
  return value
    .replace(/^linkedin\s+opportunit(?:y|ies):?\s*/i, "")
    .replace(/^role:?\s*/i, "")
    .replace(/^\d+[.)-]\s*/, "")
    .replace(/[|,;:\-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitRolesFromValue(value: string): string[] {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return [];
  }

  const withoutTail = compact
    .replace(
      /\b(contract\s+roles?|contract\s+role|roles?\s+for|openings?|positions?)\b.*$/i,
      "",
    )
    .trim();

  const source = withoutTail || compact;
  const parts = source
    .split(/\s*[\n;,|]\s*|\s+\/\s+/i)
    .map((part) => normaliseRoleCandidate(part))
    .filter(Boolean)
    .filter((part) => part.length <= 120)
    .filter(looksLikeRole);

  return [...new Set(parts)];
}

function deriveRolesFromUpload(params: {
  extractedRole?: string;
  roleHint?: string;
  rawText: string;
}): string[] {
  const fromExtracted = splitRolesFromValue(params.extractedRole ?? "");
  const fromHint = splitRolesFromValue(params.roleHint ?? "");

  const rawLead = params.rawText
    .replace(/\s+/g, " ")
    .split(/https?:\/\//i)[0]
    ?.slice(0, 280);
  const fromRawLead = splitRolesFromValue(rawLead ?? "");

  const combined = [...fromExtracted, ...fromHint, ...fromRawLead];
  const unique = [...new Set(combined)].filter(looksLikeRole);

  if (unique.length > 0) {
    return unique;
  }

  const fallbackRole = cleanField(params.extractedRole, 120);
  return fallbackRole ? [fallbackRole] : [];
}

function extractRoleCompanyFromAtPattern(text: string): {
  role?: string;
  companyName?: string;
} {
  const compact = text
    .replace(/\s+/g, " ")
    .replace(/[\u2022]/g, "•")
    .trim();
  const atPattern =
    /(.{0,140}?)\s+at\s+([A-Za-z][A-Za-z0-9&.,'’\- ]{1,90})(?=\s*(?:\||$))/i;
  const match = compact.match(atPattern);
  if (!match) {
    return {};
  }

  const rawRoleSegment = match[1] ?? "";
  const rawCompany = match[2] ?? "";

  const roleCandidate = rawRoleSegment
    .split("•")
    .pop()
    ?.replace(/\bverified profile\b/gi, "")
    .replace(/\b\d+(?:st|nd|rd|th)?\+?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const companyCandidate = rawCompany
    .replace(/[|,;]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    role:
      roleCandidate && looksLikeRole(roleCandidate) ? roleCandidate : undefined,
    companyName: companyCandidate || undefined,
  };
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
        message: "Reading uploaded job description.",
      });
      updateUploadProgress({
        uploadId,
        tenantId,
        percent: 10,
        message: "Extracting text from uploaded file.",
      });
    }

    const payload = await readTextFromFormData(formData, "text");
    const roleFromForm = formData.get("role");
    const companyNameFromForm = formData.get("companyName");
    const opportunityEmailFromForm = formData.get("opportunityEmail");
    if (!payload.text && !payload.fileBytes) {
      return jsonError("Provide text or a file", 400);
    }

    if (!payload.text) {
      if (uploadId) {
        failUploadProgress({
          uploadId,
          tenantId,
          message: "Unable to read text from the uploaded file.",
        });
      }
      return jsonError("Could not read text from the uploaded file", 400);
    }

    const rawText = payload.text;
    const roleHint =
      typeof roleFromForm === "string" && roleFromForm.trim()
        ? roleFromForm.trim()
        : undefined;
    const companyHint =
      typeof companyNameFromForm === "string" && companyNameFromForm.trim()
        ? companyNameFromForm.trim()
        : undefined;

    const gatewayConfigured = isAiGatewayConfigured();

    if (!gatewayConfigured) {
      if (uploadId) {
        failUploadProgress({
          uploadId,
          tenantId,
          message: "AI is not configured for job parsing.",
        });
      }
      return jsonError("AI is not configured for job parsing", 400, {
        hint: getAiGatewayEnvHint(),
      });
    }

    if (uploadId) {
      updateUploadProgress({
        uploadId,
        tenantId,
        percent: 40,
        message: "Running AI extraction for role and company.",
      });
    }

    const extracted = await generateStructuredJson<{
      role?: string;
      companyName?: string;
      opportunityEmail?: string;
      opportunityUrl?: string;
      description?: string;
      requiredSkills?: string;
      requiredCertifications?: string;
    }>({
      systemPrompt:
        "Extract structured job metadata from the uploaded job description text. Return strict JSON only with keys role, companyName, opportunityEmail, opportunityUrl, description, requiredSkills, requiredCertifications. If unknown, return empty string.",
      userPrompt: `JOB DESCRIPTION TEXT:\n${rawText}\n\nHints:\n- roleHint: ${roleHint ?? ""}\n- companyNameHint: ${companyHint ?? ""}\n\nRules:\n- role must be a specific role title only.\n- companyName must be the client/company name only.\n- opportunityEmail must contain only one contact email address when present.\n- opportunityUrl must contain only one source URL when present.\n- description must be a concise job summary (2-6 sentences).\n- requiredSkills must be a comma-separated list of technical and functional skills.\n- requiredCertifications must be a comma-separated list of required or preferred certifications.\n- Use hints only when they align with the uploaded text.\nReturn JSON only: {"role":"","companyName":"","opportunityEmail":"","opportunityUrl":"","description":"","requiredSkills":"","requiredCertifications":""}`,
      maxTokens: 350,
      temperature: 0,
    });

    const linkedInFallback = extractRoleCompanyFromAtPattern(rawText);
    const primaryRole =
      cleanField(extracted.role, 120) ??
      cleanField(linkedInFallback.role, 120) ??
      cleanField(roleHint, 120);
    const roles = deriveRolesFromUpload({
      extractedRole: primaryRole,
      roleHint: cleanField(roleHint, 120),
      rawText,
    });
    const companyName =
      cleanField(extracted.companyName, 120) ??
      cleanField(linkedInFallback.companyName, 120) ??
      cleanField(companyHint, 120);
    const opportunityEmailOverride =
      typeof opportunityEmailFromForm === "string" &&
      opportunityEmailFromForm.trim()
        ? opportunityEmailFromForm.trim()
        : undefined;
    const opportunityEmail =
      normaliseOpportunityEmail(
        cleanField(opportunityEmailOverride ?? extracted.opportunityEmail, 320),
      ) ?? extractEmailFromText(rawText);
    const opportunityUrl =
      cleanField(extracted.opportunityUrl, 1000) ?? extractUrlFromText(rawText);
    const description =
      cleanField(extracted.description, 4000) ?? cleanField(rawText, 4000);
    const requiredSkills = parseListField(
      cleanField(extracted.requiredSkills, 2000),
    );
    const requiredCertifications = parseListField(
      cleanField(extracted.requiredCertifications, 2000),
    );

    const companyResolution = await resolveCompanyForTenant(
      tenantId,
      companyName,
    );

    if (!companyResolution.companyId) {
      if (uploadId) {
        failUploadProgress({
          uploadId,
          tenantId,
          message: "AI could not infer a company name.",
        });
      }
      return jsonError(
        "AI could not infer company name from the job text",
        400,
      );
    }

    if (roles.length === 0) {
      if (uploadId) {
        failUploadProgress({
          uploadId,
          tenantId,
          message: "AI could not infer a role title.",
        });
      }
      return jsonError("AI could not infer role title from the job text", 400);
    }

    if (uploadId) {
      updateUploadProgress({
        uploadId,
        tenantId,
        percent: 75,
        message: "Saving parsed job in the database.",
      });
    }

    const createdJobs = [] as Array<{
      id: string;
      title: string;
      company: { name: string } | null;
      opportunityEmail: string | null;
      opportunityUrl: string | null;
    }>;

    for (const role of roles) {
      const classification = classifyJob(role, rawText);
      const created = await prisma.job.create({
        data: {
          tenantId,
          ownerUserId: session?.uid,
          title: role,
          description: description || null,
          requiredSkillsCsv:
            requiredSkills.length > 0 ? requiredSkills.join(", ") : null,
          requiredCertificationsCsv:
            requiredCertifications.length > 0
              ? requiredCertifications.join(", ")
              : null,
          rawText,
          companyId: companyResolution.companyId,
          opportunityEmail: opportunityEmail || null,
          opportunityUrl: opportunityUrl || null,
          isRemote: classification.isRemote,
          requiresUsWorkAuth: classification.requiresUsWorkAuth,
          requiresUkWorkAuth: classification.requiresUkWorkAuth,
          requiresNonSaLocation: classification.requiresNonSaLocation,
        },
        include: {
          company: true,
        },
      });

      createdJobs.push({
        id: created.id,
        title: created.title,
        company: created.company,
        opportunityEmail: created.opportunityEmail ?? null,
        opportunityUrl: created.opportunityUrl ?? null,
      });
    }

    const primaryJob = createdJobs[0];

    if (uploadId) {
      completeUploadProgress({
        uploadId,
        tenantId,
        message: "Job upload completed successfully.",
      });
    }

    const missingEmail = !opportunityEmail;

    return jsonOk({
      id: primaryJob?.id ?? "",
      text: rawText,
      title: primaryJob?.title ?? null,
      companyName: primaryJob?.company?.name ?? null,
      opportunityEmail: primaryJob?.opportunityEmail ?? null,
      opportunityUrl: primaryJob?.opportunityUrl ?? null,
      description: description ?? null,
      requiredSkills,
      requiredCertifications,
      createdJobCount: createdJobs.length,
      ...(missingEmail
        ? {
            warning:
              "No recruiter contact email was found in the job description. This opportunity will not appear on the match review board until a contact email is added.",
          }
        : {}),
      createdJobs: createdJobs.map((job) => ({
        id: job.id,
        title: job.title,
        companyName: job.company?.name ?? null,
        opportunityEmail: job.opportunityEmail,
        opportunityUrl: job.opportunityUrl,
      })),
    });
  } catch (error) {
    if (uploadId && tenantIdForProgress) {
      failUploadProgress({
        uploadId,
        tenantId: tenantIdForProgress,
        message: error instanceof Error ? error.message : "Job upload failed.",
      });
    }
    console.error("[UPLOAD_JD]", error);
    return jsonError("Failed to upload job description", 500);
  }
}

export function GET() {
  return NextResponse.json(
    { ok: false, error: { message: "Method not allowed" } },
    { status: 405 },
  );
}
