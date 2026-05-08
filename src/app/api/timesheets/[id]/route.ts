import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { timesheetUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

type TimesheetStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "INVOICED";

const ALLOWED_TRANSITIONS: Record<TimesheetStatus, readonly TimesheetStatus[]> =
  {
    DRAFT: ["SUBMITTED"],
    SUBMITTED: ["APPROVED", "REJECTED"],
    APPROVED: ["INVOICED"],
    REJECTED: ["DRAFT"],
    INVOICED: [],
  } as const satisfies Record<TimesheetStatus, readonly TimesheetStatus[]>;

const LOCKED_STATUSES: TimesheetStatus[] = ["APPROVED", "INVOICED"];

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

    const currentStatus = current.status as TimesheetStatus;

    if (body.status) {
      const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
      if (!allowed.includes(body.status as TimesheetStatus)) {
        return jsonError(
          `Cannot move from ${currentStatus} to ${body.status}`,
          400,
        );
      }
    }

    const hasFinancialEdits =
      body.hoursWorked !== undefined ||
      body.ratePerHour !== undefined ||
      body.engineerRatePerHour !== undefined;

    if (hasFinancialEdits && LOCKED_STATUSES.includes(currentStatus)) {
      return jsonError(
        "Financial fields cannot be changed once a timesheet is approved",
        400,
      );
    }

    const nextStatus = body.status as TimesheetStatus | undefined;
    const now = new Date();

    const timesheet = await prisma.$transaction(async (tx) => {
      // Re-check status inside transaction to prevent race conditions
      const fresh = await tx.timesheet.findFirst({
        where: { id: current.id, tenantId },
        select: { status: true },
      });
      if (!fresh || fresh.status !== currentStatus) {
        throw new Error("Timesheet was modified by another request");
      }

      const updated = await tx.timesheet.update({
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
              agreedHourlyRate: true,
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

      await tx.auditLog.create({
        data: {
          tenantId,
          actor: "system",
          entityType: "timesheet",
          entityId: updated.id,
          action: "updated",
          beforeJson: current,
          afterJson: {
            status: updated.status,
            hoursWorked: updated.hoursWorked,
            ratePerHour: updated.ratePerHour,
            engineerRatePerHour: updated.engineerRatePerHour,
            currency: updated.currency,
          },
        },
      });

      return updated;
    });

    return jsonOk(timesheet);
  } catch (error) {
    console.error("[TIMESHEET_UPDATE]", error);
    return jsonError("Unable to update timesheet", 400);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const { id } = await context.params;

    await prisma.$transaction(async (tx) => {
      await tx.invoice.deleteMany({
        where: { timesheetId: id, tenantId },
      });

      await tx.timesheet.delete({
        where: { id, tenantId },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actor: "system",
          entityType: "timesheet",
          entityId: id,
          action: "deleted",
        },
      });
    });

    return jsonOk({ id, deleted: true });
  } catch (error) {
    console.error("[TIMESHEET_DELETE]", error);
    return jsonError("Unable to delete timesheet", 400);
  }
}
