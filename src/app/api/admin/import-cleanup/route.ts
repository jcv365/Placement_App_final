import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const cleanupSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    jobIds: z.array(z.string().min(1)).optional(),
    deleteJobs: z.boolean().optional(),
    deleteOpportunities: z.boolean().optional(),
    deleteCandidates: z.boolean().optional(),
    deleteClients: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.date) || (value.jobIds?.length ?? 0) > 0, {
    message: "Provide date or jobIds",
  });

function buildLocalDayRange(dateString: string): { from: Date; to: Date } {
  const [yearText, monthText, dayText] = dateString.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);

  const from = new Date(year, monthIndex, day, 0, 0, 0, 0);
  const to = new Date(year, monthIndex, day, 23, 59, 59, 999);
  return { from, to };
}

export async function POST(request: Request) {
  try {
    const { username: actor, tenantId } =
      requireAdminContextFromRequest(request);
    const body = cleanupSchema.parse(await request.json());
    const dateRange = body.date ? buildLocalDayRange(body.date) : null;
    const deleteJobs = body.deleteJobs ?? true;
    const deleteOpportunities = body.deleteOpportunities ?? true;
    const deleteCandidates = body.deleteCandidates ?? true;
    const deleteClients = body.deleteClients ?? true;
    const dryRun = body.dryRun ?? false;

    const jobs = await prisma.job.findMany({
      where: {
        tenantId,
        OR: [
          ...(body.jobIds?.length
            ? [
                {
                  id: {
                    in: body.jobIds,
                  },
                },
              ]
            : []),
          ...(dateRange
            ? [
                {
                  createdAt: {
                    gte: dateRange.from,
                    lte: dateRange.to,
                  },
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        companyId: true,
      },
    });

    const jobIds = jobs.map((job) => job.id);
    const companyIdsFromJobs = jobs
      .map((job) => job.companyId)
      .filter((value): value is string => Boolean(value));

    const applications = jobIds.length
      ? await prisma.application.findMany({
          where: {
            jobId: { in: jobIds },
            tenantId,
          },
          select: {
            id: true,
            candidateId: true,
          },
        })
      : [];

    const applicationIds = applications.map((application) => application.id);
    const candidateIdsFromApplications = applications.map(
      (application) => application.candidateId,
    );

    const timesheets = applicationIds.length
      ? await prisma.timesheet.findMany({
          where: {
            applicationId: { in: applicationIds },
            tenantId,
          },
          select: { id: true },
        })
      : [];

    const timesheetIds = timesheets.map((timesheet) => timesheet.id);

    const candidateIdsCreatedOnDate =
      deleteCandidates && dateRange
        ? (
            await prisma.candidate.findMany({
              where: {
                tenantId,
                createdAt: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              },
              select: { id: true },
            })
          ).map((candidate) => candidate.id)
        : [];

    const candidateIdsToCheck = Array.from(
      new Set([...candidateIdsFromApplications, ...candidateIdsCreatedOnDate]),
    );

    const candidateIdsEligibleForDelete = deleteCandidates
      ? (
          await prisma.candidate.findMany({
            where: {
              tenantId,
              id: {
                in: candidateIdsToCheck,
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

    const clientAccountIdsCreatedOnDate =
      deleteClients && dateRange
        ? (
            await prisma.clientAccount.findMany({
              where: {
                tenantId,
                createdAt: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              },
              select: { id: true },
            })
          ).map((account) => account.id)
        : [];

    const companyIdsCreatedOnDate =
      deleteClients && dateRange
        ? (
            await prisma.company.findMany({
              where: {
                tenantId,
                createdAt: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              },
              select: { id: true },
            })
          ).map((company) => company.id)
        : [];

    const companyIdsToCheck = Array.from(
      new Set([...companyIdsFromJobs, ...companyIdsCreatedOnDate]),
    );

    const companyIdsEligibleForDelete = deleteClients
      ? (
          await prisma.company.findMany({
            where: {
              tenantId,
              id: {
                in: companyIdsToCheck,
              },
            },
            select: {
              id: true,
              _count: {
                select: {
                  jobs: true,
                  reports: true,
                },
              },
              settings: {
                select: {
                  id: true,
                },
              },
            },
          })
        )
          .filter((company) => company._count.jobs === 0)
          .map((company) => ({
            id: company.id,
            settingsId: company.settings?.id,
          }))
      : [];

    const clientAccountsEligibleForDelete = deleteClients
      ? (
          await prisma.clientAccount.findMany({
            where: {
              tenantId,
              id: {
                in: clientAccountIdsCreatedOnDate,
              },
            },
            select: {
              id: true,
              _count: {
                select: {
                  contacts: true,
                  vacancies: true,
                },
              },
            },
          })
        )
          .filter(
            (account) =>
              account._count.contacts === 0 && account._count.vacancies === 0,
          )
          .map((account) => account.id)
      : [];

    const summary = {
      mode: dryRun ? "dry-run" : "execute",
      jobsMatched: jobIds.length,
      opportunitiesMatched: applicationIds.length,
      candidatesEligibleForDelete: candidateIdsEligibleForDelete.length,
      companiesEligibleForDelete: companyIdsEligibleForDelete.length,
      clientAccountsEligibleForDelete: clientAccountsEligibleForDelete.length,
      invoicesMatched: timesheetIds.length,
    };

    if (!dryRun) {
      await prisma.$transaction(async (tx) => {
        if (deleteOpportunities && timesheetIds.length) {
          await tx.invoice.deleteMany({
            where: {
              timesheetId: { in: timesheetIds },
              tenantId,
            },
          });
        }

        if (deleteOpportunities && applicationIds.length) {
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
        }

        if (deleteJobs && jobIds.length) {
          await tx.job.deleteMany({
            where: {
              id: { in: jobIds },
              tenantId,
            },
          });
        }

        if (deleteCandidates && candidateIdsEligibleForDelete.length) {
          await tx.candidateAgreement.deleteMany({
            where: {
              candidateId: { in: candidateIdsEligibleForDelete },
              tenantId,
            },
          });

          await tx.candidate.deleteMany({
            where: {
              id: { in: candidateIdsEligibleForDelete },
              tenantId,
            },
          });
        }

        if (deleteClients && companyIdsEligibleForDelete.length) {
          const settingsIds = companyIdsEligibleForDelete
            .map((company) => company.settingsId)
            .filter((value): value is string => Boolean(value));

          if (settingsIds.length) {
            await tx.companySettings.deleteMany({
              where: {
                id: { in: settingsIds },
              },
            });
          }

          await tx.monthlyFinanceReport.deleteMany({
            where: {
              company: {
                tenantId,
                id: {
                  in: companyIdsEligibleForDelete.map((company) => company.id),
                },
              },
            },
          });

          await tx.company.deleteMany({
            where: {
              id: {
                in: companyIdsEligibleForDelete.map((company) => company.id),
              },
              tenantId,
            },
          });
        }

        if (deleteClients && clientAccountsEligibleForDelete.length) {
          await tx.clientAccount.deleteMany({
            where: {
              id: {
                in: clientAccountsEligibleForDelete,
              },
              tenantId,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            tenantId,
            actor,
            entityType: "import_cleanup",
            entityId: body.date ?? body.jobIds?.join(",") ?? "unknown",
            action: "delete_imported_data",
            afterJson: summary,
          },
        });
      });
    }

    return jsonOk(summary);
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to clean imported data", 400, {
      message: (error as Error).message,
    });
  }
}
