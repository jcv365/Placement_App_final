import { PrismaClient, TenantUserRole } from "@prisma/client";

import { hashPassword } from "../src/lib/appAuth";

const DEMO_DB_URL = process.env.DEMO_DATABASE_URL ?? "file:./demo.db";
const PROD_DB_URL = process.env.PROD_DATABASE_URL ?? "file:./prod.db";

const DEMO_TENANT_ID = process.env.DEMO_TENANT_ID ?? "default";
const DEMO_TENANT_NAME = process.env.DEMO_TENANT_NAME ?? "Demo Instance";

const DEMO_ADMIN_EMAIL =
  process.env.DEMO_ADMIN_EMAIL ?? "demo.admin@example.com";
const DEMO_ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin123!";
const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo.user@example.com";
const DEMO_USER_PASSWORD = process.env.DEMO_USER_PASSWORD ?? "DemoUser123!";

const EXAMPLE_DOMAIN = "@example.com";

type SyncStats = {
  createdUsers: number;
  updatedUsers: number;
  movedUsers: number;
  movedCandidates: number;
  movedJobs: number;
  movedApplications: number;
  removedProdUsers: number;
  removedProdCandidates: number;
  removedProdApplications: number;
  removedProdJobs: number;
};

function isExampleEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.trim().toLowerCase().endsWith(EXAMPLE_DOMAIN));
}

function normaliseOpportunityId(input: string): string {
  const parts = input.split(":");
  if (parts.length > 1) {
    return `${DEMO_TENANT_ID}:${parts.slice(1).join(":")}`;
  }

  return `${DEMO_TENANT_ID}:${input}`;
}

async function ensureUniqueOpportunityId(
  demoPrisma: PrismaClient,
  seedId: string,
): Promise<string> {
  let candidate = seedId;
  let suffix = 1;

  for (;;) {
    const existing = await demoPrisma.application.findUnique({
      where: {
        tenantId_opportunityId: {
          tenantId: DEMO_TENANT_ID,
          opportunityId: candidate,
        },
      },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }

    candidate = `${seedId}-${suffix}`;
    suffix += 1;
  }
}

async function ensureDemoTenantAndUsers(
  demoPrisma: PrismaClient,
  stats: SyncStats,
): Promise<{ demoUserId: string }> {
  await demoPrisma.tenant.upsert({
    where: { tenantId: DEMO_TENANT_ID },
    create: {
      tenantId: DEMO_TENANT_ID,
      displayName: DEMO_TENANT_NAME,
    },
    update: {
      displayName: DEMO_TENANT_NAME,
    },
  });

  const company = await demoPrisma.company.findFirst({
    where: {
      tenantId: DEMO_TENANT_ID,
      name: DEMO_TENANT_NAME,
    },
    select: { id: true },
  });

  if (!company) {
    await demoPrisma.company.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        name: DEMO_TENANT_NAME,
      },
    });
  }

  const now = new Date();
  const adminHash = await hashPassword(DEMO_ADMIN_PASSWORD);
  const userHash = await hashPassword(DEMO_USER_PASSWORD);

  const seededUsers = [
    {
      fullName: "Demo Administrator",
      email: DEMO_ADMIN_EMAIL,
      role: TenantUserRole.ADMIN,
      passwordHash: adminHash,
    },
    {
      fullName: "Demo User",
      email: DEMO_USER_EMAIL,
      role: TenantUserRole.USER,
      passwordHash: userHash,
    },
  ] as const;

  let demoUserId = "";

  for (const seededUser of seededUsers) {
    const existing = await demoPrisma.tenantUser.findUnique({
      where: {
        tenantId_email: {
          tenantId: DEMO_TENANT_ID,
          email: seededUser.email,
        },
      },
      select: { id: true },
    });

    const upserted = await demoPrisma.tenantUser.upsert({
      where: {
        tenantId_email: {
          tenantId: DEMO_TENANT_ID,
          email: seededUser.email,
        },
      },
      create: {
        tenantId: DEMO_TENANT_ID,
        fullName: seededUser.fullName,
        email: seededUser.email,
        role: seededUser.role,
        passwordHash: seededUser.passwordHash,
        isActive: true,
        emailVerifiedAt: now,
      },
      update: {
        fullName: seededUser.fullName,
        role: seededUser.role,
        passwordHash: seededUser.passwordHash,
        isActive: true,
        emailVerifiedAt: now,
        verifyTokenHash: null,
        verifyTokenExpiry: null,
      },
      select: { id: true },
    });

    if (existing) {
      stats.updatedUsers += 1;
    } else {
      stats.createdUsers += 1;
    }

    if (seededUser.role === TenantUserRole.USER) {
      demoUserId = upserted.id;
    }
  }

  if (!demoUserId) {
    throw new Error("Unable to resolve demo user account.");
  }

  return { demoUserId };
}

