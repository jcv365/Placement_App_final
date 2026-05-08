const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  // Find all EA drafts missing from Outlook
  const eaDrafts = await p.emailDraft.findMany({
    where: {
      subject: { contains: "Enterprise Architect" },
      tenantId: "dotcloudconsulting",
    },
    select: { id: true, subject: true },
  });
  console.log("EA drafts remaining in DB:", eaDrafts.length);
  eaDrafts.forEach((d) => console.log("  -", d.id, d.subject));

  // Delete all of them since the user wants them gone
  for (const d of eaDrafts) {
    await p.emailDraft.delete({ where: { id: d.id } });
    console.log("Deleted:", d.subject);
  }

  const count = await p.emailDraft.count({
    where: { tenantId: "dotcloudconsulting" },
  });
  console.log("\nRemaining DB drafts:", count);
  await p.$disconnect();
})();
