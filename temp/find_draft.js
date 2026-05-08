const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const drafts = await p.emailDraft.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: { id: true, applicationId: true, subject: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5
  });
  console.log(JSON.stringify(drafts, null, 2));
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
