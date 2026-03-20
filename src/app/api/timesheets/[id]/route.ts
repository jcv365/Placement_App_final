import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { timesheetUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const { id } = await context.params;
    const body = timesheetUpdateSchema.parse(await request.json());

    const current = await prisma.timesheet.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        hoursWorked: true,
        ratePerHour: true,
        engineerRatePerHour: true,
        currency: true,
      },
    });

    if (!current) {
      return jsonError("Timesheet not found", 404);
    }

    const nextStatus = body.status;
    const now = new Date();

    const timesheet = await prisma.timesheet.update({
      where: { id: current.id, tenantId },
      data: {
        status: nextStatus,
        hoursWorked: body.hoursWorked,
        ratePerHour: body.ratePerHour,
        engineerRatePerHour: body.engineerRatePerHour,
        currency: body.currency?.toUpperCase(),
        submittedAt:
          nextStatus === "SUBMITTED" ? now : nextStatus ? null : undefined,
        approvedAt: nextStatus === "APPROVED" ? now : undefined,
      },
      include: {
        invoice: true,
        application: {
          select: {
            id: true,
            opportunityId: true,
            candidate: { select: { id: true, fullName: true } },
            job: {
              select: {
                id: true,
                title: true,
                company: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        actor: "system",
        entityType: "timesheet",
        entityId: timesheet.id,
        action: "updated",
        beforeJson: current,
        afterJson: {
          status: timesheet.status,
          hoursWorked: timesheet.hoursWorked,
          ratePerHour: timesheet.ratePerHour,
          engineerRatePerHour: timesheet.engineerRatePerHour,
          currency: timesheet.currency,
        },
      },
    });

    return jsonOk(timesheet);
  } catch (error) {
    return jsonError("Unable to update timesheet", 400, {
      message: (error as Error).message,
    });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const { id } = await context.params;

    await prisma.invoice.deleteMany({
      where: { timesheetId: id, tenantId },
    });

    await prisma.timesheet.delete({
      where: { id, tenantId },
    });

    return jsonOk({ id, deleted: true });
  } catch (error) {
    return jsonError("Unable to delete timesheet", 400, {
      message: (error as Error).message,
    });
  }
}
