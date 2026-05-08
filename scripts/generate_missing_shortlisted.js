// Generate email drafts for SHORTLISTED applications that have no EmailDrafts.
// Usage: node scripts/generate_missing_shortlisted.js --batch 3 --delay 3000
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");

// Load .env.local if present
const envFile = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

// simple argv parser (no external deps)
const rawArgs = process.argv.slice(2);
function getArg(name, short) {
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === `--${name}` && i + 1 < rawArgs.length) return rawArgs[i + 1];
    if (short && a === `-${short}` && i + 1 < rawArgs.length)
      return rawArgs[i + 1];
    if (a.startsWith(`--${name}=`)) return a.split("=")[1];
    if (short && a.startsWith(`-${short}=`)) return a.split("=")[1];
  }
  return undefined;
}

const batch = parseInt(getArg("batch", "b") || "3", 10);
const delay = parseInt(getArg("delay", "d") || "3000", 10);
const API = getArg("api") || "http://localhost:3000/api/email/generate";
const maxAttempts = parseInt(getArg("max-attempts", "m") || "1", 10);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    console.log(
      `\nAttempt ${attempt}/${maxAttempts}: querying missing SHORTLISTED applications...`,
    );

    const apps = await prisma.application.findMany({
      where: { currentStage: "SHORTLISTED", emails: { none: {} } },
      select: {
        id: true,
        jobId: true,
        candidateId: true,
        job: { select: { title: true } },
        candidate: { select: { fullName: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    console.log(`Found ${apps.length} missing SHORTLISTED applications`);
    if (apps.length === 0) break;

    let attemptSucceeded = 0;
    let attemptFailed = 0;

    for (let i = 0; i < apps.length; i++) {
      const a = apps[i];
      console.log(
        `Processing ${i + 1}/${apps.length}: ${a.id} | ${a.job.title} / ${a.candidate.fullName}`,
      );
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "tenantId=dotcloudconsulting",
          },
          body: JSON.stringify({
            applicationId: a.id,
            jobId: a.jobId,
            candidateId: a.candidateId,
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          console.error(`  -> FAIL status=${res.status} body=${text}`);
          attemptFailed++;
        } else {
          console.log(`  -> OK`);
          attemptSucceeded++;
        }
      } catch (err) {
        console.error("  -> ERROR", err.message);
        attemptFailed++;
      }

      if ((i + 1) % batch === 0 && i + 1 < apps.length) {
        console.log(`Pausing ${delay}ms before next batch...`);
        await sleep(delay);
      } else {
        await sleep(250);
      }
    }

    totalProcessed += apps.length;
    totalSucceeded += attemptSucceeded;
    totalFailed += attemptFailed;

    console.log(
      `Attempt ${attempt} summary: processed=${apps.length} succeeded=${attemptSucceeded} failed=${attemptFailed}`,
    );

    if (attemptSucceeded === 0) {
      console.log("No successful generations this pass — stopping retries.");
      break;
    }

    if (attempt < maxAttempts) await sleep(2000);
  }

  console.log(
    `\nFinal summary: totalProcessed=${totalProcessed} totalSucceeded=${totalSucceeded} totalFailed=${totalFailed}`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal:", err && err.message ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
