const { PrismaClient } = require("@prisma/client");
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: "file:./prod.db" } } });
  const users = await p.tenantUser.findMany({ select: { email: true, tenantId: true, role: true } });
  users.forEach(u => console.log(u.role + " | " + u.tenantId + " | " + u.email));
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
