import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { vacancyCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const tenantId = resolveTenantIdFromRequest(request);
  const vacancies = await prisma.vacancy.findMany({
    where: { tenantId },
    include: {
      clientAccount: {
        select: { id: true, name: true },
      },
      hiringManager: {
        select: { id: true, fullName: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonOk(vacancies);
}

export async function POST(request: Request) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const body = vacancyCreateSchema.parse(await request.json());

    const [account, manager] = await Promise.all([
      prisma.clientAccount.findFirst({
        where: { id: body.clientAccountId, tenantId },
        select: { id: true },
      }),
      body.hiringManagerId
        ? prisma.clientContact.findFirst({
            where: { id: body.hiringManagerId, tenantId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (!account || (body.hiringManagerId && !manager)) {
      return jsonError("Unable to create vacancy", 400, {
        message:
          "Client account or hiring manager is not available for this tenant.",
      });
    }

    const vacancy = await prisma.vacancy.create({
      data: {
        tenantId,
        clientAccountId: body.clientAccountId,
        hiringManagerId: body.hiringManagerId || null,
        title: body.title,
        description: body.description,
        stage: body.stage ?? "OPEN",
        slaDate: body.slaDate ? new Date(body.slaDate) : null,
        interviewFeedback: body.interviewFeedback?.trim()
          ? body.interviewFeedback.trim()
          : null,
        offerStatus: body.offerStatus?.trim() ? body.offerStatus.trim() : null,
        reasonCode: body.reasonCode?.trim() ? body.reasonCode.trim() : null,
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

    return jsonOk(vacancy, { status: 201 });
  } catch (error) {
    return jsonError("Unable to create vacancy", 400, {
      message: (error as Error).message,
    });
  }
}
