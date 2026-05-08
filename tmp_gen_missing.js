process.chdir("/app");
const crypto = require("crypto");
const { PrismaClient } = require("/app/node_modules/@prisma/client");
const prisma = new PrismaClient();

const APP_SESSION_SECRET = "DwNteqv6/xUwLc1LwbWzbHOSD8CWUdFCMHZzQ1oJ59Q=";

function signValue(value) {
  return crypto.createHmac("sha256", APP_SESSION_SECRET).update(value).digest("base64url");
}
function createToken(userId, tenantId) {
  const payload = { uid: userId, tid: tenantId, role: "ADMIN", exp: Date.now() + 24*60*60*1000 };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return encodedPayload + "." + signValue(encodedPayload);
}

async function main() {
  const user = await prisma.tenantUser.findFirst({
    where: { tenantId: "dotcloudconsulting", role: "ADMIN", isActive: true },
    select: { id: true, email: true }
  });
  if (!user) { console.error("No admin user found"); return; }
  console.log("Using user:", user.email, user.id);

  const token = createToken(user.id, "dotcloudconsulting");
  console.log("Token length:", token.length);

  const apps = await prisma.application.findMany({
    where: { currentStage: { in: ["EMAIL_DRAFTED","SHORTLISTED","NEW"] }, emails: { none: {} } },
    select: { id: true, jobId: true, candidateId: true, job: { select: { title: true, opportunityEmail: true } }, candidate: { select: { fullName: true } } }
  });
  console.log("Apps to generate:", apps.length);

  let done = 0, failed = 0;
  for (const app of apps) {
    try {
      const res = await fetch("http://localhost:3000/api/email/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `appSession=${token}` },
        body: JSON.stringify({ jobId: app.jobId, candidateId: app.candidateId, applicationId: app.id }),
        signal: AbortSignal.timeout(120000)
      });
      const text = await res.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (res.ok) {
        done++;
        console.log(`[OK] ${app.candidate.fullName} | ${app.job.title} => ${parsed?.data?.status ?? "ok"}`);
      } else {
        failed++;
        console.log(`[FAIL ${res.status}] ${app.candidate.fullName} | ${app.job.title} => ${parsed?.error?.message ?? text.slice(0,200)}`);
      }
    } catch (err) {
      failed++;
      console.log(`[ERR] ${app.candidate.fullName} | ${app.job.title} => ${err.message}`);
    }
  }
  console.log(`\nResult: ${done}/${apps.length} OK, ${failed} failed`);
}
main().then(() => prisma.$disconnect()).catch(e => { console.error("FATAL:", e.message); prisma.$disconnect(); });
