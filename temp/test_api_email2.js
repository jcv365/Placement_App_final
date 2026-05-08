const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Check what SHORTLISTED apps without drafts look like
  const apps = await p.application.findMany({
    where: { currentStage: "SHORTLISTED", emails: { none: {} } },
    select: { id: true, jobId: true, candidateId: true, job: { select: { title: true, isRemote: true, requiresUsWorkAuth: true } }, candidate: { select: { fullName: true } } },
    take: 10
  });
  console.log("Found", apps.length, "SHORTLISTED apps without drafts (first 10):");
  for (const a of apps) {
    console.log(a.id, a.job.title, "remote:", a.job.isRemote, "usAuth:", a.job.requiresUsWorkAuth, a.candidate.fullName);
  }
  // Try one that is NOT requiring US auth (regardless of remote)
  const eligible = apps.find(a => a.job.requiresUsWorkAuth !== true);
  if (!eligible) {
    console.log("No eligible app found (all require US auth)");
    await p.$disconnect();
    return;
  }
  console.log("\nTesting with:", eligible.id, eligible.job.title, eligible.candidate.fullName, "isRemote:", eligible.job.isRemote);
  const start = Date.now();
  const res = await fetch("http://localhost:3000/api/email/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "tenantId=dotcloudconsulting" },
    body: JSON.stringify({ applicationId: eligible.id, jobId: eligible.jobId, candidateId: eligible.candidateId })
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("Status:", res.status, "Time:", elapsed + "s");
  const text = await res.text();
  console.log("Body:", text.slice(0, 1500));
  await p.$disconnect();
}
main().catch(e => console.error(e));
