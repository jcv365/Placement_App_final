const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  // Find an application where both the job has rawText and candidate has rawCV
  const apps = await p.$queryRaw`
    SELECT a.id, a.jobId, a.candidateId
    FROM Application a
    JOIN Job j ON a.jobId = j.id
    JOIN Candidate c ON a.candidateId = c.id
    WHERE a.tenantId = 'dotcloudconsulting'
      AND j.rawText IS NOT NULL
      AND c.rawCV IS NOT NULL
    LIMIT 1
  `;
  console.log(JSON.stringify(apps[0]));
  await p.$disconnect();
})();
