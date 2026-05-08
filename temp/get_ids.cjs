const { PrismaClient } = require("/app/node_modules/@prisma/client");
const p = new PrismaClient();
p.application
  .findMany({
    where: { tenantId: "dotcloudconsulting" },
    include: {
      job: { select: { title: true, opportunityEmail: true } },
      candidate: { select: { fullName: true } },
    },
    take: 5,
  })
  .then((rows) => {
    rows.forEach((r) =>
      console.log(
        JSON.stringify({
          appId: r.id,
          jobId: r.jobId,
          candidateId: r.candidateId,
          jobTitle: r.job.title,
          candidateName: r.candidate.fullName,
        }),
      ),
    );
  })
  .catch((e) => console.error(e.message))
  .finally(() => p.$disconnect());
