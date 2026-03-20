import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { canTransition } from "@/lib/stages";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { stageUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const body = stageUpdateSchema.parse(await request.json());
    const { id } = await context.params;

    const application = await prisma.application.findFirst({
      where: { id, tenantId },
    });

    if (!application) {
      return jsonError("Application not found", 404);
    }

    const transition = canTransition(
      application.currentStage,
      body.toStage,
      !!body.note,
    );
    if (!transition.allowed) {
      return jsonError("Stage transition not allowed", 400, {
        requiresNote: transition.requiresNote,
      });
    }

    const updated = await prisma.application.update({
      where: { id: application.id, tenantId },
      data: {
        currentStage: body.toStage,
        placedAt:
          body.toStage === "PLACED"
            ? (application.placedAt ?? new Date())
            : application.placedAt,
        history: {
          create: {
            tenantId,
            fromStage: application.currentStage,
            toStage: body.toStage,
            changedBy: body.note ? `Note: ${body.note}` : undefined,
          },
        },
        notes: body.note
          ? {
              create: {
                tenantId,
                content: body.note,
                author: "Stage change",
              },
            }
          : undefined,
      },
      include: {
        job: true,
        candidate: true,
      },
    });

    return jsonOk(updated);
  } catch (error) {
    return jsonError("Unable to update stage", 400, {
      message: (error as Error).message,
    });
  }
}
