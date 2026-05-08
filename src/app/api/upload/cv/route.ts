import fs from "fs";
import path from "path";

import { jsonError, jsonOk } from "@/lib/apiResponses";
import { getAppSessionFromRequest } from "@/lib/appAuth";
import { inferCandidateProfileFromCv } from "@/lib/candidateProfile";
import { DEFAULT_OUTLOOK_MAILBOX } from "@/lib/constants";
import { formatCvForAts, renderFormattedCvText } from "@/lib/cvFormatter";
import { buildFormattedCvPdf } from "@/lib/pdfRedaction";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { readTextFromFormData } from "@/lib/upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const PDF_MIME_TYPE = "application/pdf";
const DEFAULT_MAILBOX =
  process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
  process.env.GRAPH_SENDER_USER?.trim() ||
  DEFAULT_OUTLOOK_MAILBOX;

function hasPdfSignature(bytes: ArrayBuffer | undefined): boolean {
  if (!bytes || bytes.byteLength < 5) {
    return false;
  }

  const signature = Buffer.from(bytes).subarray(0, 5).toString("ascii");
  return signature === "%PDF-";
}

function looksLikePdfFile(file: File): boolean {
  const lowerName = file.name.trim().toLowerCase();
  return file.type === PDF_MIME_TYPE || lowerName.endsWith(".pdf");
}

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

async function triggerCvFormatting(params: {
  candidateId: string;
  tenantId: string;
  rawCvText: string;
  candidateName: string;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
  originalCvFileName?: string;
}): Promise<void> {
  const sections = await formatCvForAts({
    rawCvText: params.rawCvText,
    candidateName: params.candidateName,
    skillsCsv: params.skillsCsv,
    certificationsCsv: params.certificationsCsv,
    suggestedRolesCsv: params.suggestedRolesCsv,
  });

  const formattedText = renderFormattedCvText(sections);
  const pdfBuffer = await buildFormattedCvPdf(sections);

  const safeNameSlug = params.candidateName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const formattedCvFileName = `${safeNameSlug}-formatted.pdf`;

  await prisma.candidate.update({
    where: { id: params.candidateId },
    data: {
      formattedCvText: formattedText,
      formattedCvPdfData: new Uint8Array(pdfBuffer),
      formattedCvFileName,
      formattedCvGeneratedAt: new Date(),
    },
  });

  // Also write the branded PDF to disk so it is immediately available
  // in the cv/<name>/ directory without needing a batch regeneration.
  try {
    const dataRoot = process.env.DATA_MOUNT_ROOT ?? process.cwd();
    const cvRoot = path.join(dataRoot, "cv");
    const candidateDir = path.join(cvRoot, safeNameSlug);
    const diskPdfPath = path.join(candidateDir, `${safeNameSlug}.pdf`);
    fs.mkdirSync(candidateDir, { recursive: true });
    fs.writeFileSync(diskPdfPath, pdfBuffer);
    console.log("[CV_FORMAT] PDF written to disk", { diskPdfPath });
  } catch (diskErr) {
    console.warn("[CV_FORMAT] Failed to write PDF to disk (non-fatal)", {
      candidateId: params.candidateId,
      message: (diskErr as Error).message,
    });
  }

  console.log("[CV_FORMAT] Formatted CV stored", {
    candidateId: params.candidateId,
    formattedCvFileName,
    textLength: formattedText.length,
    pdfBytes: pdfBuffer.byteLength,
  });
}

