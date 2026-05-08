const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const apps = await p.application.findMany({
    where: {
      currentStage: "SHORTLISTED",
      emails: { none: {} },
      job: { createdAt: { gte: new Date("2026-04-25") } },
    },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: { select: { title: true, rawText: true } },
      candidate: { select: { fullName: true, rawCV: true } },
    },
    take: 5,
  });

  console.log(`Found ${apps.length} eligible applications`);
  for (const app of apps) {
    const hasTitle = app.job.title && app.job.title.length > 3;
    const hasName = app.candidate.fullName && app.candidate.fullName.length > 2;
    const hasJD = app.job.rawText && app.job.rawText.length > 50;
    const hasCV = app.candidate.rawCV && app.candidate.rawCV.length > 50;
    console.log(
      `${app.id} | ${app.job.title} | ${app.candidate.fullName} | JD:${hasJD ? app.job.rawText.length : "NONE"} | CV:${hasCV ? app.candidate.rawCV.length : "NONE"} | title:${hasTitle} | name:${hasName}`,
    );
  }

  const good = apps.find(
    (a) =>
      a.job.title &&
      a.job.title.length > 3 &&
      a.candidate.fullName &&
      a.candidate.fullName.length > 2 &&
      a.job.rawText &&
      a.job.rawText.length > 50 &&
      a.candidate.rawCV &&
      a.candidate.rawCV.length > 50,
  );

  if (!good) {
    console.log("No application with sufficient data found");
    await p.$disconnect();
    return;
  }

  console.log("\nTesting:", good.id, good.job.title, good.candidate.fullName);
  const start = Date.now();
  const res = await fetch("http://localhost:3000/api/email/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "tenantId=dotcloudconsulting",
    },
    body: JSON.stringify({
      applicationId: good.id,
      jobId: good.jobId,
      candidateId: good.candidateId,
    }),
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
      if (data.error?.details)
        console.log(
          "Details:",
          JSON.stringify(data.error?.details).slice(0, 500),
        );
    }
  } catch (e) {
    console.log("Raw:", text.slice(0, 500));
  }
  await p.$disconnect();
}
main().catch((e) => console.error(e));
