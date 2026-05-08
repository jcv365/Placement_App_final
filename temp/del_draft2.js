const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const deleted = await p.emailDraft.deleteMany({
    where: { tenantId: "dotcloudconsulting", subject: { contains: "Cloud Engineer" }, application: { candidateId: "cmnyjur6x0000qh013fz2bo4o" } }
  });
  console.log("Deleted:", deleted.count);
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
