const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const tenantId = "dotcloudconsulting";
  
  // Find a job with an opportunity email
  const jobs = await p.job.findMany({
    where: { tenantId, opportunityEmail: { not: null } },
    select: { id: true, title: true },
    take: 3
  });
  console.log("Jobs with opportunity email:", jobs.length);
  jobs.forEach(j => console.log("  -", j.id, j.title));
  
  if (jobs.length === 0) { await p.$disconnect(); return; }
  
  const job = jobs[0];
  console.log("\nTesting AI match for:", job.title);
  const start = Date.now();
  
  const res = await fetch(`http://localhost:3000/api/match/score?jobId=${job.id}&force=true`, {
    headers: { Cookie: "tenantId=dotcloudconsulting" }
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("Status:", res.status, "Time:", elapsed + "s");
  
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (data.ok) {
      console.log("Candidates returned:", data.data?.candidates?.length || 0);
      console.log("Cached:", data.data?.cached);
      if (data.data?.candidates?.length > 0) {
        data.data.candidates.forEach(c => {
          console.log(`  - ${c.fullName}: score=${c.aiScore} rationale="${c.rationale?.slice(0,80)}"`);
        });
      }
    } else {
      console.log("Error:", data.error?.message);
      if (data.error?.details) console.log("Details:", JSON.stringify(data.error?.details).slice(0, 500));
    }
  } catch(e) { console.log("Raw:", text.slice(0, 500)); }
  
  await p.$disconnect();
}
main().catch(e => console.error(e));
