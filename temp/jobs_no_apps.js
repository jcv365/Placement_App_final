const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  const jobs = await p.job.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: {
      id: true,
      title: true,
      opportunityEmail: true,
      createdAt: true,
      _count: { select: { applications: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const noApps = jobs.filter(j => j._count.applications === 0);
  const hasApps = jobs.filter(j => j._count.applications > 0);

  console.log(`Total jobs: ${jobs.length}`);
  console.log(`With applications: ${hasApps.length}`);
  console.log(`With NO applications: ${noApps.length}\n`);

  for (const j of noApps) {
    const age = Math.floor((Date.now() - new Date(j.createdAt).getTime()) / 86400000);
    console.log(`  [${age}d ago] "${j.title}" → ${j.opportunityEmail ?? "(no email)"}`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
