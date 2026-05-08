const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Find a job with an opportunity email (eligible for match review)
  const jobs = await p.job.findMany({
    where: { tenantId: "dotcloudconsulting", opportunityEmail: { not: null } },
    select: { id: true, title: true, opportunityEmail: true },
    take: 3
  });
  if (jobs.length === 0) { console.log("No jobs with opportunityEmail found"); await p.$disconnect(); return; }
  console.log("Jobs available for match review:", jobs.length);
  const job = jobs[0];
  console.log("Testing with job:", job.id, job.title);
  
  const start = Date.now();
  const res = await fetch(`http://localhost:3000/api/match/score?jobId=${job.id}`, {
    headers: { Cookie: "tenantId=dotcloudconsulting" }
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("Status:", res.status, "Time:", elapsed + "s");
  const data = await res.json();
  if (data.ok) {
    console.log("Candidates returned:", data.data?.candidates?.length || 0);
    console.log("Cached:", data.data?.cached || false);
    if (data.data?.candidates?.length > 0) {
      data.data.candidates.slice(0, 3).forEach(c => {
        console.log(`  - ${c.fullName}: score=${c.aiScore}, rationale="${c.rationale?.slice(0, 80)}"`);
      });
    }
  } else {
    console.log("Error:", data.error?.message);
  }
  await p.$disconnect();
}
main().catch(e => console.error(e));
