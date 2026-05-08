import fs from "fs";
import path from "path";

import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/apiResponses";
import { inferCandidateProfileFromCv } from "@/lib/candidateProfile";
import { DEFAULT_OUTLOOK_MAILBOX } from "@/lib/constants";
import { formatCvForAts, renderFormattedCvText } from "@/lib/cvFormatter";
import { sendMail } from "@/lib/mailer";
import { buildFormattedCvPdf } from "@/lib/pdfRedaction";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";
import { readTextFromFormData } from "@/lib/upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Tenant ID for the primary operating tenant. */
const DEFAULT_SIGNUP_TENANT_ID =
  process.env.MASTER_TENANT_ID?.trim() || "default";

/** Maximum CV signup attempts per IP per window. */
const MAX_SIGNUPS_PER_WINDOW = 5;
const SIGNUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const ALLOWED_MIME_TYPES = new Set(["application/pdf"]);

const PDF_MIME_TYPE = "application/pdf";

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

  if (signals >= 3) return true;

  return (
    signals >= 2 &&
    (profile.skills.length >= 2 || profile.suggestedRoles.length >= 1) &&
    Boolean(profile.email || profile.phone)
  );
}

function safeString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Step 1 — Preview: Upload CV, extract profile via AI, return preview.
 * Step 2 — Confirm: Submit reviewed data (JSON body) to save the candidate.
 *
 * Determined by Content-Type:
 *   multipart/form-data → preview step
 *   application/json    → confirm step
 */
export async function POST(request: Request) {
  const crossOriginBlock = rejectCrossOrigin(request);
  if (crossOriginBlock) return crossOriginBlock;

  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = checkRateLimit(
    `candidate-signup:${ip}`,
    MAX_SIGNUPS_PER_WINDOW,
    SIGNUP_WINDOW_MS,
  );
  if (!allowed) {
    return jsonError("Too many signup attempts. Please try again later.", 429, {
      retryAfterMs,
    });
  }

  const contentType = request.headers.get("content-type") ?? "";

  // ── Step 2: Confirm & save ────────────────────────────────────────
  if (contentType.includes("application/json")) {
    return handleConfirm(request);
  }

  // ── Step 1: Preview extraction ────────────────────────────────────
  return handlePreview(request);
}

/** Step 1 — extract profile from uploaded CV and return a preview. */
async function handlePreview(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const payload = await readTextFromFormData(formData, "text");

    if (!(file instanceof File) || file.size === 0) {
      return jsonError("Please upload your CV as a PDF file.", 400);
    }

    if (!looksLikePdfFile(file)) {
      return jsonError(
        "Only PDF CV uploads are allowed so original formatting is preserved.",
        400,
      );
    }

    if (!hasPdfSignature(payload.fileBytes)) {
      return jsonError("Uploaded file is not a valid PDF document.", 400);
    }

    if (
      file.type?.toLowerCase() &&
      !ALLOWED_MIME_TYPES.has(file.type.toLowerCase())
    ) {
      return jsonError(
        "Unsupported file type. Please upload a PDF CV file.",
        400,
      );
    }

    if (!payload.text && !payload.fileBytes) {
      return jsonError("Please upload your CV file.", 400);
    }

    if (!payload.text) {
      return jsonError("Could not read text from the uploaded file.", 400, {
        hint: "The PDF may be image-based or protected. Try a text-based PDF.",
      });
    }

    const rawCV = payload.text;

    const manualName = safeString(formData.get("fullName"));
    const manualEmail = safeString(formData.get("email"))?.toLowerCase();
    const manualPhone = safeString(formData.get("phone"));

    const modelOverride =
      safeString(formData.get("model")) ??
      safeString(formData.get("aiProvider"));

    const profile = await inferCandidateProfileFromCv({
      cvText: rawCV,
      model: modelOverride,
    });

    const extractedEmail =
      manualEmail ||
      profile.email?.trim().toLowerCase() ||
      extractFirstEmail(rawCV);
    const extractedPhone =
      manualPhone || profile.phone?.trim() || extractFirstPhone(rawCV);

    const sanitisedProfile = {
      ...profile,
      email: extractedEmail,
      phone: extractedPhone,
    };

    const fullName = manualName ?? profile.fullName;

    if (!fullName) {
      return jsonError(
        "Could not determine your name. Please enter it in the form.",
        400,
      );
    }

    if (!hasActionableExtraction(sanitisedProfile)) {
      return jsonError(
        "We could not extract enough details from your CV. Please try a cleaner document.",
        422,
      );
    }

    const cvFileData = payload.fileBytes
      ? Buffer.from(payload.fileBytes)
      : null;
    if (!cvFileData) {
      return jsonError("PDF file data is missing from the upload.", 400);
    }

    // Return preview — nothing saved yet.
    // The CV binary is returned as base64 so the confirm step can include it
    // directly in the JSON body. The WAF non-file body limit is raised to
    // 12.5 MB so this is safe for any reasonable CV size.
    return jsonOk({
      preview: true,
      fullName,
      email: sanitisedProfile.email ?? null,
      phone: sanitisedProfile.phone ?? null,
      skills: sanitisedProfile.skills,
      certifications: sanitisedProfile.certifications,
      suggestedRoles: sanitisedProfile.suggestedRoles,
      cvFileName: payload.fileName?.trim() || null,
      _rawCV: rawCV,
      _cvFileName: payload.fileName?.trim() || null,
      _cvMimeType: PDF_MIME_TYPE,
      _cvFileBase64: cvFileData.toString("base64"),
    });
  } catch (error) {
    return handleError(error, "preview");
  }
}

