import { jsonError, jsonOk } from "@/lib/apiResponses";
import { writeAuditLog } from "@/lib/auditLog";
import { computeOpportunityId } from "@/lib/opportunity";
import { parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";
import { applicationCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { searchParams } = new URL(request.url);

    // Lightweight path: only return jobId/candidateId for applications that have emails,
    // used by the match review "bulk pending" count check.
    if (searchParams.get("drafted") === "true") {
      const drafted = await prisma.application.findMany({
        where: {
          tenantId: scope.tenantId,
          ...getOwnerFilter(scope),
          emails: { some: {} },
        },
        select: {
          jobId: true,
          candidateId: true,
          emails: { select: { id: true } },
        },
      });
      return jsonOk(drafted);
    }

    const stage = searchParams.get("stage") ?? undefined;
    const candidateEmail = searchParams.get("candidateEmail")?.trim();
    const companyName = searchParams.get("companyName")?.trim();
    const role = searchParams.get("role")?.trim();
    const andFilters: Array<Record<string, unknown>> = [];

    const validStages = [
      "NEW",
      "SHORTLISTED",
      "EMAIL_DRAFTED",
      "SENT_TO_CLIENT",
      "INTERVIEW_1",
      "INTERVIEW_2",
      "OFFER",
      "PLACED",
      "REJECTED",
      "ON_HOLD",
    ] as const;
    type ValidStage = (typeof validStages)[number];
    const stageFilter: ValidStage | undefined =
      stage && validStages.includes(stage as ValidStage)
        ? (stage as ValidStage)
        : undefined;

    if (candidateEmail) {
      andFilters.push({
        candidate: {
          email: {
            contains: candidateEmail,
          },
        },
      });
    }

    if (companyName) {
      andFilters.push({
        job: {
          company: {
            name: {
              contains: companyName,
            },
          },
        },
      });
    }

    if (role) {
      andFilters.push({
        job: {
          title: {
            contains: role,
          },
        },
      });
    }

    const where = {
      tenantId: scope.tenantId,
      ...getOwnerFilter(scope),
      ...(stageFilter ? { currentStage: stageFilter } : {}),
      ...(andFilters.length > 0 ? { AND: andFilters } : {}),
    };

    const pagination = parsePagination(searchParams);

    const applications = await prisma.application.findMany({
      where,
      select: {
        id: true,
        opportunityId: true,
        currentStage: true,
        placedAt: true,
        agreedHourlyRate: true,
        agreedRateLockedAt: true,
        placementBillingModel: true,
        placementFeePercent: true,
        annualCtc: true,
        contractValue: true,
        signedContractFileName: true,
        signedContractMimeType: true,
        signedContractUploadedAt: true,
        updatedAt: true,
        job: {
          select: {
            id: true,
            title: true,
            opportunityEmail: true,
            opportunityUrl: true,
            company: { select: { id: true, name: true } },
          },
        },
        candidate: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
        notes: { select: { id: true } },
        emails: { select: { id: true } },
      },
      orderBy: { updatedAt: "desc" },
      ...(pagination ? { take: pagination.take, skip: pagination.skip } : {}),
    });

    if (pagination) {
      const total = await prisma.application.count({ where });
      return jsonOk({
        items: applications,
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
      });
    }

    return jsonOk(applications);
  } catch (error) {
    console.error("[APPLICATIONS_GET]", error);
    return jsonError("Unable to load applications", 500);
  }
}

export async function POST(request: Request) {
  try {
    const scope = resolveTenantAccessScope(request);
    const body = applicationCreateSchema.parse(await request.json());
    const [job, candidate] = await Promise.all([
      prisma.job.findFirst({
        where: {
          id: body.jobId,
          tenantId: scope.tenantId,
          ...getOwnerFilter(scope),
        },
        include: { company: true },
      }),
      prisma.candidate.findFirst({
        where: {
          id: body.candidateId,
          tenantId: scope.tenantId,
          ...getOwnerFilter(scope),
        },
      }),
    ]);

    if (!job || !candidate) {
      return jsonError("Job or candidate not found", 404);
    }

    const opportunityId = `${scope.tenantId}:${computeOpportunityId({
      candidateName: candidate.fullName,
      roleTitle: job.title,
      companyName: job.company?.name,
    })}`;

    const c2cPartner =
      body.c2cPartner ??
      process.env.DEFAULT_C2C_PARTNER_NAME ??
      "C2C Partner Ltd";

    let created = false;
    let application;

    try {
      application = await prisma.application.create({
        data: {
          jobId: body.jobId,
          candidateId: body.candidateId,
          tenantId: scope.tenantId,
          ownerUserId: scope.userId,
          opportunityId,
          c2cPartner,
          history: {
            create: {
              tenantId: scope.tenantId,
              toStage: "NEW",
            },
          },
        },
        include: {
          job: {
            include: {
              company: true,
            },
          },
          candidate: true,
        },
      });
      created = true;
    } catch (error) {
      const isUniqueViolation =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002";

      if (!isUniqueViolation) {
        throw error;
      }

      application = await prisma.application.findFirst({
        where: { opportunityId, tenantId: scope.tenantId },
        include: {
          job: {
            include: {
              company: true,
            },
          },
          candidate: true,
        },
      });

      if (!application) {
        throw error;
      }
    }

    if (created && application) {
      await writeAuditLog({
        tenantId: scope.tenantId,
        entityType: "application",
        entityId: application.id,
        action: "CREATE",
      });
    }

    return jsonOk(
      {
        ...application,
        deduplicated: !created,
      },
      { status: created ? 201 : 200 },
    );
  } catch (error) {
    console.error("[APPLICATIONS_POST]", error);
    return jsonError("Unable to create application", 400);
  }
}
