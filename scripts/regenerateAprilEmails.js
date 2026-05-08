// @ts-check
/**
 * regenerateAprilEmails.js
 *
 * Finds all applications reset by resetAprilDrafts.js
 * (stage = SHORTLISTED, history entry "Reset — email regeneration") and
 * calls the /api/email/generate endpoint for each one.
 *
 * Run inside Docker container:
 *   docker exec -w /app <container> node /app/regenerateAprilEmails.js
 *   docker exec -w /app <container> node /app/regenerateAprilEmails.js --dry-run
 *
 * Flags:
 *   --dry-run   Lists applications that would be regenerated but calls nothing
 *   --batch N   Process N at a time (default: 3 concurrent)
 *   --delay N   Millisecond delay between batches (default: 1500)
 */

const HISTORY_MARKER = "Reset — email regeneration (April 11-12 batch)";
const API_BASE = "http://localhost:3000";
// tenantId cookie — must match the actual tenant all data belongs to
const COOKIES = "tenantId=dotcloudconsulting";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = (() => {
  const i = process.argv.indexOf("--batch");
  return i !== -1 ? parseInt(process.argv[i + 1], 10) || 1 : 1;
})();
const DELAY_MS = (() => {
  const i = process.argv.indexOf("--delay");
  return i !== -1 ? parseInt(process.argv[i + 1], 10) || 4000 : 4000;
})();

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateEmail({ applicationId, jobId, candidateId }) {
  const res = await fetch(`${API_BASE}/api/email/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: COOKIES,
    },
    body: JSON.stringify({ applicationId, jobId, candidateId }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { status: res.status, ok: res.ok, body: json };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(
    `Batch size: ${BATCH_SIZE} | Delay between batches: ${DELAY_MS}ms\n`,
  );

  // Find all applications that have the reset marker in their history
  const resetApplicationIds = await prisma.applicationStageHistory.findMany({
    where: { changedBy: HISTORY_MARKER },
    select: { applicationId: true },
    distinct: ["applicationId"],
  });

  if (resetApplicationIds.length === 0) {
    console.log("No reset applications found. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const appIds = resetApplicationIds.map((r) => r.applicationId);
  console.log(`Found ${appIds.length} reset application(s).\n`);

  // Load full application details
  const applications = await prisma.application.findMany({
    where: { id: { in: appIds } },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      currentStage: true,
      job: { select: { title: true, opportunityEmail: true } },
      candidate: { select: { fullName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log("Applications to regenerate:");
  for (const app of applications) {
    console.log(
      `  [${app.currentStage}] "${app.job.title}" → ${app.job.opportunityEmail ?? "(no email)"} | ${app.candidate.fullName}`,
    );
  }
  console.log();

  // Filter out any that are not at SHORTLISTED (e.g. someone moved them on)
  const eligible = applications.filter((a) => a.currentStage === "SHORTLISTED");
  const skipped = applications.filter((a) => a.currentStage !== "SHORTLISTED");

  if (skipped.length > 0) {
    console.log(
      `Skipping ${skipped.length} application(s) not at SHORTLISTED:`,
    );
    for (const app of skipped) {
      console.log(
        `  [${app.currentStage}] ${app.id} — "${app.job.title}" / ${app.candidate.fullName}`,
      );
    }
    console.log();
  }

  console.log(`Eligible for regeneration: ${eligible.length}\n`);

  if (DRY_RUN) {
    console.log("Dry run complete. Re-run without --dry-run to generate.");
    await prisma.$disconnect();
    return;
  }

  // ── Process in batches ────────────────────────────────────────────────────
  let succeeded = 0;
  let failed = 0;
  let skippedByApi = 0;
  const failures = [];

  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(eligible.length / BATCH_SIZE);
    process.stdout.write(
      `\rBatch ${batchNum}/${totalBatches} — processing ${batch.length} item(s)...`,
    );

    const results = await Promise.all(
      batch.map(async (app) => {
        try {
          const result = await generateEmail({
            applicationId: app.id,
            jobId: app.jobId,
            candidateId: app.candidateId,
          });
          return { app, result };
        } catch (err) {
          return { app, error: err.message };
        }
      }),
    );

    for (const { app, result, error } of results) {
      if (error) {
        failed++;
        failures.push({ app, reason: `fetch error: ${error}` });
        continue;
      }

      const label = `"${app.job.title}" / ${app.candidate.fullName}`;

      if (result.ok) {
        if (result.body?.skipped) {
          skippedByApi++;
          console.log(
            `\n  SKIP  ${label} — ${result.body.reason ?? "no_opportunity_email"}`,
          );
        } else if (result.body?.cached || result.body?.deduplicated) {
          // Cached draft returned — counts as success
          succeeded++;
        } else {
          succeeded++;
        }
      } else {
        failed++;
        const errMsg =
          typeof result.body?.error === "string"
            ? result.body.error
            : (result.body?.error?.message ?? null);
        const hint =
          typeof result.body?.hint === "string" ? result.body.hint : null;
        const roleGuard = result.body?.roleGuard
          ? `suggestedRoles="${result.body.roleGuard.suggestedRoles}" job="${result.body.roleGuard.jobTitle}"`
          : null;
        const detail =
          [errMsg, hint, roleGuard].filter(Boolean).join(" | ").slice(0, 250) ||
          JSON.stringify(result.body).slice(0, 250);
        failures.push({ app, reason: `HTTP ${result.status}: ${detail}` });
        console.log(`\n  FAIL  ${label} — HTTP ${result.status}: ${detail}`);
      }
    }

    if (i + BATCH_SIZE < eligible.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log("\n\n=== Complete ===");
  console.log(`  Generated:    ${succeeded}`);
  console.log(`  Skipped (API): ${skippedByApi} (no opportunity email)`);
  console.log(`  Failed:        ${failed}`);

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const { app, reason } of failures) {
      console.log(
        `  - "${app.job.title}" / ${app.candidate.fullName}: ${reason}`,
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("\nFatal error:", err.message);
  await prisma.$disconnect();
  process.exit(1);
});
