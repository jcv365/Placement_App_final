const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const total = await p.job.count();
  const recent = await p.job.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, title: true, opportunityEmail: true, createdAt: true }
  });
  console.log(`Total jobs: ${total}`);
  console.log('Most recent 5:');
  recent.forEach(j => console.log(`  ${j.createdAt.toISOString()} | ${j.title} | ${j.opportunityEmail}`));
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
