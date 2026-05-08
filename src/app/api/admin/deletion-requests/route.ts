import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export const runtime = "nodejs";

const reviewSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
});

const resourceTypeSchema = z.enum([
  "job",
  "vacancy",
  "candidate",
  "clientAccount",
  "clientContact",
  "application",
  "placementAlert",
  "timesheet",
  "ruleSet",
]);

type ResourceType = z.infer<typeof resourceTypeSchema>;

type DeletionRequestMetadata = {
  resourceType?: ResourceType;
  resourceId?: string;
  reason?: string | null;
  status?: string;
  requestedAt?: string;
};

function parseMetadata(value: unknown): DeletionRequestMetadata {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;

  const resourceType =
    typeof record.resourceType === "string" &&
    resourceTypeSchema.safeParse(record.resourceType).success
      ? (record.resourceType as ResourceType)
      : undefined;

  return {
    resourceType,
    resourceId:
      typeof record.resourceId === "string" ? record.resourceId : undefined,
    reason:
      typeof record.reason === "string" || record.reason === null
        ? (record.reason as string | null)
        : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    requestedAt:
      typeof record.requestedAt === "string" ? record.requestedAt : undefined,
  };
}

async function deleteApplicationGraph(
  tx: Prisma.TransactionClient,
  tenantId: string,
  applicationIds: string[],
): Promise<{ applications: number; invoices: number; timesheets: number }> {
  if (applicationIds.length === 0) {
    return { applications: 0, invoices: 0, timesheets: 0 };
  }

  const timesheetIds = (
    await tx.timesheet.findMany({
      where: {
        applicationId: { in: applicationIds },
        tenantId,
      },
      select: { id: true },
    })
  ).map((timesheet: { id: string }) => timesheet.id);

  if (timesheetIds.length) {
    await tx.invoice.deleteMany({
      where: {
        timesheetId: { in: timesheetIds },
      },
    });
  }

  await tx.timesheet.deleteMany({
    where: {
      applicationId: { in: applicationIds },
      tenantId,
    },
  });

  await tx.placementAlert.deleteMany({
    where: {
      applicationId: { in: applicationIds },
      tenantId,
    },
  });

  await tx.note.deleteMany({
    where: {
      applicationId: { in: applicationIds },
      tenantId,
    },
  });

  await tx.emailDraft.deleteMany({
    where: {
      applicationId: { in: applicationIds },
      tenantId,
    },
  });

  await tx.applicationStageHistory.deleteMany({
    where: {
      applicationId: { in: applicationIds },
      tenantId,
    },
  });

  await tx.application.deleteMany({
    where: {
      id: { in: applicationIds },
      tenantId,
    },
  });

  return {
    applications: applicationIds.length,
    invoices: timesheetIds.length,
    timesheets: timesheetIds.length,
  };
}

