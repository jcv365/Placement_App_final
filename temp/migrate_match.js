const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS "JobCandidateMatch" ("id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL DEFAULT 'default', "jobId" TEXT NOT NULL, "candidateId" TEXT NOT NULL, "aiScore" INTEGER NOT NULL, "rationale" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "JobCandidateMatch_tenantId_jobId_candidateId_key" ON "JobCandidateMatch"("tenantId", "jobId", "candidateId")`,
    `CREATE INDEX IF NOT EXISTS "JobCandidateMatch_tenantId_jobId_createdAt_idx" ON "JobCandidateMatch"("tenantId", "jobId", "createdAt")`,
  ];
  for (const s of stmts) {
    await p.$executeRawUnsafe(s);
    console.log("OK:", s.slice(0, 70));
  }
  await p.$disconnect();
  console.log("Migration complete.");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
