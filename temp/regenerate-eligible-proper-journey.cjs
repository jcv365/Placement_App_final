const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();
const tenantId = "dotcloudconsulting";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || "").trim());
}

async function main() {
  const apps = await db.application.findMany({
    where: {
      tenantId,
      currentStage: "NEW",
      emails: { none: {} },
    },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: { select: { opportunityEmail: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  const eligible = apps.filter((app) =>
    isValidEmail(app.job?.opportunityEmail || ""),
  );

  let attempted = 0;
  let success = 0;
  let failed = 0;
  let rateLimited = 0;
  const failSamples = [];

  for (let i = 0; i < eligible.length; i += 1) {
    const app = eligible[i];
    let ok = false;
    let lastMsg = "";

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      attempted += 1;

      try {
        const res = await fetch("http://127.0.0.1:3000/api/email/generate", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `tenantId=${tenantId}`,
          },
          body: JSON.stringify({
            applicationId: app.id,
            jobId: app.jobId,
            candidateId: app.candidateId,
            aiProvider: "auto",
          }),
        });

        const txt = await res.text();
        let payload;
        try {
          payload = JSON.parse(txt);
        } catch {
          payload = { raw: txt };
        }

        if (res.ok) {
          ok = true;
          success += 1;
          break;
        }

        const msg = String(
          payload?.error?.message ||
            payload?.error?.details?.message ||
            payload?.raw ||
            `HTTP ${res.status}`,
        );
        lastMsg = msg;

        if (
          /rate.?limit|429|No deployments available|temporarily unavailable/i.test(
            msg,
          )
        ) {
          rateLimited += 1;
          await sleep(1000 * attempt);
          continue;
        }

        break;
      } catch (error) {
        lastMsg = String(error?.message || error);
        await sleep(500 * attempt);
      }
    }

    if (!ok) {
      failed += 1;
      if (failSamples.length < 25) {
        failSamples.push({ applicationId: app.id, error: lastMsg });
      }
    }

    if ((i + 1) % 10 === 0) {
      console.log(
        `progress ${i + 1}/${eligible.length} success=${success} failed=${failed}`,
      );
    }

    await sleep(150);
  }

  const [drafts, emailDrafted, newStage] = await Promise.all([
    db.emailDraft.count({ where: { tenantId } }),
    db.application.count({
      where: { tenantId, currentStage: "EMAIL_DRAFTED" },
    }),
    db.application.count({ where: { tenantId, currentStage: "NEW" } }),
  ]);

  console.log(
    JSON.stringify(
      {
        tenantId,
        targetUndraftedNew: apps.length,
        eligibleWithRecipient: eligible.length,
        attemptedRequests: attempted,
        success,
        failed,
        rateLimitedRetries: rateLimited,
        totalDrafts: drafts,
        emailDraftedStage: emailDrafted,
        newStage,
        failSamples,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
