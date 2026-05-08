const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  const apps = await p.application.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      currentStage: "SHORTLISTED",
    },
    select: {
      id: true,
      currentStage: true,
      job: { select: { title: true, opportunityEmail: true } },
      candidate: { select: { fullName: true } },
      emails: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const missing = apps.filter(a => a.emails.length === 0);
  const hasDraft = apps.filter(a => a.emails.length > 0);

  console.log(`SHORTLISTED total: ${apps.length}`);
  console.log(`Already have a draft: ${hasDraft.length}`);
  console.log(`Missing draft: ${missing.length}\n`);

  for (const a of missing) {
    console.log(`  "${a.job.title}" → ${a.job.opportunityEmail ?? "(no email)"} | ${a.candidate.fullName}`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
