const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  // Find an application that does NOT have an existing email draft
  const apps = await p.$queryRaw`
    SELECT a.id, a.jobId, a.candidateId
    FROM Application a
    JOIN Job j ON a.jobId = j.id
    JOIN Candidate c ON a.candidateId = c.id
    LEFT JOIN EmailDraft ed ON ed.applicationId = a.id
    WHERE a.tenantId = 'dotcloudconsulting'
      AND j.rawText IS NOT NULL
      AND c.rawCV IS NOT NULL
      AND ed.id IS NULL
    LIMIT 3
  `;
  console.log(JSON.stringify(apps));
  await p.$disconnect();
})();