function parseBooleanFormValue(value: FormDataEntryValue | null): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalised = value.trim().toLowerCase();
  return normalised === "true" || normalised === "1" || normalised === "on";
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
    const uploadedFile = formData.get("file");
    const payload = await readTextFromFormData(formData, "text");
    const candidateNameFromForm = formData.get("candidateName");
    const removeContactInfoFromForm = formData.get("removeContactInfo");
    const removeContactInfo = parseBooleanFormValue(removeContactInfoFromForm);

    if (!(uploadedFile instanceof File) || uploadedFile.size === 0) {
      return jsonError("Please upload a PDF CV file.", 400);
    }

    if (!looksLikePdfFile(uploadedFile)) {
      return jsonError(
        "Only PDF CV uploads are allowed so original formatting is preserved.",
        400,
      );
    }

    if (!hasPdfSignature(payload.fileBytes)) {
      return jsonError("Uploaded file is not a valid PDF document.", 400);
    }

    if (!payload.text) {
      return jsonError("Could not read text from the uploaded PDF file", 400, {
        hint: "The PDF may be image-based or protected. Upload a text-based PDF.",
      });
    }

    const rawCV = payload.text;
    const manualCandidateName =
      typeof candidateNameFromForm === "string" && candidateNameFromForm.trim()
        ? candidateNameFromForm.trim()
        : undefined;

    const modelOverride =
      typeof formData.get("model") === "string"
        ? (formData.get("model") as string)
        : typeof formData.get("aiProvider") === "string"
          ? (formData.get("aiProvider") as string)
          : undefined;

    const profile = await inferCandidateProfileFromCv({
      cvText: rawCV,
      model: modelOverride,
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
    const storedCvText = removeContactInfo ? redactedCV : rawCV;

    // Prevent duplicate candidates — if an active candidate with the same
    // email already exists in the tenant, update instead of creating.
    let candidate;
    const existingCandidate = sanitisedProfile.email
      ? await prisma.candidate.findFirst({
          where: {
            tenantId,
            email: sanitisedProfile.email,
            isActive: true,
          },
        })
      : null;

    if (existingCandidate) {
      candidate = await prisma.candidate.update({
        where: { id: existingCandidate.id },
        data: {
          fullName,
          phone: sanitisedProfile.phone ?? existingCandidate.phone,
          skillsCsv: sanitisedProfile.skills.join(", "),
          certificationsCsv: sanitisedProfile.certifications.join(", "),
          suggestedRolesCsv: sanitisedProfile.suggestedRoles.join(", "),
          rawCV: storedCvText,
          cvStorageMode: "FULL",
          cvFileName:
            uploadedFile.name.trim() || payload.fileName?.trim() || null,
          cvMimeType: PDF_MIME_TYPE,
          cvFileData: payload.fileBytes ? Buffer.from(payload.fileBytes) : null,
          cvUploadedAt: payload.fileBytes ? new Date() : null,
        },
      });
      console.info("[CV_UPLOAD] Updated existing candidate", {
        candidateId: candidate.id,
        email: candidate.email,
      });
    } else {
      candidate = await prisma.candidate.create({
        data: {
          tenantId,
          ownerUserId: session?.uid,
          fullName,
          email: sanitisedProfile.email ?? null,
          phone: sanitisedProfile.phone ?? null,
          skillsCsv: sanitisedProfile.skills.join(", "),
          certificationsCsv: sanitisedProfile.certifications.join(", "),
          suggestedRolesCsv: sanitisedProfile.suggestedRoles.join(", "),
          rawCV: storedCvText,
          cvStorageMode: "FULL",
          cvFileName:
            uploadedFile.name.trim() || payload.fileName?.trim() || null,
          cvMimeType: PDF_MIME_TYPE,
          cvFileData: payload.fileBytes ? Buffer.from(payload.fileBytes) : null,
          cvUploadedAt: payload.fileBytes ? new Date() : null,
        },
      });
    }

    // Fire-and-forget: reformat the CV in the background so it is ready for
    // email generation without blocking the upload response.
    void triggerCvFormatting({
      candidateId: candidate.id,
      tenantId,
      rawCvText: rawCV,
      candidateName: fullName,
      skillsCsv: sanitisedProfile.skills.join(", "),
      certificationsCsv: sanitisedProfile.certifications.join(", "),
      suggestedRolesCsv: sanitisedProfile.suggestedRoles.join(", "),
      originalCvFileName: candidate.cvFileName ?? undefined,
    }).catch((err) => {
      console.error("[CV_FORMAT] Background formatting failed", {
        candidateId: candidate.id,
        message: (err as Error).message,
      });
    });

    // Fire-and-forget: create and send role & rate confirmation draft.
    if (candidate.email && sanitisedProfile.suggestedRoles.length > 0) {
      import("@/lib/roleConfirmationEmail").then(
        async ({ sendRoleConfirmationDraft }) => {
          try {
            const draft = await sendRoleConfirmationDraft({
              candidateId: candidate.id,
              candidateName: fullName,
              email: candidate.email!,
              suggestedRoles: sanitisedProfile.suggestedRoles,
            });
            if (draft?.id) {
              const { sendDraftFromMailbox } =
                await import("@/lib/sendDraftFromMailbox");
              await sendDraftFromMailbox(DEFAULT_MAILBOX, draft.id);
              console.info("[ROLE_CONFIRM] Email sent", {
                candidateId: candidate.id,
              });
            }
          } catch (err) {
            console.error(
              "[ROLE_CONFIRM] Failed to create/send confirmation draft",
              {
                candidateId: candidate.id,
                message: (err as Error)?.message,
              },
            );
          }
        },
      );
    }

    // Fire-and-forget: create and send NDA & Teaming Agreement draft.
    if (candidate.email) {
      import("@/lib/ndaTeamingDraft").then(async ({ sendNdaTeamingDraft }) => {
        try {
          const draft = await sendNdaTeamingDraft({
            candidateId: candidate.id,
            candidateName: fullName,
            email: candidate.email!,
          });
          if (draft?.id) {
            const { sendDraftFromMailbox } =
              await import("@/lib/sendDraftFromMailbox");
            await sendDraftFromMailbox(DEFAULT_MAILBOX, draft.id);
            console.info("[NDA_TEAMING] Email sent", {
              candidateId: candidate.id,
            });
          }
        } catch (err) {
          console.error(
            "[NDA_TEAMING] Failed to create/send NDA/Teaming draft",
            {
              candidateId: candidate.id,
              message: (err as Error)?.message,
            },
          );
        }
      });
    }

    return jsonOk({
      id: candidate.id,
      text: storedCvText,
      fullName: candidate.fullName,
      email: candidate.email,
      phone: candidate.phone,
      skills: sanitisedProfile.skills,
      certifications: sanitisedProfile.certifications,
      suggestedRoles: sanitisedProfile.suggestedRoles,
      removeContactInfo,
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

    const safeLabel = isPayloadTooLarge
      ? "CV content exceeds size limit"
      : isRateLimited
        ? "AI quota exhausted"
        : isClientIssue
          ? "LiteLLM not configured"
          : isLowQuality
            ? "CV quality too low for extraction"
            : "Failed to upload CV";

    return jsonError(
      safeLabel,
      isClientIssue || isRateLimited || isPayloadTooLarge || isLowQuality
        ? 400
        : 500,
      {
        hint: isPayloadTooLarge
          ? "The CV content is too large for the current model window. Upload a shorter CV version or paste text directly."
          : isRateLimited
            ? "LiteLLM quota is exhausted. Retry after the quota reset."
            : isClientIssue
              ? "Configure LiteLLM, then upload again."
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
