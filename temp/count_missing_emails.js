const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const apps = await p.application.findMany({
    where: { currentStage: "SHORTLISTED", emails: { none: {} } },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: {
        select: {
          title: true,
          isRemote: true,
          requiresUsWorkAuth: true,
          opportunityEmail: true,
        },
      },
      candidate: { select: { fullName: true } },
    },
    take: 200,
  });
  const eligible = apps.filter(
    (a) =>
      a.job.opportunityEmail &&
      a.job.isRemote !== false &&
      a.job.requiresUsWorkAuth !== true,
  );
  console.log("Total SHORTLISTED without drafts:", apps.length);
  console.log("Eligible (remote, no US auth, has email):", eligible.length);
  eligible.forEach((a) =>
    console.log(
      "  -",
      a.id.slice(0, 8),
      a.job.title,
      "|",
      a.candidate.fullName,
    ),
  );
  await p.$disconnect();
}
main().catch((e) => console.error(e));
