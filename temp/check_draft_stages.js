const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ log: [] });
async function main() {
  // Get applicationIds for todays email drafts
  const drafts = await p.emailDraft.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      createdAt: { gte: new Date("2026-04-20T00:00:00.000Z"), lte: new Date("2026-04-20T23:59:59.999Z") }
    },
    select: { applicationId: true }
  });
  const appIds = [...new Set(drafts.map(d => d.applicationId))];
  console.log("Unique applications with drafts today:", appIds.length);

  // Check their current stages
  const apps = await p.application.findMany({
    where: { id: { in: appIds } },
    select: {
      id: true,
      currentStage: true,
      job: { select: { title: true } },
      candidate: { select: { fullName: true } }
    }
  });

  const stageCounts = {};
  for (const a of apps) {
    stageCounts[a.currentStage] = (stageCounts[a.currentStage] || 0) + 1;
  }
  console.log("\nStage breakdown for draft applications:");
  for (const [stage, count] of Object.entries(stageCounts)) {
    console.log(`  ${stage}: ${count}`);
  }

  const sent = apps.filter(a => a.currentStage === "SENT_TO_CLIENT");
  if (sent.length > 0) {
    console.log("\n⚠️  SENT_TO_CLIENT applications (already sent to clients):");
    for (const a of sent) {
      console.log(`  "${a.job.title}" → ${a.candidate.fullName}`);
    }
  } else {
    console.log("\n✅ None of today's draft applications have been sent to clients yet.");
  }

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
