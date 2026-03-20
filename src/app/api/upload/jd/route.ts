import { generateStructuredJson } from "@/lib/aiJson";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { getAppSessionFromRequest } from "@/lib/appAuth";
import { resolveCompanyForTenant } from "@/lib/companyResolution";
import { readSharedGithubAccessToken } from "@/lib/githubAuthStore";
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

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  if (!match) {
    return undefined;
  }

  return decodeURIComponent(match.split("=").slice(1).join("="));
}

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

function extractEmailFromText(text: string): string | undefined {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim().toLowerCase();
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
    const tokenFromForm = formData.get("githubAccessToken");

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

    const githubAccessToken =
      typeof tokenFromForm === "string" && tokenFromForm.trim()
        ? tokenFromForm.trim()
        : undefined;
    const cookieGithubToken = getCookieValue(request, "githubAccessToken");
    const sharedGithubToken = await readSharedGithubAccessToken();
    const effectiveGithubToken =
      githubAccessToken ||
      cookieGithubToken?.trim() ||
      sharedGithubToken?.trim() ||
      process.env.GITHUB_MODELS_TOKEN ||
      undefined;

    if (!effectiveGithubToken) {
      if (uploadId) {
        failUploadProgress({
          uploadId,
          tenantId,
          message: "AI token is missing for job parsing.",
        });
      }
      return jsonError("ChatGPT 5.3 token is required for job parsing", 400, {
        hint: "Connect GitHub Models in Settings before uploading a job description.",
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
    }>({
      provider: "github-models",
      githubAccessToken: effectiveGithubToken,
      systemPrompt:
        "Extract structured job metadata from the uploaded job description text. Return strict JSON only with keys role, companyName, opportunityEmail, opportunityUrl. If unknown, return empty string.",
      userPrompt: `JOB DESCRIPTION TEXT:\n${rawText}\n\nHints:\n- roleHint: ${roleHint ?? ""}\n- companyNameHint: ${companyHint ?? ""}\n\nRules:\n- role must be a specific role title only.\n- companyName must be the client/company name only.\n- opportunityEmail must contain only one contact email address when present.\n- opportunityUrl must contain only one source URL when present.\n- Use hints only when they align with the uploaded text.\nReturn JSON only: {"role":"","companyName":"","opportunityEmail":"","opportunityUrl":""}`,
      maxTokens: 350,
      temperature: 0,
    });

    const linkedInFallback = extractRoleCompanyFromAtPattern(rawText);
    const role =
      cleanField(extracted.role, 120) ??
      cleanField(linkedInFallback.role, 120) ??
      cleanField(roleHint, 120);
    const companyName =
      cleanField(extracted.companyName, 120) ??
      cleanField(linkedInFallback.companyName, 120) ??
      cleanField(companyHint, 120);
    const opportunityEmail =
      cleanField(extracted.opportunityEmail, 320)?.toLowerCase() ??
      extractEmailFromText(rawText);
    const opportunityUrl =
      cleanField(extracted.opportunityUrl, 1000) ?? extractUrlFromText(rawText);

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

    if (!role) {
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

    const job = await prisma.job.create({
      data: {
        tenantId,
        ownerUserId: session?.uid,
        title: role,
        rawText,
        companyId: companyResolution.companyId,
        opportunityEmail: opportunityEmail || null,
        opportunityUrl: opportunityUrl || null,
      },
      include: {
        company: true,
      },
    });

    if (uploadId) {
      completeUploadProgress({
        uploadId,
        tenantId,
        message: "Job upload completed successfully.",
      });
    }

    return jsonOk({
      id: job.id,
      text: rawText,
      title: job.title,
      companyName: job.company?.name ?? null,
      opportunityEmail: job.opportunityEmail ?? null,
      opportunityUrl: job.opportunityUrl ?? null,
    });
  } catch (error) {
    if (uploadId && tenantIdForProgress) {
      failUploadProgress({
        uploadId,
        tenantId: tenantIdForProgress,
        message: (error as Error).message || "Job upload failed.",
      });
    }

    return jsonError("Failed to upload job description", 500, {
      message: (error as Error).message,
    });
  }
}

export function GET() {
  return NextResponse.json(
    { ok: false, error: { message: "Method not allowed" } },
    { status: 405 },
  );
}
