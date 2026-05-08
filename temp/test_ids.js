const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const jobs =
    await p.$queryRaw`SELECT id, title FROM Job WHERE tenantId = 'dotcloudconsulting' AND rawText IS NOT NULL LIMIT 1`;
  const candidates =
    await p.$queryRaw`SELECT id, fullName FROM Candidate WHERE tenantId = 'dotcloudconsulting' AND rawCV IS NOT NULL LIMIT 1`;
  const applications =
    await p.$queryRaw`SELECT id, jobId, candidateId FROM Application WHERE tenantId = 'dotcloudconsulting' LIMIT 1`;
  console.log(
    JSON.stringify({
      job: jobs[0],
      candidate: candidates[0],
      application: applications[0],
    }),
  );
  await p.$disconnect();
})();
