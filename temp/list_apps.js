const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Get all eligible applications - broader search
  const apps = await p.application.findMany({
    where: {
      currentStage: "SHORTLISTED",
      emails: { none: {} },
      job: { createdAt: { gte: new Date("2026-04-25") } },
    },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: { select: { title: true, isRemote: true, requiresUsWorkAuth: true } },
      candidate: { select: { fullName: true } },
    },
    take: 20,
  });

  console.log(`Found ${apps.length} eligible applications (no remote/US filter):`);
  for (const app of apps) {
    console.log(`${app.id} | ${app.job.title} | ${app.candidate.fullName} | remote:${app.job.isRemote} | usAuth:${app.job.requiresUsWorkAuth}`);
  }
  await p.$disconnect();
}
main().catch(e => console.error(e));