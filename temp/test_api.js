const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Find a SHORTLISTED app without drafts, job created after 25 April, remote, no US auth
  const app = await p.application.findFirst({
    where: {
      currentStage: "SHORTLISTED",
      emails: { none: {} },
      job: {
        createdAt: { gte: new Date("2026-04-25") },
        isRemote: true,
        requiresUsWorkAuth: { not: true },
      },
    },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: { select: { title: true, isRemote: true, requiresUsWorkAuth: true, createdAt: true } },
      candidate: { select: { fullName: true } },
    },
  });
  if (!app) {
    console.log("No eligible app found");
    // Try without date filter
    const anyApp = await p.application.findFirst({
      where: {
        currentStage: "SHORTLISTED",
        emails: { none: {} },
        job: { isRemote: true, requiresUsWorkAuth: { not: true } },
      },
      select: {
        id: true,
        jobId: true,
        candidateId: true,
        job: { select: { title: true, isRemote: true, requiresUsWorkAuth: true, createdAt: true } },
        candidate: { select: { fullName: true } },
      },
    });
    if (!anyApp) {
      console.log("No eligible app found at all");
      await p.$disconnect();
      return;
    }
    console.log("Using app without date filter:", anyApp.id, anyApp.job.title, anyApp.candidate.fullName, "jobCreated:", anyApp.job.createdAt.toISOString());
    await testApi(anyApp);
  } else {
    console.log("Using app:", app.id, app.job.title, app.candidate.fullName, "jobCreated:", app.job.createdAt.toISOString());
    await testApi(app);
  }
  await p.$disconnect();
}

async function testApi(app) {
  console.log("Calling /api/email/generate...");
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
      console.log("Error:", data.error?.message || data.error);
      if (data.error?.details) console.log("Details:", JSON.stringify(data.error.details));
    }
  } catch(e) {
    console.log("Raw body:", text.slice(0, 500));
  }
}
main().catch(e => console.error(e));
