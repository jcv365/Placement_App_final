const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const drafts = await p.emailDraft.findMany({
    where: { tenantId: "dotcloudconsulting", subject: { contains: "Kgomotso" } },
    select: { id: true, applicationId: true, subject: true, createdAt: true, htmlBody: true },
    orderBy: { createdAt: "desc" }
  });
  console.log("Count:", drafts.length);
  for (const d of drafts) {
    console.log(d.id, d.applicationId, d.subject);
    // Show first 200 chars of body
    const text = d.htmlBody.replace(/<[^>]+>/g, "").replace(/\s+/g," ").trim();
    console.log("  Preview:", text.substring(0, 200));
  }
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
