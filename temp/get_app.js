const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const app = await p.application.findFirst({
    where: {
      currentStage: "SHORTLISTED",
      emails: { none: {} },
      job: {
        createdAt: { gte: new Date("2026-04-25") },
        isRemote: true,
        requiresUsWorkAuth: null,
      },
    },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: { select: { title: true } },
      candidate: { select: { fullName: true } },
    },
  });

  if (!app) {
    console.log("No eligible application");
    await p.$disconnect();
    return;
  }

  console.log("Testing:", app.id, app.job.title, app.candidate.fullName);
  console.log("applicationId:", app.id);
  console.log("jobId:", app.jobId);
  console.log("candidateId:", app.candidateId);
  await p.$disconnect();
}
main().catch((e) => console.error(e));