export async function GET(request: Request) {
  try {
    const { tenantId } = requireAdminContextFromRequest(request);

    const requests = await prisma.auditLog.findMany({
      where: {
        tenantId,
        entityType: "deletion_request",
        action: "pending",
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        entityId: true,
        actor: true,
        beforeJson: true,
        createdAt: true,
      },
    });

    const metadataByRequestId = new Map(
      requests.map((item) => [item.id, parseMetadata(item.beforeJson)]),
    );

    const jobIds = Array.from(
      new Set(
        requests
          .filter(
            (item) => metadataByRequestId.get(item.id)?.resourceType === "job",
          )
          .map((item) => item.entityId),
      ),
    );
    const vacancyIds = Array.from(
      new Set(
        requests
          .filter(
            (item) =>
              metadataByRequestId.get(item.id)?.resourceType === "vacancy",
          )
          .map((item) => item.entityId),
      ),
    );
    const candidateIds = Array.from(
      new Set(
        requests
          .filter(
            (item) =>
              metadataByRequestId.get(item.id)?.resourceType === "candidate",
          )
          .map((item) => item.entityId),
      ),
    );

    const jobs = jobIds.length
      ? await prisma.job.findMany({
          where: {
            tenantId,
            id: {
              in: jobIds,
            },
          },
          select: {
            id: true,
            title: true,
            createdAt: true,
            company: {
              select: {
                name: true,
              },
            },
          },
        })
      : [];

    const vacancies = vacancyIds.length
      ? await prisma.vacancy.findMany({
          where: {
            tenantId,
            id: {
              in: vacancyIds,
            },
          },
          select: {
            id: true,
            title: true,
            createdAt: true,
            clientAccount: {
              select: {
                name: true,
              },
            },
          },
        })
      : [];

    const candidates = candidateIds.length
      ? await prisma.candidate.findMany({
          where: {
            tenantId,
            id: {
              in: candidateIds,
            },
          },
          select: {
            id: true,
            fullName: true,
            createdAt: true,
          },
        })
      : [];

    const jobMap = new Map(jobs.map((job) => [job.id, job]));
    const vacancyMap = new Map(
      vacancies.map((vacancy) => [vacancy.id, vacancy]),
    );
    const candidateMap = new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    );

    return jsonOk(
      requests.map((item) => {
        const metadata = metadataByRequestId.get(item.id) ?? {};
        const resourceType = metadata.resourceType ?? "job";
        const job = jobMap.get(item.entityId);
        const vacancy = vacancyMap.get(item.entityId);
        const candidate = candidateMap.get(item.entityId);

        const title =
          resourceType === "job"
            ? (job?.title ?? "Unknown job")
            : resourceType === "vacancy"
              ? (vacancy?.title ?? "Unknown vacancy")
              : resourceType === "candidate"
                ? (candidate?.fullName ?? "Unknown candidate")
                : item.entityId;

        const companyName =
          resourceType === "job"
            ? (job?.company?.name ?? null)
            : resourceType === "vacancy"
              ? (vacancy?.clientAccount?.name ?? null)
              : null;

        const resourceCreatedAt =
          resourceType === "job"
            ? (job?.createdAt ?? null)
            : resourceType === "vacancy"
              ? (vacancy?.createdAt ?? null)
              : resourceType === "candidate"
                ? (candidate?.createdAt ?? null)
                : null;

        return {
          id: item.id,
          resourceType,
          resourceId: metadata.resourceId ?? item.entityId,
          status: metadata.status ?? "PENDING",
          reason: metadata.reason ?? null,
          requestedBy: item.actor,
          requestedAt: metadata.requestedAt ?? item.createdAt,
          title,
          companyName,
          resourceCreatedAt,
        };
      }),
    );
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to load deletion requests", 400);
  }
}

