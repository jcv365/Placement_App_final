import { prisma } from "../src/lib/prisma";

async function main() {
  const applications = await prisma.application.findMany({
    where: {
      opportunityId: {
        not: "",
      },
    },
    select: {
      id: true,
      opportunityId: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  const groups = new Map<string, string[]>();
  for (const application of applications) {
    const existing = groups.get(application.opportunityId) ?? [];
    existing.push(application.id);
    groups.set(application.opportunityId, existing);
  }

  let dedupedCount = 0;

  for (const ids of groups.values()) {
    if (ids.length <= 1) {
      continue;
    }

    const [canonicalId, ...duplicateIds] = ids;
    dedupedCount += duplicateIds.length;

    await prisma.$transaction([
      prisma.applicationStageHistory.updateMany({
        where: { applicationId: { in: duplicateIds } },
        data: { applicationId: canonicalId },
      }),
      prisma.note.updateMany({
        where: { applicationId: { in: duplicateIds } },
        data: { applicationId: canonicalId },
      }),
      prisma.emailDraft.updateMany({
        where: { applicationId: { in: duplicateIds } },
        data: { applicationId: canonicalId },
      }),
      prisma.application.deleteMany({
        where: { id: { in: duplicateIds } },
      }),
    ]);
  }

  console.log(`Deduplicated ${dedupedCount} application records.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
