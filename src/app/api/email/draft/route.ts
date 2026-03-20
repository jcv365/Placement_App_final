import { jsonError, jsonOk } from "@/lib/apiResponses";
import { createOutlookDraft } from "@/lib/graph";
import {
    decryptGraphAccessToken,
    isGraphConnectionUsable,
} from "@/lib/graphConnectionStore";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { emailDraftCleanupSchema, emailDraftSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
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
      },
    });

    const companySettings = application?.job.companyId
      ? await prisma.companySettings.findUnique({
          where: { companyId: application.job.companyId },
          select: {
            graphAccessTokenEncrypted: true,
            graphTokenExpiresAt: true,
          },
        })
      : null;

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

    if (!accessToken) {
      return jsonError(
        "No active Microsoft Graph connection found. Connect your company account in Admin settings or sign in for Graph.",
        400,
      );
    }

    await createOutlookDraft({
      accessToken,
      subject: draft.subject,
      htmlBody: draft.htmlBody,
      to: body.to,
    });

    await prisma.emailDraft.updateMany({
      where: { id: draft.id, tenantId },
      data: { preferredForLearning: true },
    });

    if (application) {
      await prisma.application.update({
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

    return jsonOk({ status: "draft_created" });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return jsonError("Unable to create Outlook draft", status, {
      message: (error as Error).message,
    });
  }
}

export async function DELETE(request: Request) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
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
    return jsonError("Unable to delete email drafts", 400, {
      message: (error as Error).message,
    });
  }
}