export async function POST(request: Request) {
  try {
    const { username: actor, tenantId } =
      requireAdminContextFromRequest(request);
    const body = reviewSchema.parse(await request.json());

    const pendingRequest = await prisma.auditLog.findFirst({
      where: {
        id: body.requestId,
        tenantId,
        entityType: "deletion_request",
        action: "pending",
      },
      select: {
        id: true,
        entityId: true,
        beforeJson: true,
      },
    });

    if (!pendingRequest) {
      return jsonError("Pending deletion request not found", 404);
    }

    if (body.decision === "REJECT") {
      const updated = await prisma.auditLog.update({
        where: { id: pendingRequest.id, tenantId },
        data: {
          action: "rejected",
          afterJson: {
            status: "REJECTED",
            reviewedBy: actor,
            reviewedAt: new Date().toISOString(),
          },
        },
        select: {
          id: true,
          action: true,
        },
      });

      return jsonOk(updated);
    }

    const metadata = parseMetadata(pendingRequest.beforeJson);
    const resourceType = metadata.resourceType ?? "job";
    const resourceId = metadata.resourceId ?? pendingRequest.entityId;

    const summary = await prisma.$transaction(async (tx) => {
      const deleted = {
        resources: 0,
        opportunities: 0,
        candidates: 0,
        invoices: 0,
      };

      if (resourceType === "job") {
        const applications = await tx.application.findMany({
          where: { jobId: resourceId, tenantId },
          select: {
            id: true,
            candidateId: true,
          },
        });

        const applicationIds = applications.map(
          (application) => application.id,
        );
        const candidateIds = applications.map(
          (application) => application.candidateId,
        );

        const graphSummary = await deleteApplicationGraph(
          tx,
          tenantId,
          applicationIds,
        );
        deleted.opportunities = graphSummary.applications;
        deleted.invoices = graphSummary.invoices;

        const deletableCandidateIds = candidateIds.length
          ? (
              await tx.candidate.findMany({
                where: {
                  tenantId,
                  id: {
                    in: candidateIds,
                  },
                },
                select: {
                  id: true,
                  _count: {
                    select: {
                      applications: true,
                    },
                  },
                },
              })
            )
              .filter((candidate) => candidate._count.applications === 0)
              .map((candidate) => candidate.id)
          : [];

        if (deletableCandidateIds.length) {
          await tx.candidateAgreement.deleteMany({
            where: {
              candidateId: {
                in: deletableCandidateIds,
              },
              tenantId,
            },
          });

          await tx.candidate.deleteMany({
            where: {
              id: {
                in: deletableCandidateIds,
              },
              tenantId,
            },
          });

          deleted.candidates = deletableCandidateIds.length;
        }

        await tx.job.deleteMany({
          where: {
            id: resourceId,
            tenantId,
          },
        });

        deleted.resources = 1;
      } else if (resourceType === "candidate") {
        const applications = await tx.application.findMany({
          where: { candidateId: resourceId, tenantId },
          select: { id: true },
        });

        const graphSummary = await deleteApplicationGraph(
          tx,
          tenantId,
          applications.map((application) => application.id),
        );

        await tx.candidateAgreement.deleteMany({
          where: {
            candidateId: resourceId,
            tenantId,
          },
        });

        await tx.candidate.deleteMany({
          where: {
            id: resourceId,
            tenantId,
          },
        });

        deleted.resources = 1;
        deleted.opportunities = graphSummary.applications;
        deleted.invoices = graphSummary.invoices;
        deleted.candidates = 1;
      } else if (resourceType === "vacancy") {
        await tx.vacancy.deleteMany({
          where: {
            id: resourceId,
            tenantId,
          },
        });
        deleted.resources = 1;
      } else if (resourceType === "application") {
        const graphSummary = await deleteApplicationGraph(tx, tenantId, [
          resourceId,
        ]);
        deleted.resources = graphSummary.applications;
        deleted.opportunities = graphSummary.applications;
        deleted.invoices = graphSummary.invoices;
      } else if (resourceType === "clientAccount") {
        await tx.vacancy.deleteMany({
          where: {
            clientAccountId: resourceId,
            tenantId,
          },
        });
        await tx.clientContact.deleteMany({
          where: {
            clientAccountId: resourceId,
            tenantId,
          },
        });
        await tx.clientAccount.deleteMany({
          where: {
            id: resourceId,
            tenantId,
          },
        });
        deleted.resources = 1;
      } else if (resourceType === "clientContact") {
        await tx.vacancy.updateMany({
          where: {
            hiringManagerId: resourceId,
            tenantId,
          },
          data: {
            hiringManagerId: null,
          },
        });
        await tx.clientContact.deleteMany({
          where: {
            id: resourceId,
            tenantId,
          },
        });
        deleted.resources = 1;
      } else if (resourceType === "placementAlert") {
        await tx.placementAlert.deleteMany({
          where: {
            id: resourceId,
            tenantId,
          },
        });
        deleted.resources = 1;
      } else if (resourceType === "timesheet") {
        await tx.invoice.deleteMany({
          where: {
            timesheetId: resourceId,
          },
        });
        await tx.timesheet.deleteMany({
          where: {
            id: resourceId,
            tenantId,
          },
        });
        deleted.resources = 1;
        deleted.invoices = 1;
      } else {
        await tx.ruleSet.deleteMany({
          where: {
            id: resourceId,
            tenantId,
          },
        });
        deleted.resources = 1;
      }

      const status = {
        status: "APPROVED",
        reviewedBy: actor,
        reviewedAt: new Date().toISOString(),
        resourceType,
        resourceId,
        deleted: {
          resources: deleted.resources,
          opportunities: deleted.opportunities,
          candidates: deleted.candidates,
          invoices: deleted.invoices,
        },
      };

      await tx.auditLog.update({
        where: { id: pendingRequest.id, tenantId },
        data: {
          action: "approved",
          afterJson: status,
        },
      });

      return status;
    });

    return jsonOk(summary);
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to review deletion request", 400);
  }
}
