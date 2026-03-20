import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { timesheetCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const tenantId = resolveTenantIdFromRequest(request);
  const timesheets = await prisma.timesheet.findMany({
    where: { tenantId },
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
    orderBy: [{ weekStartDate: "desc" }, { createdAt: "desc" }],
  });

  return jsonOk(timesheets);
}

export async function POST(request: Request) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const body = timesheetCreateSchema.parse(await request.json());

    const application = await prisma.application.findFirst({
      where: {
        id: body.applicationId,
        tenantId,
      },
      select: { id: true, currentStage: true },
    });

    if (!application) {
      return jsonError("Application not found", 404);
    }

    if (application.currentStage !== "PLACED") {
      return jsonError(
        "Timesheets can only be created for placed opportunities",
        400,
      );
    }

    const weekStartDate = new Date(body.weekStartDate);
    const weekEndDate = new Date(body.weekEndDate);

    if (weekEndDate < weekStartDate) {
      return jsonError(
        "Week end date must be on or after week start date",
        400,
      );
    }

    const timesheet = await prisma.timesheet.create({
      data: {
        tenantId,
        applicationId: body.applicationId,
        weekStartDate,
        weekEndDate,
        hoursWorked: body.hoursWorked,
        ratePerHour: body.ratePerHour,
        engineerRatePerHour: body.engineerRatePerHour,
        currency: (body.currency ?? "ZAR").toUpperCase(),
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
        action: "created",
        afterJson: {
          hoursWorked: timesheet.hoursWorked,
          ratePerHour: timesheet.ratePerHour,
          engineerRatePerHour: timesheet.engineerRatePerHour,
          status: timesheet.status,
          currency: timesheet.currency,
        },
      },
    });

    return jsonOk(timesheet, { status: 201 });
  } catch (error) {
    return jsonError("Unable to create timesheet", 400, {
      message: (error as Error).message,
    });
  }
}