async function moveExampleUsersToDemo(
  prodPrisma: PrismaClient,
  demoPrisma: PrismaClient,
  stats: SyncStats,
): Promise<void> {
  const prodUsers = await prodPrisma.tenantUser.findMany({
    where: {
      email: {
        endsWith: EXAMPLE_DOMAIN,
      },
    },
  });

  for (const prodUser of prodUsers) {
    await demoPrisma.tenantUser.upsert({
      where: {
        tenantId_email: {
          tenantId: DEMO_TENANT_ID,
          email: prodUser.email,
        },
      },
      create: {
        tenantId: DEMO_TENANT_ID,
        fullName: prodUser.fullName,
        email: prodUser.email,
        role: prodUser.role,
        passwordHash: prodUser.passwordHash,
        isActive: true,
        emailVerifiedAt: prodUser.emailVerifiedAt ?? new Date(),
      },
      update: {
        fullName: prodUser.fullName,
        role: prodUser.role,
        passwordHash: prodUser.passwordHash,
        isActive: true,
        emailVerifiedAt: prodUser.emailVerifiedAt ?? new Date(),
      },
    });

    stats.movedUsers += 1;
  }

  const removed = await prodPrisma.tenantUser.deleteMany({
    where: {
      email: {
        endsWith: EXAMPLE_DOMAIN,
      },
    },
  });

  stats.removedProdUsers += removed.count;
}

