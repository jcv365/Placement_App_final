import { jsonError, jsonOk } from "@/lib/apiResponses";
import { writeAuditLog } from "@/lib/auditLog";
import { parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import {
  requireAuthenticatedTenantId,
  resolveTenantIdFromRequest,
} from "@/lib/tenant";
import { placementAlertCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const tenantId = resolveTenantIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const pagination = parsePagination(searchParams);

  const where = { tenantId };
  const alerts = await prisma.placementAlert.findMany({
    where,
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
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    ...(pagination ? { take: pagination.take, skip: pagination.skip } : {}),
  });

  if (pagination) {
    const total = await prisma.placementAlert.count({ where });
    return jsonOk({
      items: alerts,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    });
  }

  return jsonOk(alerts);
}

export async function POST(request: Request) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const body = placementAlertCreateSchema.parse(await request.json());

    const application = await prisma.application.findFirst({
      where: {
        id: body.applicationId,
        tenantId,
      },
      select: { id: true },
    });

    if (!application) {
      return jsonError("Application not found", 404);
    }

    const alert = await prisma.placementAlert.create({
      data: {
        tenantId,
        applicationId: application.id,
        title: body.title.trim(),
        dueDate: new Date(body.dueDate),
        notes: body.notes?.trim() ? body.notes.trim() : null,
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
      action: "CREATE",
    });

    return jsonOk(alert, { status: 201 });
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[PLACEMENT_ALERT_CREATE]", error);
    return jsonError("Unable to create placement alert", 400);
  }
}
