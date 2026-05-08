// Collect SHORTLISTED applications that have no EmailDrafts
// Usage: node scripts/collect_missing_ids.js
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  const apps = await p.application.findMany({
    where: { tenantId: "dotcloudconsulting", currentStage: "SHORTLISTED" },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: { select: { title: true } },
      candidate: { select: { fullName: true } },
      emails: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const missing = apps.filter((a) => a.emails.length === 0);

  console.log(JSON.stringify({ total: apps.length, missing: missing.length }));
  for (const a of missing) {
    console.log(
      JSON.stringify({
        applicationId: a.id,
        jobId: a.jobId,
        candidateId: a.candidateId,
        title: a.job.title,
        candidate: a.candidate.fullName,
      }),
    );
  }

  await p.$disconnect();
}

main().catch(async (err) => {
  console.error(err.message);
  await p.$disconnect();
  process.exit(1);
});