/** Step 2 — save the candidate after the user has reviewed the preview. */
async function handleConfirm(request: Request) {
  try {
    const body = await request.json();

    const fullName =
      typeof body.fullName === "string" ? body.fullName.trim() : "";
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
    const phone = typeof body.phone === "string" ? body.phone.trim() : null;
    const skills: string[] = Array.isArray(body.skills) ? body.skills : [];
    const certifications: string[] = Array.isArray(body.certifications)
      ? body.certifications
      : [];
    const suggestedRoles: string[] = Array.isArray(body.suggestedRoles)
      ? body.suggestedRoles
      : [];
    const rawCV = typeof body._rawCV === "string" ? body._rawCV : null;
    const cvFileName =
      typeof body._cvFileName === "string" ? body._cvFileName : null;
    const cvMimeType =
      typeof body._cvMimeType === "string" ? body._cvMimeType : PDF_MIME_TYPE;
    const cvFileBase64 =
      typeof body._cvFileBase64 === "string" ? body._cvFileBase64 : null;
    const cvFileData = cvFileBase64
      ? Buffer.from(cvFileBase64, "base64")
      : null;

    if (!fullName) {
      return jsonError("Full name is required.", 400);
    }
    if (!rawCV || !cvFileData) {
      return jsonError("CV data is missing. Please start again.", 400);
    }

    // Duplicate check
    if (email) {
      const existing = await prisma.candidate.findFirst({
        where: { tenantId: DEFAULT_SIGNUP_TENANT_ID, email },
        select: { id: true },
      });
      if (existing) {
        return jsonError(
          "A candidate with this email address already exists. If this is you, please contact us directly.",
          409,
        );
      }
    }

    const candidate = await prisma.candidate.create({
      data: {
        tenantId: DEFAULT_SIGNUP_TENANT_ID,
        fullName,
        email: email || null,
        phone: phone || null,
        skillsCsv: skills.join(", "),
        certificationsCsv: certifications.join(", "),
        suggestedRolesCsv: suggestedRoles.join(", "),
        rawCV,
        cvFileName: cvFileName || null,
        cvMimeType,
        cvFileData: cvFileData as unknown as Uint8Array<ArrayBuffer>,
        cvUploadedAt: new Date(),
      },
    });

    // Fire-and-forget: format the CV and write to disk.
    void (async () => {
      try {
        const sections = await formatCvForAts({
          rawCvText: rawCV,
          candidateName: fullName,
          skillsCsv: skills.join(", "),
          certificationsCsv: certifications.join(", "),
          suggestedRolesCsv: suggestedRoles.join(", "),
        });
        const formattedText = renderFormattedCvText(sections);
        const pdfBuffer = await buildFormattedCvPdf(sections);
        const slug = fullName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40);
        const fmtFileName = `${slug}-formatted.pdf`;

        await prisma.candidate.update({
          where: { id: candidate.id },
          data: {
            formattedCvText: formattedText,
            formattedCvPdfData: new Uint8Array(pdfBuffer),
            formattedCvFileName: fmtFileName,
            formattedCvGeneratedAt: new Date(),
          },
        });

        const cvRoot = path.join(process.cwd(), "cv");
        const candidateDir = path.join(cvRoot, slug);
        fs.mkdirSync(candidateDir, { recursive: true });
        fs.writeFileSync(path.join(candidateDir, `${slug}.pdf`), pdfBuffer);
        console.log("[candidate-signup] CV formatted & saved", {
          candidateId: candidate.id,
        });
      } catch (fmtErr) {
        console.error("[candidate-signup] CV formatting failed (non-fatal)", {
          candidateId: candidate.id,
          message: (fmtErr as Error).message,
        });
      }
    })();

    // Notify team about new candidate needing vetting
    notifyNewCandidate(
      candidate.id,
      fullName,
      email,
      skills,
      certifications,
      suggestedRoles,
      cvFileData,
      cvFileName,
      cvMimeType,
    ).catch((err) =>
      console.error("[candidate-signup] notification failed:", err),
    );

    return jsonOk({
      id: candidate.id,
      fullName: candidate.fullName,
      message:
        "Thank you for signing up! Your CV has been received and is being reviewed.",
    });
  } catch (error) {
    return handleError(error, "confirm");
  }
}

