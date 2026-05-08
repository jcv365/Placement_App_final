// Generate email drafts for SHORTLISTED applications whose job was created on or after a given date.
// Usage: node scripts/generate_emails_after_date.js --after 2026-04-25 --batch 3 --delay 3000 --max-attempts 2
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

const afterDate = getArg("after", "a") || "2026-04-25";
const afterDateObj = new Date(afterDate);
if (isNaN(afterDateObj.getTime())) {
  console.error(`Invalid --after date: ${afterDate}. Use YYYY-MM-DD format.`);
  process.exit(1);
}

const batch = parseInt(getArg("batch", "b") || "3", 10);
const delay = parseInt(getArg("delay", "d") || "3000", 10);
const API = getArg("api") || "http://localhost:3000/api/email/generate";
const maxAttempts = parseInt(getArg("max-attempts", "m") || "2", 10);
const dryRun = getArg("dry-run") === "true" || getArg("dry-run") === "1";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(
    `=== Email Generation for Jobs Created On/After ${afterDate} ===`,
  );
  console.log(
    `Config: batch=${batch} delay=${delay}ms maxAttempts=${maxAttempts} dryRun=${dryRun}`,
  );
  console.log();

  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    console.log(
      `\nAttempt ${attempt}/${maxAttempts}: querying SHORTLISTED applications (jobs from ${afterDate}) without drafts...`,
    );

    const apps = await prisma.application.findMany({
      where: {
        currentStage: "SHORTLISTED",
        emails: { none: {} },
        job: { createdAt: { gte: afterDateObj } },
      },
      select: {
        id: true,
        jobId: true,
        candidateId: true,
        createdAt: true,
        job: {
          select: {
            title: true,
            isRemote: true,
            requiresUsWorkAuth: true,
            createdAt: true,
          },
        },
        candidate: { select: { fullName: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    console.log(
      `Found ${apps.length} SHORTLISTED applications without drafts (jobs from ${afterDate})`,
    );
    if (apps.length === 0) {
      console.log("No more applications to process.");
      break;
    }

    // Log summary of what we're about to process
    const remoteCount = apps.filter((a) => a.job.isRemote === true).length;
    const usAuthCount = apps.filter(
      (a) => a.job.requiresUsWorkAuth === true,
    ).length;
    console.log(`  Remote roles: ${remoteCount}/${apps.length}`);
    console.log(
      `  US work auth required: ${usAuthCount}/${apps.length} (will be skipped by API)`,
    );

    if (dryRun) {
      console.log("\n[DRY RUN] Would process the following applications:");
      for (const a of apps) {
        console.log(
          `  ${a.id} | ${a.job.title} / ${a.candidate.fullName} | remote=${a.job.isRemote} usAuth=${a.job.requiresUsWorkAuth} | jobCreated=${a.job.createdAt.toISOString()}`,
        );
      }
      break;
    }

    let attemptSucceeded = 0;
    let attemptFailed = 0;
    let attemptSkipped = 0;

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

        if (res.status === 409) {
          // 409 = blocked by guard (non-remote, US auth, role mismatch) — expected skip
          console.log(`  -> SKIPPED (409): ${text.slice(0, 120)}`);
          attemptSkipped++;
        } else if (!res.ok) {
          console.error(
            `  -> FAIL status=${res.status} body=${text.slice(0, 200)}`,
          );
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
    totalSkipped += attemptSkipped;

    console.log(
      `Attempt ${attempt} summary: processed=${apps.length} succeeded=${attemptSucceeded} failed=${attemptFailed} skipped=${attemptSkipped}`,
    );

    if (attemptSucceeded === 0 && attemptSkipped === 0) {
      console.log(
        "No successful generations and no skips this pass — stopping retries.",
      );
      break;
    }

    if (attempt < maxAttempts) {
      console.log("Waiting 5s before retry pass...");
      await sleep(5000);
    }
  }

  console.log(
    `\n=== Final summary ===\n` +
      `Total processed: ${totalProcessed}\n` +
      `Succeeded:        ${totalSucceeded}\n` +
      `Failed:           ${totalFailed}\n` +
      `Skipped (409):    ${totalSkipped}`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal:", err && err.message ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
