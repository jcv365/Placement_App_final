const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const ea = await p.emailDraft.findMany({
    where: {
      subject: { contains: "Enterprise Architect" },
      tenantId: "dotcloudconsulting",
    },
    select: { id: true, subject: true },
  });
  console.log("Enterprise Architect drafts in DB:", ea.length);
  ea.forEach((d) => console.log("  -", d.id, d.subject));
  await p.$disconnect();
})();
