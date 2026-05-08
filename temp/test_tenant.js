const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ datasources: { db: { url: "file:/app/db/prod.db?connection_limit=1" } } });
async function main() {
  const job = await p.job.findUnique({
    where: { id: "cmo784gj6002wqt0186wtfqn7" },
    select: { id: true, title: true, tenantId: true }
  });
  const cand = await p.candidate.findUnique({
    where: { id: "cmnyjur6x0000qh013fz2bo4o" },
    select: { id: true, fullName: true, tenantId: true }
  });
  console.log("Job:", JSON.stringify(job));
  console.log("Candidate:", JSON.stringify(cand));
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
