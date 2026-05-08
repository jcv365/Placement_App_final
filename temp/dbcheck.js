const { PrismaClient } = require("@prisma/client");
const HISTORY_MARKER = "Reset — email regeneration (April 11-12 batch)";
const p = new PrismaClient();
async function main() {
  const entry = await p.applicationStageHistory.findFirst({ where: { changedBy: HISTORY_MARKER }, select: { applicationId: true } });
  if (!entry) { console.log("No reset apps found"); return; }
  const app = await p.application.findUnique({ where: { id: entry.applicationId }, select: { id: true, jobId: true, candidateId: true, currentStage: true } });
  console.log("App:", JSON.stringify(app));
  const job = await p.job.findUnique({ where: { id: app.jobId }, select: { id: true, tenantId: true, title: true } });
  console.log("Job:", JSON.stringify(job));
  const cand = await p.candidate.findUnique({ where: { id: app.candidateId }, select: { id: true, tenantId: true, fullName: true } });
  console.log("Candidate:", JSON.stringify(cand));
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
