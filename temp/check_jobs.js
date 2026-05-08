const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const jobs = await p.job.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, companyId: true, opportunityEmail: true, createdAt: true }
  });
  console.log(`Jobs created in last hour: ${jobs.length}`);
  jobs.forEach(j => console.log(`  ${j.createdAt.toISOString()} | ${j.title} | ${j.opportunityEmail}`));
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
