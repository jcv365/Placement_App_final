const { PrismaClient } = require("@prisma/client");
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: "file:./prod.db" } } });
  const rows = await p.candidate.groupBy({ by: ["tenantId"], _count: { id: true } });
  rows.forEach(x => console.log(x.tenantId + ": " + x._count.id + " candidates"));
  const tenants = await p.tenant.findMany({ select: { id: true, name: true } });
  tenants.forEach(t => console.log("TENANT: " + t.id + " = " + t.name));
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
