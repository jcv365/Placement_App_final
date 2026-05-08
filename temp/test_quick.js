const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const app = await p.application.findFirst({
    where: { currentStage: "SHORTLISTED", emails: { none: {} }, job: { createdAt: { gte: new Date("2026-04-25") }, isRemote: true, requiresUsWorkAuth: null } },
    select: { id: true, jobId: true, candidateId: true },
  });
  if (!app) { console.log("No app"); await p.$disconnect(); return; }
  console.log("App:", app.id);
  const res = await fetch("http://localhost:3000/api/email/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "tenantId=dotcloudconsulting" },
    body: JSON.stringify({ applicationId: app.id, jobId: app.jobId, candidateId: app.candidateId }),
  });
  console.log("Status:", res.status);
  await p.$disconnect();
}
main();