async function moveExampleCandidatesToDemo(
  prodPrisma: PrismaClient,
  demoPrisma: PrismaClient,
  demoUserId: string,
  stats: SyncStats,
): Promise<void> {
  const sourceCandidates = await prodPrisma.candidate.findMany({
    where: {
      email: {
        endsWith: EXAMPLE_DOMAIN,
      },
    },
    include: {
      applications: {
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

  const sourceCandidateIds: string[] = [];

  for (const sourceCandidate of sourceCandidates) {
    sourceCandidateIds.push(sourceCandidate.id);

    const existingCandidate = sourceCandidate.email
      ? await demoPrisma.candidate.findFirst({
          where: {
            tenantId: DEMO_TENANT_ID,
            email: sourceCandidate.email,
          },
          select: { id: true },
        })
      : null;

    const targetCandidate = existingCandidate
      ? await demoPrisma.candidate.update({
          where: { id: existingCandidate.id },
          data: {
            fullName: sourceCandidate.fullName,
            rawCV: sourceCandidate.rawCV,
            email: sourceCandidate.email,
            phone: sourceCandidate.phone,
            skillsCsv: sourceCandidate.skillsCsv,
            certificationsCsv: sourceCandidate.certificationsCsv,
            suggestedRolesCsv: sourceCandidate.suggestedRolesCsv,
            vettingStatus: sourceCandidate.vettingStatus,
            vettingNotes: sourceCandidate.vettingNotes,
            vettedAt: sourceCandidate.vettedAt,
            isActive: true,
            ownerUserId: demoUserId,
          },
          select: { id: true },
        })
      : await demoPrisma.candidate.create({
          data: {
            tenantId: DEMO_TENANT_ID,
            ownerUserId: demoUserId,
            fullName: sourceCandidate.fullName,
            rawCV: sourceCandidate.rawCV,
            email: sourceCandidate.email,
            phone: sourceCandidate.phone,
            skillsCsv: sourceCandidate.skillsCsv,
            certificationsCsv: sourceCandidate.certificationsCsv,
            suggestedRolesCsv: sourceCandidate.suggestedRolesCsv,
            vettingStatus: sourceCandidate.vettingStatus,
            vettingNotes: sourceCandidate.vettingNotes,
            vettedAt: sourceCandidate.vettedAt,
            isActive: true,
          },
          select: { id: true },
        });

    stats.movedCandidates += 1;

    for (const sourceApplication of sourceCandidate.applications) {
      let companyId: string | null = null;
      if (sourceApplication.job.company?.name) {
        const existingCompany = await demoPrisma.company.findFirst({
          where: {
            tenantId: DEMO_TENANT_ID,
            name: sourceApplication.job.company.name,
          },
          select: { id: true },
        });

        if (existingCompany) {
          companyId = existingCompany.id;
        } else {
          const createdCompany = await demoPrisma.company.create({
            data: {
              tenantId: DEMO_TENANT_ID,
              name: sourceApplication.job.company.name,
              domain: sourceApplication.job.company.domain,
            },
            select: { id: true },
          });
          companyId = createdCompany.id;
        }
      }

      let targetJob = sourceApplication.job.opportunityUrl
        ? await demoPrisma.job.findFirst({
            where: {
              tenantId: DEMO_TENANT_ID,
              opportunityUrl: sourceApplication.job.opportunityUrl,
            },
            select: { id: true },
          })
        : null;

      if (!targetJob) {
        targetJob = await demoPrisma.job.create({
          data: {
            tenantId: DEMO_TENANT_ID,
            ownerUserId: demoUserId,
            title: sourceApplication.job.title,
            rawText: sourceApplication.job.rawText,
            opportunityEmail: sourceApplication.job.opportunityEmail,
            opportunityUrl: sourceApplication.job.opportunityUrl,
            companyId,
          },
          select: { id: true },
        });

        stats.movedJobs += 1;
      }

      const desiredOpportunityId = normaliseOpportunityId(
        sourceApplication.opportunityId,
      );

      const existingApplication = await demoPrisma.application.findUnique({
        where: {
          tenantId_opportunityId: {
            tenantId: DEMO_TENANT_ID,
            opportunityId: desiredOpportunityId,
          },
        },
        select: { id: true },
      });

      const resolvedOpportunityId = existingApplication
        ? desiredOpportunityId
        : await ensureUniqueOpportunityId(demoPrisma, desiredOpportunityId);

      await demoPrisma.application.upsert({
        where: {
          tenantId_opportunityId: {
            tenantId: DEMO_TENANT_ID,
            opportunityId: resolvedOpportunityId,
          },
        },
        create: {
          tenantId: DEMO_TENANT_ID,
          ownerUserId: demoUserId,
          candidateId: targetCandidate.id,
          jobId: targetJob.id,
          opportunityId: resolvedOpportunityId,
          currentStage: sourceApplication.currentStage,
          c2cPartner: sourceApplication.c2cPartner,
          placedAt: sourceApplication.placedAt,
          agreedHourlyRate: sourceApplication.agreedHourlyRate,
          agreedRateLockedAt: sourceApplication.agreedRateLockedAt,
          signedContractFileName: sourceApplication.signedContractFileName,
          signedContractMimeType: sourceApplication.signedContractMimeType,
          signedContractData: sourceApplication.signedContractData,
          signedContractUploadedAt: sourceApplication.signedContractUploadedAt,
        },
        update: {
          ownerUserId: demoUserId,
          candidateId: targetCandidate.id,
          jobId: targetJob.id,
          currentStage: sourceApplication.currentStage,
          c2cPartner: sourceApplication.c2cPartner,
          placedAt: sourceApplication.placedAt,
          agreedHourlyRate: sourceApplication.agreedHourlyRate,
          agreedRateLockedAt: sourceApplication.agreedRateLockedAt,
          signedContractFileName: sourceApplication.signedContractFileName,
          signedContractMimeType: sourceApplication.signedContractMimeType,
          signedContractData: sourceApplication.signedContractData,
          signedContractUploadedAt: sourceApplication.signedContractUploadedAt,
        },
      });

      stats.movedApplications += 1;
    }
  }

  if (sourceCandidateIds.length === 0) {
    return;
  }

  const prodApplications = await prodPrisma.application.findMany({
    where: {
      candidateId: {
        in: sourceCandidateIds,
      },
    },
    select: {
      id: true,
    },
  });

  const prodApplicationIds = prodApplications.map(
    (application) => application.id,
  );

  if (prodApplicationIds.length > 0) {
    await prodPrisma.invoice.deleteMany({
      where: {
        timesheet: {
          applicationId: {
            in: prodApplicationIds,
          },
        },
      },
    });

    await prodPrisma.timesheet.deleteMany({
      where: {
        applicationId: {
          in: prodApplicationIds,
        },
      },
    });

    await prodPrisma.placementAlert.deleteMany({
      where: {
        applicationId: {
          in: prodApplicationIds,
        },
      },
    });

    await prodPrisma.emailDraft.deleteMany({
      where: {
        applicationId: {
          in: prodApplicationIds,
        },
      },
    });

    await prodPrisma.note.deleteMany({
      where: {
        applicationId: {
          in: prodApplicationIds,
        },
      },
    });

    await prodPrisma.applicationStageHistory.deleteMany({
      where: {
        applicationId: {
          in: prodApplicationIds,
        },
      },
    });

    const deletedApplications = await prodPrisma.application.deleteMany({
      where: {
        id: {
          in: prodApplicationIds,
        },
      },
    });

    stats.removedProdApplications += deletedApplications.count;
  }

  await prodPrisma.candidateAgreement.deleteMany({
    where: {
      candidateId: {
        in: sourceCandidateIds,
      },
    },
  });

  const deletedCandidates = await prodPrisma.candidate.deleteMany({
    where: {
      id: {
        in: sourceCandidateIds,
      },
    },
  });

  stats.removedProdCandidates += deletedCandidates.count;

  const prodExampleJobs = await prodPrisma.job.findMany({
    where: {
      opportunityEmail: {
        endsWith: EXAMPLE_DOMAIN,
      },
    },
    include: {
      _count: {
        select: {
          applications: true,
        },
      },
    },
  });

  const orphanJobIds = prodExampleJobs
    .filter((job) => job._count.applications === 0)
    .map((job) => job.id);

  if (orphanJobIds.length > 0) {
    const deletedJobs = await prodPrisma.job.deleteMany({
      where: {
        id: {
          in: orphanJobIds,
        },
      },
    });

    stats.removedProdJobs += deletedJobs.count;
  }
}

async function main(): Promise<void> {
  const stats: SyncStats = {
    createdUsers: 0,
    updatedUsers: 0,
    movedUsers: 0,
    movedCandidates: 0,
    movedJobs: 0,
    movedApplications: 0,
    removedProdUsers: 0,
    removedProdCandidates: 0,
    removedProdApplications: 0,
    removedProdJobs: 0,
  };

  const demoPrisma = new PrismaClient({
    datasources: {
      db: {
        url: DEMO_DB_URL,
      },
    },
  });

  const prodPrisma = new PrismaClient({
    datasources: {
      db: {
        url: PROD_DB_URL,
      },
    },
  });

  try {
    const { demoUserId } = await ensureDemoTenantAndUsers(demoPrisma, stats);

    await moveExampleUsersToDemo(prodPrisma, demoPrisma, stats);
    await moveExampleCandidatesToDemo(
      prodPrisma,
      demoPrisma,
      demoUserId,
      stats,
    );

    console.log("Demo data normalisation complete.");
    console.log(JSON.stringify(stats, null, 2));
    console.log("Demo credentials:");
    console.log(`- Admin: ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
    console.log(`- User:  ${DEMO_USER_EMAIL} / ${DEMO_USER_PASSWORD}`);
  } finally {
    await Promise.all([demoPrisma.$disconnect(), prodPrisma.$disconnect()]);
  }
}

main().catch((error) => {
  console.error("Failed to normalise demo data", error);
  process.exitCode = 1;
});
