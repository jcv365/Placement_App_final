// Check SHORTLISTED applications created today and yesterday and report missing drafts
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function summaryForRange(start, end, label) {
  const apps = await p.application.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      currentStage: "SHORTLISTED",
      createdAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      createdAt: true,
      job: { select: { title: true } },
      candidate: { select: { fullName: true } },
      emails: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const total = apps.length;
  const missing = apps.filter((a) => a.emails.length === 0);

  console.log(`\n${label}:`);
  console.log(`  SHORTLISTED total: ${total}`);
  console.log(`  Missing draft: ${missing.length}`);

  if (missing.length > 0) {
    console.log("  Missing list:");
    for (const a of missing) {
      console.log(`    ${a.id} — "${a.job.title}" / ${a.candidate.fullName}`);
    }
  }
}

async function main() {
  const now = new Date();
  const startToday = startOfDay(now);
  const startYesterday = new Date(startToday.getTime() - 24 * 60 * 60 * 1000);
  const endToday = new Date(startToday.getTime() + 24 * 60 * 60 * 1000);

  console.log(
    `Checking uploads for: yesterday (${startYesterday.toISOString().slice(0, 10)}) and today (${startToday.toISOString().slice(0, 10)})`,
  );

  await summaryForRange(startYesterday, startToday, "Yesterday");
  await summaryForRange(startToday, endToday, "Today");

  await p.$disconnect();
}

main().catch(async (err) => {
  console.error(err.message);
  await p.$disconnect();
  process.exit(1);
});
