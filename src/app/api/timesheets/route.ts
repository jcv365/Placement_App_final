import { handleAuthError, jsonError, jsonOk } from "@/lib/apiResponses";
import { parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import {
  requireAuthenticatedTenantId,
  resolveTenantIdFromRequest,
} from "@/lib/tenant";
import { timesheetCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

const TIMESHEET_INCLUDE = {
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
} as const;

export async function GET(request: Request) {
  const tenantId = resolveTenantIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const pagination = parsePagination(searchParams);

  const where = { tenantId };
  const timesheets = await prisma.timesheet.findMany({
    where,
    include: TIMESHEET_INCLUDE,
    orderBy: [{ periodStartDate: "desc" }, { createdAt: "desc" }],
    ...(pagination ? { take: pagination.take, skip: pagination.skip } : {}),
  });

  if (pagination) {
    const total = await prisma.timesheet.count({ where });
    return jsonOk({
      items: timesheets,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    });
  }

  return jsonOk(timesheets);
}

export async function POST(request: Request) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const body = timesheetCreateSchema.parse(await request.json());

    const application = await prisma.application.findFirst({
      where: {
        id: body.applicationId,
        tenantId,
      },
      select: { id: true, currentStage: true, agreedHourlyRate: true },
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

    if (application.agreedHourlyRate == null) {
      return jsonError(
        "An agreed contract rate must be set on the placement before creating timesheets",
        400,
      );
    }

    const periodStartDate = new Date(body.periodStartDate);
    const periodEndDate = new Date(body.periodEndDate);

    if (periodEndDate < periodStartDate) {
      return jsonError(
        "Period end date must be on or after period start date",
        400,
      );
    }

    const overlap = await prisma.timesheet.findFirst({
      where: {
        applicationId: body.applicationId,
        tenantId,
        periodStartDate: { lt: periodEndDate },
        periodEndDate: { gt: periodStartDate },
      },
      select: { id: true },
    });

    if (overlap) {
      return jsonError(
        "A timesheet already exists for this period. Please check for overlapping dates.",
        409,
      );
    }

    const timesheet = await prisma.timesheet.create({
      data: {
        tenantId,
        applicationId: body.applicationId,
        periodStartDate,
        periodEndDate,
        hoursWorked: body.hoursWorked,
        ratePerHour: application.agreedHourlyRate,
        engineerRatePerHour: body.engineerRatePerHour,
        currency: (body.currency ?? "ZAR").toUpperCase(),
      },
      include: TIMESHEET_INCLUDE,
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
    return (
      handleAuthError(error) ?? jsonError("Unable to create timesheet", 400)
    );
  }
}
