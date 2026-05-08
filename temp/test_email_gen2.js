const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Find a SHORTLISTED app without drafts where the job IS remote
  const apps = await p.application.findMany({
    where: { currentStage: "SHORTLISTED", emails: { none: {} } },
    select: { id: true, jobId: true, candidateId: true, job: { select: { title: true, isRemote: true, requiresUsWorkAuth: true } }, candidate: { select: { fullName: true } } },
    take: 50
  });
  
  // Find one that is remote and doesn't require US auth
  const remote = apps.find(a => a.job.isRemote === true && a.job.requiresUsWorkAuth !== true);
  if (!remote) {
    console.log("No remote SHORTLISTED app without drafts found in first 50");
    // Try without isRemote filter
    const anyApp = apps.find(a => a.job.requiresUsWorkAuth !== true);
    if (anyApp) {
      console.log("Trying:", anyApp.id, anyApp.job.title, anyApp.candidate.fullName, "isRemote:", anyApp.job.isRemote);
      const res = await fetch("http://localhost:3000/api/email/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "tenantId=dotcloudconsulting" },
        body: JSON.stringify({ applicationId: anyApp.id, jobId: anyApp.jobId, candidateId: anyApp.candidateId })
      });
      console.log("Status:", res.status);
      const text = await res.text();
      console.log("Body:", text.slice(0, 1000));
    }
  } else {
    console.log("Testing with:", remote.id, remote.job.title, remote.candidate.fullName, "isRemote:", remote.job.isRemote);
    const res = await fetch("http://localhost:3000/api/email/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "tenantId=dotcloudconsulting" },
      body: JSON.stringify({ applicationId: remote.id, jobId: remote.jobId, candidateId: remote.candidateId })
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Body:", text.slice(0, 1000));
  }
  await p.$disconnect();
}
main().catch(e => console.error(e));
