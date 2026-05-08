const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const app = await p.application.findFirst({
    where: { currentStage: "SHORTLISTED", emails: { none: {} }, job: { createdAt: { gte: new Date("2026-04-25") }, isRemote: true, requiresUsWorkAuth: null } },
    select: { id: true, jobId: true, candidateId: true, job: { select: { title: true } }, candidate: { select: { fullName: true } } },
  });
  if (!app) { console.log("No eligible app"); await p.$disconnect(); return; }
  console.log("Testing:", app.id, app.job.title, app.candidate.fullName);
  const start = Date.now();
  const res = await fetch("http://localhost:3000/api/email/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "tenantId=dotcloudconsulting" },
    body: JSON.stringify({ applicationId: app.id, jobId: app.jobId, candidateId: app.candidateId }),
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
    } else {
      console.log("Error:", data.error?.message);
      if (data.error?.details) console.log("Details:", JSON.stringify(data.error?.details).slice(0, 300));
    }
  } catch(e) { console.log("Raw:", text.slice(0, 500)); }
  await p.$disconnect();
}
main().catch(e => console.error(e));
