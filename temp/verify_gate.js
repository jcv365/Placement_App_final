const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  // Find a job that should be blocked by the location gate
  const blockedJob = await p.job.findFirst({
    where: { tenantId: "dotcloudconsulting", requiresNonSaLocation: true },
    select: {
      id: true,
      title: true,
      requiresNonSaLocation: true,
      requiresUkWorkAuth: true,
    },
  });
  console.log("Sample blocked job:", JSON.stringify(blockedJob, null, 2));

  // Find a job that should be allowed
  const allowedJob = await p.job.findFirst({
    where: {
      tenantId: "dotcloudconsulting",
      requiresNonSaLocation: null,
      requiresUsWorkAuth: null,
      isRemote: true,
    },
    select: {
      id: true,
      title: true,
      requiresNonSaLocation: true,
      requiresUkWorkAuth: true,
      isRemote: true,
    },
  });
  console.log("Sample allowed job:", JSON.stringify(allowedJob, null, 2));

  // Count remaining drafts
  const totalDrafts = await p.emailDraft.count({
    where: { tenantId: "dotcloudconsulting" },
  });
  console.log("\nTotal remaining drafts:", totalDrafts);

  await p.$disconnect();
})();
