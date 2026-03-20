import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { placementAlertCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const tenantId = resolveTenantIdFromRequest(request);
  const alerts = await prisma.placementAlert.findMany({
    where: { tenantId },
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
  });

  return jsonOk(alerts);
}

export async function POST(request: Request) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
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

    return jsonOk(alert, { status: 201 });
  } catch (error) {
    return jsonError("Unable to create placement alert", 400, {
      message: (error as Error).message,
    });
  }
}
