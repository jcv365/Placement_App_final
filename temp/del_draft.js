const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const deleted = await p.emailDraft.deleteMany({
    where: { applicationId: "cmo78bofs005eqt01528jbetw" }
  });
  console.log("Deleted:", deleted.count, "draft(s)");
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
