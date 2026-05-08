const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ datasources: { db: { url: "file:/app/db/prod.db?connection_limit=1" } } });
async function main() {
  const apps = await p.application.findMany({
    where: {
      job: { rawText: { not: "" } },
      candidate: { rawCV: { not: "" } }
    },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: { select: { title: true, company: { select: { name: true } } } },
      candidate: { select: { fullName: true } }
    },
    orderBy: { updatedAt: "desc" },
    take: 5
  });
  apps.forEach(a => console.log(JSON.stringify({
    appId: a.id,
    jobId: a.jobId,
    candidateId: a.candidateId,
    jobTitle: a.job.title,
    company: a.job.company?.name,
    candidate: a.candidate.fullName
  })));
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
