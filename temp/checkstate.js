const { PrismaClient } = require("@prisma/client");
const HISTORY_MARKER = "Reset — email regeneration (April 11-12 batch)";
const p = new PrismaClient();
async function main() {
  const resetIds = (await p.applicationStageHistory.findMany({
    where: { changedBy: HISTORY_MARKER }, select: { applicationId: true }, distinct: ["applicationId"]
  })).map(r => r.applicationId);
  const apps = await p.application.findMany({
    where: { id: { in: resetIds } },
    select: {
      id: true, currentStage: true,
      job: { select: { title: true } },
      candidate: { select: { fullName: true } }
    }
  });
  const byStage = apps.reduce((acc, a) => { acc[a.currentStage] = (acc[a.currentStage] || 0) + 1; return acc; }, {});
  console.log("Stage breakdown:", JSON.stringify(byStage, null, 2));
  const stillShortlisted = apps.filter(a => a.currentStage === "SHORTLISTED");
  if (stillShortlisted.length > 0) {
    console.log("\nStill SHORTLISTED (not yet generated):");
    for (const a of stillShortlisted) console.log(`  - "${a.job.title}" / ${a.candidate.fullName}`);
  }
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
