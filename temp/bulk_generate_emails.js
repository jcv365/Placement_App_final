const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const CONCURRENCY = 3;
const DELAY_BETWEEN_BATCHES_MS = 2000;
const MAX_RETRIES = 2;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateEmail(app, retryCount = 0) {
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
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (data.ok) {
        console.log(
          `[OK] ${app.candidate.fullName} -> ${app.job.title} (${elapsed}s) subject: ${data.data?.subject}`,
        );
        return { status: "ok", app, elapsed };
      } else {
        const errMsg = data.error?.message || "Unknown error";
        const hint = data.error?.details?.hint || "";
        console.log(
          `[ERR ${res.status}] ${app.candidate.fullName} -> ${app.job.title}: ${errMsg} ${hint}`,
        );
        // Retry on rate limit or gateway timeout
        if (
          (res.status === 429 || res.status === 502 || res.status === 503) &&
          retryCount < MAX_RETRIES
        ) {
          console.log(`  Retrying (${retryCount + 1}/${MAX_RETRIES})...`);
          await sleep(5000 * (retryCount + 1));
          return generateEmail(app, retryCount + 1);
        }
        return { status: "error", app, error: errMsg };
      }
    } catch (e) {
      console.log(
        `[PARSE ERR] ${app.candidate.fullName} -> ${app.job.title}: ${text.slice(0, 200)}`,
      );
      return { status: "error", app, error: "Parse error" };
    }
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `[FETCH ERR] ${app.candidate.fullName} -> ${app.job.title}: ${e.message} (${elapsed}s)`,
    );
    if (retryCount < MAX_RETRIES) {
      console.log(`  Retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await sleep(5000 * (retryCount + 1));
      return generateEmail(app, retryCount + 1);
    }
    return { status: "error", app, error: e.message };
  }
}

async function main() {
  const apps = await p.application.findMany({
    where: { currentStage: "SHORTLISTED", emails: { none: {} } },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: {
        select: {
          title: true,
          isRemote: true,
          requiresUsWorkAuth: true,
          opportunityEmail: true,
        },
      },
      candidate: { select: { fullName: true } },
    },
    take: 500,
  });

  const eligible = apps.filter(
    (a) =>
      a.job.opportunityEmail &&
      a.job.isRemote !== false &&
      a.job.requiresUsWorkAuth !== true,
  );

  console.log(
    `Found ${eligible.length} eligible applications out of ${apps.length} SHORTLISTED without drafts`,
  );
  console.log(
    `Processing with concurrency=${CONCURRENCY}, delay=${DELAY_BETWEEN_BATCHES_MS}ms`,
  );

  let ok = 0;
  let err = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const batch = eligible.slice(i, i + CONCURRENCY);
    console.log(
      `\n--- Batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(eligible.length / CONCURRENCY)} ---`,
    );

    const results = await Promise.all(batch.map((app) => generateEmail(app)));

    for (const result of results) {
      if (result.status === "ok") ok++;
      else {
        err++;
        errors.push({
          candidate: result.app.candidate.fullName,
          job: result.app.job.title,
          error: result.error,
        });
      }
    }

    if (i + CONCURRENCY < eligible.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Successful: ${ok}`);
  console.log(`Failed: ${err}`);
  console.log(`Total: ${eligible.length}`);
  if (errors.length > 0) {
    console.log(`\nFailed details:`);
    errors.forEach((e) =>
      console.log(`  - ${e.candidate} -> ${e.job}: ${e.error}`),
    );
  }

  await p.$disconnect();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
