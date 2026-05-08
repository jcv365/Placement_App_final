import { jsonError, jsonOk } from "@/lib/apiResponses";
import { writeAuditLog } from "@/lib/auditLog";
import { prisma } from "@/lib/prisma";
import { requireAuthenticatedTenantId } from "@/lib/tenant";
import { vacancyUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const { id } = await context.params;
    const body = vacancyUpdateSchema.parse(await request.json());

    const current = await prisma.vacancy.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!current) {
      return jsonError("Vacancy not found", 404);
    }

    const vacancy = await prisma.vacancy.update({
      where: { id: current.id, tenantId },
      data: {
        clientAccountId: body.clientAccountId,
        hiringManagerId:
          body.hiringManagerId === undefined
            ? undefined
            : body.hiringManagerId || null,
        title: body.title,
        description: body.description,
        stage: body.stage,
        slaDate:
          body.slaDate === undefined
            ? undefined
            : body.slaDate
              ? new Date(body.slaDate)
              : null,
        interviewFeedback:
          body.interviewFeedback === undefined
            ? undefined
            : body.interviewFeedback.trim()
              ? body.interviewFeedback.trim()
              : null,
        offerStatus:
          body.offerStatus === undefined
            ? undefined
            : body.offerStatus.trim()
              ? body.offerStatus.trim()
              : null,
        reasonCode:
          body.reasonCode === undefined
            ? undefined
            : body.reasonCode.trim()
              ? body.reasonCode.trim()
              : null,
      },
      include: {
        clientAccount: {
          select: { id: true, name: true },
        },
        hiringManager: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    await writeAuditLog({
      tenantId,
      entityType: "vacancy",
      entityId: vacancy.id,
      action: "UPDATE",
    });

    return jsonOk(vacancy);
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[VACANCY_UPDATE]", error);
    return jsonError("Unable to update vacancy", 400);
  }
}
