import { PrismaClient, VettingStatus } from "@prisma/client";
import path from "node:path";

type LegacyCandidateRow = {
  id: string;
  fullName: string;
  rawCV: string;
  isActive: number | boolean;
  vettingStatus: string;
  vettedAt: Date | string | null;
  vettingNotes: string | null;
  email: string | null;
  phone: string | null;
  skillsCsv: string | null;
  certificationsCsv: string | null;
  suggestedRolesCsv: string | null;
};

type MigrationStats = {
  sourceCount: number;
  created: number;
  updated: number;
};

const SOURCE_DB_URL =
  process.env.SOURCE_DATABASE_URL ??
  `file:${path.resolve(process.cwd(), "prisma/dev.db")}`;
const TARGET_DB_URL =
  process.env.TARGET_DATABASE_URL ??
  `file:${path.resolve(process.cwd(), "prisma/prod.db")}`;
const TARGET_TENANT_ID = process.env.TARGET_TENANT_ID ?? "dotcloudconsulting";

function toVettingStatus(value: string): VettingStatus {
  if (value === "NOT_STARTED") {
    return VettingStatus.NOT_STARTED;
  }

  if (value === "IN_PROGRESS") {
    return VettingStatus.PENDING_VETTING;
  }

  if (value === "COMPLETE") {
    return VettingStatus.VETTED;
  }

  if (value === "REJECTED") {
    return VettingStatus.REJECTED;
  }

  return VettingStatus.NOT_STARTED;
}

async function ensureTargetTenant(targetPrisma: PrismaClient): Promise<void> {
  const existing = await targetPrisma.tenant.findUnique({
    where: {
      tenantId: TARGET_TENANT_ID,
    },
    select: { tenantId: true },
  });

  if (!existing) {
    await targetPrisma.tenant.create({
      data: {
        tenantId: TARGET_TENANT_ID,
        displayName: "DotCloud Consulting",
      },
    });
  }
}

async function readLegacyCandidates(
  sourcePrisma: PrismaClient,
): Promise<LegacyCandidateRow[]> {
  const rows = await sourcePrisma.$queryRawUnsafe<LegacyCandidateRow[]>(`
    SELECT
      id,
      fullName,
      rawCV,
      isActive,
      vettingStatus,
      vettedAt,
      vettingNotes,
      email,
      phone,
      skillsCsv,
      certificationsCsv,
      suggestedRolesCsv
    FROM Candidate
    WHERE email IS NULL OR lower(email) NOT LIKE '%@example.com'
    ORDER BY createdAt ASC
  `);

  return rows;
}

async function upsertCandidate(
  targetPrisma: PrismaClient,
  candidate: LegacyCandidateRow,
  stats: MigrationStats,
): Promise<void> {
  const trimmedEmail = candidate.email?.trim().toLowerCase() ?? null;

  const existing = trimmedEmail
    ? await targetPrisma.candidate.findFirst({
        where: {
          tenantId: TARGET_TENANT_ID,
          email: {
            equals: trimmedEmail,
          },
        },
        select: { id: true },
      })
    : await targetPrisma.candidate.findFirst({
        where: {
          tenantId: TARGET_TENANT_ID,
          fullName: candidate.fullName,
          phone: candidate.phone,
        },
        select: { id: true },
      });

  const data = {
    tenantId: TARGET_TENANT_ID,
    fullName: candidate.fullName,
    rawCV: candidate.rawCV ?? "",
    isActive: Boolean(candidate.isActive),
    vettingStatus: toVettingStatus(candidate.vettingStatus),
    vettedAt: candidate.vettedAt ? new Date(candidate.vettedAt) : null,
    vettingNotes: candidate.vettingNotes,
    email: trimmedEmail,
    phone: candidate.phone,
    skillsCsv: candidate.skillsCsv ?? "",
    certificationsCsv: candidate.certificationsCsv ?? "",
    suggestedRolesCsv: candidate.suggestedRolesCsv ?? "",
  };

  if (existing) {
    await targetPrisma.candidate.update({
      where: { id: existing.id },
      data,
    });
    stats.updated += 1;
    return;
  }

  await targetPrisma.candidate.create({ data });
  stats.created += 1;
}

async function main(): Promise<void> {
  const sourcePrisma = new PrismaClient({
    datasources: {
      db: {
        url: SOURCE_DB_URL,
      },
    },
  });

  const targetPrisma = new PrismaClient({
    datasources: {
      db: {
        url: TARGET_DB_URL,
      },
    },
  });

  const stats: MigrationStats = {
    sourceCount: 0,
    created: 0,
    updated: 0,
  };

  try {
    await ensureTargetTenant(targetPrisma);

    const sourceCandidates = await readLegacyCandidates(sourcePrisma);
    stats.sourceCount = sourceCandidates.length;

    for (const sourceCandidate of sourceCandidates) {
      await upsertCandidate(targetPrisma, sourceCandidate, stats);
    }

    console.log("Non-example candidate migration complete.");
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await Promise.all([sourcePrisma.$disconnect(), targetPrisma.$disconnect()]);
  }
}

main().catch((error) => {
  console.error("Failed to migrate non-example candidates", error);
  process.exitCode = 1;
});
