const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const apps = await p.application.findMany({
    where: {
      currentStage: "SHORTLISTED",
      emails: { none: {} },
      job: {
        createdAt: { gte: new Date("2026-04-25") },
        isRemote: true,
        requiresUsWorkAuth: null,
      },
    },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: { select: { title: true } },
      candidate: { select: { fullName: true } },
    },
    take: 2,
  });

  if (!apps.length) {
    console.log("No eligible applications");
    await p.$disconnect();
    return;
  }

  const app = apps[0];
  console.log("Testing:", app.id, app.job.title, app.candidate.fullName);
  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout

  try {
    const res = await fetch("http://localhost:3000/api/email/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "tenantId=dotcloudconsulting",
      },
      body: JSON.stringify({
        applicationId: app.id,
        jobId: app.jobId,
        candidateId: app.candidateId,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
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
        if (data.error?.details)
          console.log(
            "Details:",
            JSON.stringify(data.error?.details).slice(0, 500),
          );
      }
    } catch (e) {
      console.log("Raw:", text.slice(0, 500));
    }
  } catch (e) {
    clearTimeout(timeout);
    console.log("Fetch error:", e.message);
  }
  await p.$disconnect();
}
main().catch((e) => console.error(e));
