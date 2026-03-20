import { jsonError, jsonOk } from "@/lib/apiResponses";
import { getAppSessionFromRequest } from "@/lib/appAuth";
import { inferCandidateProfileFromCv } from "@/lib/candidateProfile";
import { readSharedGithubAccessToken } from "@/lib/githubAuthStore";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { readTextFromFormData } from "@/lib/upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFirstEmail(text: string): string | undefined {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim().toLowerCase();
}

function extractFirstPhone(text: string): string | undefined {
  const candidates = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [];
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) {
      return candidate.trim();
    }
  }

  return undefined;
}

function redactCvContactDetails(params: {
  cvText: string;
  email?: string;
  phone?: string;
}): string {
  let redacted = params.cvText;

  if (params.email) {
    const emailPattern = new RegExp(escapeRegExp(params.email), "gi");
    redacted = redacted.replace(emailPattern, "[redacted-email]");
  }

  if (params.phone) {
    const phonePattern = new RegExp(escapeRegExp(params.phone), "gi");
    redacted = redacted.replace(phonePattern, "[redacted-phone]");
  }

  redacted = redacted.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[redacted-email]",
  );

  redacted = redacted.replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15
      ? "[redacted-phone]"
      : match;
  });

  redacted = redacted.replace(
    /https?:\/\/(?:www\.)?linkedin\.com\/[A-Za-z0-9\-_/?.=&%]+/gi,
    "[redacted-linkedin]",
  );

  return redacted;
}

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  if (!match) {
    return undefined;
  }

  return decodeURIComponent(match.split("=").slice(1).join("="));
}

function hasActionableExtraction(profile: {
  email?: string;
  phone?: string;
  skills: string[];
  certifications: string[];
  suggestedRoles: string[];
}): boolean {
  const signals = [
    Boolean(profile.email),
    Boolean(profile.phone),
    profile.skills.length > 0,
    profile.certifications.length > 0,
    profile.suggestedRoles.length > 0,
  ].filter(Boolean).length;

  if (signals >= 3) {
    return true;
  }

  return (
    signals >= 2 &&
    (profile.skills.length >= 2 || profile.suggestedRoles.length >= 1) &&
    Boolean(profile.email || profile.phone)
  );
}

export async function POST(request: Request) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const session = getAppSessionFromRequest(request);
    const formData = await request.formData();
    const payload = await readTextFromFormData(formData, "text");
    const candidateNameFromForm = formData.get("candidateName");
    const tokenFromForm = formData.get("githubAccessToken");

    if (!payload.text && !payload.fileBytes) {
      return jsonError("Provide text or a file", 400);
    }

    if (!payload.text) {
      return jsonError("Could not read text from the uploaded file", 400, {
        hint: "The file may be image-based or protected. Try a text-based PDF/DOCX or paste CV text directly.",
      });
    }

    const rawCV = payload.text;
    const manualCandidateName =
      typeof candidateNameFromForm === "string" && candidateNameFromForm.trim()
        ? candidateNameFromForm.trim()
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
      undefined;

    const profile = await inferCandidateProfileFromCv({
      cvText: rawCV,
      githubAccessToken: effectiveGithubToken,
    });

    const extractedEmail =
      profile.email?.trim().toLowerCase() || extractFirstEmail(rawCV);
    const extractedPhone = profile.phone?.trim() || extractFirstPhone(rawCV);

    const sanitisedProfile = {
      ...profile,
      email: extractedEmail,
      phone: extractedPhone,
    };

    const fullName = manualCandidateName ?? profile.fullName;

    if (!fullName) {
      return jsonError("AI could not infer candidate name from the CV", 400);
    }

    if (!hasActionableExtraction(sanitisedProfile)) {
      return jsonError(
        "AI extraction quality too low. CV details could not be extracted reliably.",
        422,
        {
          hint: "Try a cleaner text-based CV, paste CV text directly, or include contact and skills sections more clearly.",
          extracted: {
            email: sanitisedProfile.email ?? null,
            phone: sanitisedProfile.phone ?? null,
            skillsCount: sanitisedProfile.skills.length,
            certificationsCount: sanitisedProfile.certifications.length,
            suggestedRolesCount: sanitisedProfile.suggestedRoles.length,
          },
        },
      );
    }

    const redactedCV = redactCvContactDetails({
      cvText: rawCV,
      email: sanitisedProfile.email,
      phone: sanitisedProfile.phone,
    });

    const candidate = await prisma.candidate.create({
      data: {
        tenantId,
        ownerUserId: session?.uid,
        fullName,
        email: sanitisedProfile.email ?? null,
        phone: sanitisedProfile.phone ?? null,
        skillsCsv: sanitisedProfile.skills.join(", "),
        certificationsCsv: sanitisedProfile.certifications.join(", "),
        suggestedRolesCsv: sanitisedProfile.suggestedRoles.join(", "),
        rawCV: redactedCV,
        cvFileName: payload.fileName?.trim() || null,
        cvMimeType: payload.mimeType?.trim() || null,
        cvFileData: payload.fileBytes ? Buffer.from(payload.fileBytes) : null,
        cvUploadedAt: payload.fileBytes ? new Date() : null,
      },
    });

    return jsonOk({
      id: candidate.id,
      text: redactedCV,
      fullName: candidate.fullName,
      email: candidate.email,
      phone: candidate.phone,
      skills: sanitisedProfile.skills,
      certifications: sanitisedProfile.certifications,
      suggestedRoles: sanitisedProfile.suggestedRoles,
    });
  } catch (error) {
    const errorObj = error instanceof Error ? error : undefined;
    const rawMessage = errorObj?.message ?? String(error ?? "");
    const message = rawMessage.trim() || "Failed to upload CV";
    console.error("CV upload failed", {
      message,
      stack: errorObj?.stack,
    });
    const isClientIssue =
      /not configured|could not infer|extraction failed|returned empty/i.test(
        message,
      );
    const isPayloadTooLarge =
      /request body too large|max size|max tokens|tokens limit reached|cv is too large/i.test(
        message,
      );
    const isRateLimited =
      /RateLimitReached|rate limit|UserByModelByDay|ByDay/i.test(message);
    const isLowQuality =
      /quality too low|could not be extracted reliably/i.test(message);

    return jsonError(
      message,
      isClientIssue || isRateLimited || isPayloadTooLarge || isLowQuality
        ? 400
        : 500,
      {
        message,
        hint: isPayloadTooLarge
          ? "The CV content is too large for the current model window. Upload a shorter CV version or paste text directly."
          : isRateLimited
            ? "GitHub Models quota is exhausted. Retry after the daily reset."
            : isClientIssue
              ? "Connect GitHub Models in Settings, then upload again."
              : undefined,
      },
    );
  }
}

export function GET() {
  return NextResponse.json(
    { ok: false, error: { message: "Method not allowed" } },
    { status: 405 },
  );
}
