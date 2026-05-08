const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ log: [] });
async function main() {
  const drafts = await p.emailDraft.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      createdAt: { gte: new Date("2026-04-20T00:00:00.000Z"), lte: new Date("2026-04-20T23:59:59.999Z") }
    },
    take: 5,
    orderBy: { createdAt: "asc" }
  });
  for (const d of drafts) {
    const plain = d.htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
    const hasDotCloud = plain.includes("dotcloud");
    const dotcloudCount = (plain.match(/dotcloud/g) || []).length;
    console.log(`DRAFT: ${d.id}`);
    console.log(`  Subject: ${d.subject}`);
    console.log(`  DotCloud in body: ${hasDotCloud} (${dotcloudCount}x)`);
    // Show first 600chars of plain
    console.log(`  Body sample: ${plain.slice(0,600)}`);
    console.log();
  }
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
