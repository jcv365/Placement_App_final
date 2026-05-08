const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Find a SHORTLISTED app without drafts where the job IS remote
  const apps = await p.application.findMany({
    where: { currentStage: "SHORTLISTED", emails: { none: {} } },
    select: { id: true, jobId: true, candidateId: true, job: { select: { title: true, isRemote: true, requiresUsWorkAuth: true, opportunityEmail: true } }, candidate: { select: { fullName: true } } },
    take: 50
  });
  
  // Find one that is remote and doesn't require US auth and has an opportunity email
  const eligible = apps.filter(a => a.job.opportunityEmail && a.job.isRemote !== false && a.job.requiresUsWorkAuth !== true);
  if (eligible.length === 0) {
    console.log("No eligible SHORTLISTED apps without drafts found in first 50");
    console.log("Total apps checked:", apps.length);
    apps.slice(0, 5).forEach(a => console.log("  -", a.job.title, "remote:", a.job.isRemote, "usAuth:", a.job.requiresUsWorkAuth, "email:", a.job.opportunityEmail ? "yes" : "no"));
    await p.$disconnect();
    return;
  }
  
  const app = eligible[0];
  console.log("Testing with:", app.id, app.job.title, app.candidate.fullName);
  console.log("Opportunity email:", app.job.opportunityEmail);
  const start = Date.now();
  const res = await fetch("http://localhost:3000/api/email/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "tenantId=dotcloudconsulting" },
    body: JSON.stringify({ applicationId: app.id, jobId: app.jobId, candidateId: app.candidateId })
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("Status:", res.status, "Time:", elapsed + "s");
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (data.ok) {
      console.log("SUCCESS! Subject:", data.data?.subject);
      console.log("HTML length:", (data.data?.htmlBody || "").length);
      console.log("Outlook draft:", JSON.stringify(data.data?.outlookDraft));
      console.log("Deduplicated:", data.data?.deduplicated);
      console.log("Stage updated:", data.data?.stageUpdated);
    } else {
      console.log("Error:", data.error?.message);
      if (data.error?.details) console.log("Details:", JSON.stringify(data.error?.details).slice(0, 500));
    }
  } catch(e) { console.log("Raw:", text.slice(0, 500)); }
  await p.$disconnect();
}
main().catch(e => console.error(e));
