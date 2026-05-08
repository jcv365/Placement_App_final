import { handleAuthError, jsonError, jsonOk } from "@/lib/apiResponses";
import { DEFAULT_OUTLOOK_MAILBOX } from "@/lib/constants";
import { createOutlookDraft, createOutlookDraftForMailbox } from "@/lib/graph";
import {
  decryptGraphAccessToken,
  isGraphConnectionUsable,
} from "@/lib/graphConnectionStore";
import {
  buildRedactedCvPdfFromText,
  redactContactDetailsInPdf,
} from "@/lib/pdfRedaction";
import { prisma } from "@/lib/prisma";
import { canTransition } from "@/lib/stages";
import { requireAuthenticatedTenantId } from "@/lib/tenant";
import { emailDraftCleanupSchema, emailDraftSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** When OUTLOOK_SHARED_MAILBOX is set at the process level, drafts are always
 *  created in that shared mailbox rather than per-company connected tokens. */
const SHARED_MAILBOX_MODE = Boolean(process.env.OUTLOOK_SHARED_MAILBOX?.trim());

export async function POST(request: Request) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const body = emailDraftSchema.parse(await request.json());

    const draft = await prisma.emailDraft.findFirst({
      where: { id: body.emailDraftId, tenantId },
    });

    if (!draft) {
      return jsonError("Email draft not found", 404);
    }

    if (draft.applicationId !== body.applicationId) {
      return jsonError("Email draft does not match application", 400);
    }

    const application = await prisma.application.findFirst({
      where: { id: body.applicationId, tenantId },
      include: {
        job: {
          select: {
            companyId: true,
          },
        },
        candidate: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            rawCV: true,
            cvFileName: true,
            cvMimeType: true,
            cvFileData: true,
            formattedCvPdfData: true,
            formattedCvFileName: true,
          },
        },
      },
    });

    const companySettings = application?.job.companyId
      ? await prisma.companySettings.findUnique({
          where: { companyId: application.job.companyId },
          select: {
            outlookMailbox: true,
            graphAccessTokenEncrypted: true,
            graphTokenExpiresAt: true,
          },
        })
      : null;

    const mustUseSharedMailbox = SHARED_MAILBOX_MODE;
    // When using shared-mailbox-only mode, always target the global shared mailbox
    // (ignore per-company outlookMailbox — the DB default was historically set to
    // an individual's address, which caused drafts to land in the wrong place).
    const sharedMailbox = mustUseSharedMailbox
      ? process.env.OUTLOOK_SHARED_MAILBOX?.trim().toLowerCase() ||
        DEFAULT_OUTLOOK_MAILBOX
      : companySettings?.outlookMailbox?.trim().toLowerCase() ||
        DEFAULT_OUTLOOK_MAILBOX;

    const connectedToken =
      companySettings &&
      isGraphConnectionUsable({
        graphAccessTokenEncrypted: companySettings.graphAccessTokenEncrypted,
        graphTokenExpiresAt: companySettings.graphTokenExpiresAt,
      }) &&
      companySettings.graphAccessTokenEncrypted
        ? decryptGraphAccessToken(companySettings.graphAccessTokenEncrypted)
        : null;

    const accessToken = body.accessToken?.trim() || connectedToken;

    if (!mustUseSharedMailbox && !accessToken) {
      return jsonError(
        "No active Microsoft Graph connection found. Connect your company account in Admin settings or sign in for Graph.",
        400,
      );
    }

    // ── Build redacted CV attachment ──────────────────────────────────
    const attachments: {
      filename: string;
      contentBase64: string;
      contentType: string;
    }[] = [];

    if (application?.candidate) {
      const c = application.candidate;
      const hasFormattedPdf =
        Boolean(c.formattedCvPdfData) &&
        (c.formattedCvPdfData?.byteLength ?? 0) > 0;

      let redactedPdfBase64: string | undefined;

      if (hasFormattedPdf && c.formattedCvPdfData) {
        redactedPdfBase64 = Buffer.from(c.formattedCvPdfData).toString(
          "base64",
        );
      } else {
        const hasBinaryCv =
          Boolean(c.cvFileData) && (c.cvFileData?.byteLength ?? 0) > 0;
        const looksLikePdf =
          hasBinaryCv &&
          ((c.cvMimeType?.trim().toLowerCase() || "") === "application/pdf" ||
            (c.cvFileName?.trim().toLowerCase().endsWith(".pdf") ?? false));

        if (looksLikePdf && c.cvFileData) {
          try {
            const redacted = await redactContactDetailsInPdf({
              pdfBytes: Buffer.from(c.cvFileData),
              email: c.email,
              phone: c.phone,
            });
            redactedPdfBase64 = redacted.toString("base64");
          } catch {
            redactedPdfBase64 = undefined;
          }
        }

        if (!redactedPdfBase64 && c.rawCV?.trim()) {
          const fallback = await buildRedactedCvPdfFromText({
            cvText: c.rawCV,
            candidateName: c.fullName,
            email: c.email,
            phone: c.phone,
          });
          redactedPdfBase64 = fallback.toString("base64");
        }
      }

      if (redactedPdfBase64) {
        const safeName = (c.fullName || "candidate")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        attachments.push({
          filename:
            (hasFormattedPdf
              ? c.formattedCvFileName?.trim()
              : c.cvFileName?.trim()) || `${safeName || "candidate"}-cv.pdf`,
          contentBase64: redactedPdfBase64,
          contentType: "application/pdf",
        });
      }
    }

    if (mustUseSharedMailbox) {
      await createOutlookDraftForMailbox({
        mailbox: sharedMailbox,
        subject: draft.subject,
        htmlBody: draft.htmlBody,
        to: body.to,
        attachments,
      });
    } else {
      await createOutlookDraft({
        accessToken: accessToken as string,
        subject: draft.subject,
        htmlBody: draft.htmlBody,
        to: body.to,
        attachments,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.emailDraft.updateMany({
        where: { id: draft.id, tenantId },
        data: { preferredForLearning: true },
      });

      if (application) {
        const transition = canTransition(
          application.currentStage,
          "SENT_TO_CLIENT",
          true,
        );

        if (transition.allowed) {
          await tx.application.update({
            where: { id: application.id, tenantId },
            data: {
              currentStage: "SENT_TO_CLIENT",
              history: {
                create: {
                  fromStage: application.currentStage,
                  toStage: "SENT_TO_CLIENT",
                  changedBy: "Outlook draft created",
                  tenantId,
                },
              },
            },
          });
        }
      }
    });

    return jsonOk({ status: "draft_created" });
  } catch (error) {
    if (handleAuthError(error)) return handleAuthError(error)!;
    const message =
      error instanceof Error ? error.message : "Unable to create Outlook draft";
    const status = (error as Error & { status?: number }).status ?? 400;
    console.error("[OUTLOOK_DRAFT]", message);
    return jsonError(message, status);
  }
}

export async function DELETE(request: Request) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const body = emailDraftCleanupSchema.parse(await request.json());

    if (body.keepEmailDraftId) {
      const keepDraft = await prisma.emailDraft.findFirst({
        where: { id: body.keepEmailDraftId, tenantId },
        select: { id: true, applicationId: true },
      });

      if (!keepDraft || keepDraft.applicationId !== body.applicationId) {
        return jsonError("Selected draft does not match application", 400);
      }
    }

    const deleted = await prisma.emailDraft.deleteMany({
      where: {
        tenantId,
        applicationId: body.applicationId,
        ...(body.keepEmailDraftId
          ? { id: { not: body.keepEmailDraftId } }
          : {}),
      },
    });

    return jsonOk({ deletedCount: deleted.count });
  } catch (error) {
    return (
      handleAuthError(error) ?? jsonError("Unable to delete email drafts", 400)
    );
  }
}
