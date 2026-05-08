const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const totalDrafts = await p.emailDraft.count({
    where: { tenantId: "dotcloudconsulting" },
  });
  console.log("Remaining DB drafts:", totalDrafts);

  // Count how many DB drafts still have corresponding Outlook drafts
  // by checking a sample
  const sampleDrafts = await p.emailDraft.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: { subject: true },
    take: 10,
  });
  console.log("\nSample remaining DB drafts:");
  for (const d of sampleDrafts) {
    console.log(`  - ${d.subject}`);
  }

  await p.$disconnect();
})();
