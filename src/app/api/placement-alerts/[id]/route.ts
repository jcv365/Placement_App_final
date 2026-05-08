import { jsonError, jsonOk } from "@/lib/apiResponses";
import { writeAuditLog } from "@/lib/auditLog";
import { prisma } from "@/lib/prisma";
import { requireAuthenticatedTenantId } from "@/lib/tenant";
import { placementAlertUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const { id } = await context.params;
    const body = placementAlertUpdateSchema.parse(await request.json());

    const current = await prisma.placementAlert.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!current) {
      return jsonError("Placement alert not found", 404);
    }

    const alert = await prisma.placementAlert.update({
      where: { id: current.id, tenantId },
      data: {
        title: body.title?.trim(),
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        status: body.status,
        notes:
          body.notes === undefined
            ? undefined
            : body.notes.trim()
              ? body.notes.trim()
              : null,
      },
      include: {
        application: {
          select: {
            id: true,
            opportunityId: true,
            candidate: { select: { id: true, fullName: true } },
            job: { select: { id: true, title: true } },
          },
        },
      },
    });

    await writeAuditLog({
      tenantId,
      entityType: "placementAlert",
      entityId: alert.id,
      action: "UPDATE",
    });

    return jsonOk(alert);
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[PLACEMENT_ALERT_UPDATE]", error);
    return jsonError("Unable to update placement alert", 400);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const { id } = await context.params;

    await prisma.placementAlert.deleteMany({
      where: { id, tenantId },
    });

    await writeAuditLog({
      tenantId,
      entityType: "placementAlert",
      entityId: id,
      action: "DELETE",
    });

    return jsonOk({ id, deleted: true });
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[PLACEMENT_ALERT_DELETE]", error);
    return jsonError("Unable to delete placement alert", 400);
  }
}
