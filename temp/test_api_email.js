const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Find a SHORTLISTED app without drafts where the job IS remote and no US auth
  const app = await p.application.findFirst({
    where: { currentStage: "SHORTLISTED", emails: { none: {} }, job: { isRemote: true, requiresUsWorkAuth: { not: true } } },
    select: { id: true, jobId: true, candidateId: true, job: { select: { title: true, isRemote: true } }, candidate: { select: { fullName: true } } }
  });
  if (!app) {
    console.log("No eligible remote SHORTLISTED app found");
    await p.$disconnect();
    return;
  }
  console.log("Testing with:", app.id, app.job.title, app.candidate.fullName, "isRemote:", app.job.isRemote);
  const start = Date.now();
  const res = await fetch("http://localhost:3000/api/email/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "tenantId=dotcloudconsulting" },
    body: JSON.stringify({ applicationId: app.id, jobId: app.jobId, candidateId: app.candidateId })
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("Status:", res.status, "Time:", elapsed + "s");
  const text = await res.text();
  console.log("Body:", text.slice(0, 1500));
  await p.$disconnect();
}
main().catch(e => console.error(e));
