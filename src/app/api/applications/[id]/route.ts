import { jsonError, jsonOk } from "@/lib/apiResponses";
import { computeOpportunityId } from "@/lib/opportunity";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";
import { applicationDetailsUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id } = await context.params;
    const application = await prisma.application.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        ...getOwnerFilter(scope),
      },
      include: {
        job: {
          include: {
            company: true,
          },
        },
        candidate: true,
        history: { orderBy: { changedAt: "desc" } },
        notes: { orderBy: { createdAt: "desc" } },
        emails: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!application) {
      return jsonError("Application not found", 404);
    }

    return jsonOk(application);
  } catch (error) {
    return jsonError("Unable to load application", 500, {
      message: (error as Error).message,
    });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id } = await context.params;
    const body = applicationDetailsUpdateSchema.parse(await request.json());

    const application = await prisma.application.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        ...getOwnerFilter(scope),
      },
      include: {
        candidate: true,
        job: {
          include: {
            company: true,
          },
        },
      },
    });

    if (!application) {
      return jsonError("Application not found", 404);
    }

    await prisma.candidate.updateMany({
      where: { id: application.candidateId, tenantId: scope.tenantId },
      data: {
        fullName: body.candidateName ?? application.candidate.fullName,
        email:
          body.candidateEmail === undefined
            ? application.candidate.email
            : body.candidateEmail,
        phone:
          body.candidatePhone === undefined
            ? application.candidate.phone
            : body.candidatePhone,
      },
    });

    const candidateWithApplications = await prisma.candidate.findUnique({
      where: { id: application.candidateId, tenantId: scope.tenantId },
      include: {
        applications: {
          where: { tenantId: scope.tenantId },
          include: {
            job: {
              include: {
                company: true,
              },
            },
          },
        },
      },
    });

    if (candidateWithApplications) {
      await prisma.$transaction(
        candidateWithApplications.applications.map((candidateApplication) => {
          const opportunityId = `${scope.tenantId}:${computeOpportunityId({
            candidateName: candidateWithApplications.fullName,
            roleTitle: candidateApplication.job.title,
            companyName: candidateApplication.job.company?.name,
          })}`;

          return prisma.application.update({
            where: { id: candidateApplication.id, tenantId: scope.tenantId },
            data: { opportunityId },
          });
        }),
      );
    }

    const updated = await prisma.application.findUnique({
      where: { id, tenantId: scope.tenantId },
      include: {
        job: {
          include: {
            company: true,
          },
        },
        candidate: true,
        history: { orderBy: { changedAt: "desc" } },
        notes: { orderBy: { createdAt: "desc" } },
        emails: { orderBy: { createdAt: "desc" } },
      },
    });

    return jsonOk(updated);
  } catch (error) {
    return jsonError("Unable to update application details", 400, {
      message: (error as Error).message,
    });
  }
}
