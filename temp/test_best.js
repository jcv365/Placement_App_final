const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Find SHORTLISTED applications without emails, remote, no US work auth, with good JD/CV data
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
      atsScore: true,
      job: {
        select: {
          title: true,
          rawText: true,
          isRemote: true,
          requiresUsWorkAuth: true,
        },
      },
      candidate: { select: { fullName: true, rawCV: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log(
    `Found ${apps.length} eligible applications (sorted by ATS score desc):`,
  );
  for (const app of apps) {
    const hasJD = app.job.rawText && app.job.rawText.length > 50;
    const hasCV = app.candidate.rawCV && app.candidate.rawCV.length > 50;
    console.log(
      `ATS:${app.atsScore} | ${app.id} | ${app.job.title} | ${app.candidate.fullName} | JD:${hasJD ? app.job.rawText.length : "NONE"} | CV:${hasCV ? app.candidate.rawCV.length : "NONE"}`,
    );
  }

  // Pick the best one
  const good = apps.find(
    (a) =>
      a.job.title &&
      a.job.title.length > 3 &&
      a.candidate.fullName &&
      a.candidate.fullName.length > 2 &&
      a.job.rawText &&
      a.job.rawText.length > 50 &&
      a.candidate.rawCV &&
      a.candidate.rawCV.length > 50 &&
      (a.atsScore === null || a.atsScore >= 60),
  );

  if (!good) {
    console.log(
      "\nNo well-matched application found. Trying first with good data...",
    );
    const fallback = apps.find(
      (a) =>
        a.job.rawText &&
        a.job.rawText.length > 50 &&
        a.candidate.rawCV &&
        a.candidate.rawCV.length > 50,
    );
    if (!fallback) {
      console.log("None found at all");
      await p.$disconnect();
      return;
    }
    console.log(
      "\nUsing fallback:",
      fallback.id,
      fallback.job.title,
      fallback.candidate.fullName,
      "ATS:",
      fallback.atsScore,
    );
    await testEmail(fallback);
  } else {
    console.log(
      "\nBest match:",
      good.id,
      good.job.title,
      good.candidate.fullName,
      "ATS:",
      good.atsScore,
    );
    await testEmail(good);
  }

  await p.$disconnect();
}

async function testEmail(app) {
  const start = Date.now();
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
  } catch (e) {
    console.log("Fetch error:", e.message);
  }
}

main().catch((e) => console.error(e));
