const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Count all SHORTLISTED apps without drafts
  const total = await p.application.count({
    where: { currentStage: "SHORTLISTED", emails: { none: {} } },
  });
  console.log("Total SHORTLISTED without drafts:", total);

  // Count by job date
  const after25 = await p.application.count({
    where: { currentStage: "SHORTLISTED", emails: { none: {} }, job: { createdAt: { gte: new Date("2026-04-25") } } },
  });
  console.log("After 25 April:", after25);

  // Check remote/usAuth breakdown
  const apps = await p.application.findMany({
    where: { currentStage: "SHORTLISTED", emails: { none: {} }, job: { createdAt: { gte: new Date("2026-04-25") } } },
    select: {
      id: true,
      job: { select: { title: true, isRemote: true, requiresUsWorkAuth: true, createdAt: true } },
      candidate: { select: { fullName: true } },
    },
    take: 20,
  });
  console.log("\nFirst 20 apps after 25 April:");
  for (const a of apps) {
    console.log(`  ${a.id} | ${a.job.title} | remote=${a.job.isRemote} | usAuth=${a.job.requiresUsWorkAuth} | ${a.candidate.fullName}`);
  }

  // Check how many are EMAIL_DRAFTED already
  const drafted = await p.application.count({
    where: { currentStage: "EMAIL_DRAFTED", job: { createdAt: { gte: new Date("2026-04-25") } } },
  });
  console.log("\nAlready EMAIL_DRAFTED (after 25 April):", drafted);

  await p.$disconnect();
}
main().catch(e => console.error(e));