function handleError(error: unknown, step: string) {
  const errorObj = error instanceof Error ? error : undefined;
  const rawMessage = errorObj?.message ?? String(error ?? "");
  console.error(`Public candidate signup (${step}) failed`, {
    message: rawMessage,
    stack: errorObj?.stack,
  });

  const isRateLimited =
    /RateLimitReached|rate limit|UserByModelByDay|ByDay/i.test(rawMessage);
  const isPayloadTooLarge =
    /request body too large|max size|max tokens|cv is too large/i.test(
      rawMessage,
    );

  if (isPayloadTooLarge) {
    return jsonError(
      "Your CV file is too large. Please upload a smaller file.",
      400,
    );
  }
  if (isRateLimited) {
    return jsonError(
      "Our processing service is temporarily busy. Please try again later.",
      503,
    );
  }

  return jsonError(
    "Something went wrong processing your signup. Please try again.",
    500,
  );
}

/** Send an email notification to the tenant team about a new candidate needing vetting. */
async function notifyNewCandidate(
  candidateId: string,
  fullName: string,
  email: string | null,
  skills: string[],
  certifications: string[],
  suggestedRoles: string[],
  cvFileData: Buffer,
  cvFileName: string,
  cvMimeType: string,
): Promise<void> {
  // Candidate registration notifications go only to the placements operational inbox.
  // Finance report recipients (reportRecipientsCsv) must not be included here.
  const recipients = DEFAULT_OUTLOOK_MAILBOX ? [DEFAULT_OUTLOOK_MAILBOX] : [];

  const fmt = (arr: string[], fallback = "None extracted") =>
    arr.length > 0 ? arr.join(", ") : fallback;

  await sendMail({
    to: recipients,
    subject: `New candidate registration — ${fullName} — vetting required`,
    text: [
      `A new candidate has registered via the public signup page and requires vetting.`,
      ``,
      `Name:              ${fullName}`,
      `Email:             ${email ?? "Not provided"}`,
      `Skills:            ${fmt(skills)}`,
      `Certifications:    ${fmt(certifications)}`,
      `Suggested roles:   ${fmt(suggestedRoles)}`,
      ``,
      `Please review and vet this candidate in the Candidates section.`,
      `Candidate ID: ${candidateId}`,
    ].join("\n"),
    attachments: [
      {
        filename: cvFileName || "cv.pdf",
        contentBase64: cvFileData.toString("base64"),
        contentType: cvMimeType || "application/pdf",
      },
    ],
  });
}

export function GET() {
  return NextResponse.json(
    { ok: false, error: { message: "Method not allowed" } },
    { status: 405 },
  );
}
