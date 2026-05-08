const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const jobId = "cmmxp4bcr0003v6q84xo61u8u";
  const tenantId = "dotcloudconsulting";
  
  // Count active candidates
  const activeCount = await p.candidate.count({ where: { tenantId, isActive: true } });
  console.log("Active candidates:", activeCount);
  
  // Count existing applications for this job
  const existingApps = await p.application.findMany({ where: { tenantId, jobId }, select: { candidateId: true } });
  console.log("Existing applications for this job:", existingApps.length);
  
  // Check a few candidates' suggestedRolesCsv
  const sample = await p.candidate.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, fullName: true, suggestedRolesCsv: true, preferredRolesCsv: true },
    take: 5
  });
  sample.forEach(c => {
    console.log(`  ${c.fullName}: suggested="${c.suggestedRolesCsv?.slice(0,60)}" preferred="${c.preferredRolesCsv?.slice(0,60)}"`);
  });
  
  // Try a different job
  const jobs = await p.job.findMany({
    where: { tenantId, opportunityEmail: { not: null } },
    select: { id: true, title: true },
  });
  console.log("\nAll eligible jobs:");
  jobs.forEach(j => console.log(`  ${j.id}: ${j.title}`));
  
  // Try the match score with force=true on a different job
  if (jobs.length > 1) {
    const job2 = jobs[1];
    console.log("\nTrying job:", job2.id, job2.title);
    const res = await fetch(`http://localhost:3000/api/match/score?jobId=${job2.id}&force=true`, {
      headers: { Cookie: "tenantId=dotcloudconsulting" }
    });
    const data = await res.json();
    console.log("Status:", res.status);
    if (data.ok) {
      console.log("Candidates:", data.data?.candidates?.length || 0);
      if (data.data?.candidates?.length > 0) {
        data.data.candidates.forEach(c => console.log(`  - ${c.fullName}: score=${c.aiScore}`));
      }
    } else {
      console.log("Error:", data.error?.message);
    }
  }
  
  await p.$disconnect();
}
main().catch(e => console.error(e));
