const { PrismaClient } = require("@prisma/client");
// Use global fetch available in Node 18+
const fetch = global.fetch;
const p = new PrismaClient();

async function main() {
  const appId = process.argv[2];
  if (!appId) {
    console.error("Usage: node regen_application_email.js <applicationId>");
    process.exit(2);
  }
  const app = await p.application.findUnique({
    where: { id: appId },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: { select: { title: true } },
      candidate: { select: { fullName: true, email: true } },
    },
  });
  if (!app) {
    console.error("Application not found:", appId);
    process.exit(3);
  }
  console.log(
    "Found application:",
    app.id,
    app.jobId,
    app.candidateId,
    app.job?.title,
    app.candidate?.fullName,
  );

  const api = process.env.API || "http://localhost:3000/api/email/generate";
  console.log("Using API:", api);
  console.log("Global fetch available:", typeof fetch !== "undefined");
  try {
    const res = await fetch(api, {
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
    const text = await res.text();
    console.log("HTTP", res.status);
    console.log(text.slice(0, 4000));
  } catch (err) {
    console.error("Request error", err && err.message ? err.message : err);
  }
  await p.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
