import { handleAuthError, jsonError, jsonOk } from "@/lib/apiResponses";
import { writeAuditLog } from "@/lib/auditLog";
import { prisma } from "@/lib/prisma";
import { canTransition } from "@/lib/stages";
import { requireAuthenticatedTenantId } from "@/lib/tenant";
import { stageUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
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

    const updated = await prisma.$transaction(async (tx) => {
      // Re-read inside transaction to prevent race conditions
      const fresh = await tx.application.findFirst({
        where: { id, tenantId },
      });
      if (!fresh || fresh.currentStage !== application.currentStage) {
        throw new Error("STAGE_CHANGED");
      }

      const result = await tx.application.update({
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

      return result;
    });

    // Audit log runs outside the transaction to avoid SQLite write-lock contention
    await writeAuditLog({
      tenantId,
      entityType: "application",
      entityId: updated.id,
      action: "STAGE_CHANGE",
    });

    return jsonOk(updated);
  } catch (error) {
    console.error("[STAGE_ROUTE]", error);
    if (error instanceof Error && error.message === "STAGE_CHANGED") {
      return jsonError(
        "Stage was modified by another request, please retry",
        409,
      );
    }
    return handleAuthError(error) ?? jsonError("Unable to update stage", 400);
  }
}

// POST mirrors PATCH — exists because the WAF (ModSecurity rule 911100) blocks PATCH.
export const POST = PATCH;
