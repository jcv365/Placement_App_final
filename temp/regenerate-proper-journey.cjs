const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();
const tenantId = "dotcloudconsulting";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const apps = await db.application.findMany({
    where: {
      tenantId,
      currentStage: "NEW",
      emails: { none: {} },
    },
    select: { id: true, jobId: true, candidateId: true },
    orderBy: { updatedAt: "asc" },
  });

  let attempted = 0;
  let success = 0;
  let failed = 0;
  let rateLimited = 0;
  let missingRecipient = 0;
  let invalidRecipient = 0;
  let aiFailed = 0;
  const failSamples = [];

  for (let i = 0; i < apps.length; i += 1) {
    const app = apps[i];
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

        const detailsMsg = payload?.error?.details?.outlookDraft?.reason;
        const msg = String(
          payload?.error?.message ||
            detailsMsg ||
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
      if (/No opportunity email/i.test(lastMsg)) {
        missingRecipient += 1;
      } else if (/invalid/i.test(lastMsg)) {
        invalidRecipient += 1;
      } else if (
        /AI email generation failed|LLMLITE|provider|model/i.test(lastMsg)
      ) {
        aiFailed += 1;
      }

      if (failSamples.length < 30) {
        failSamples.push({ applicationId: app.id, error: lastMsg });
      }
    }

    if ((i + 1) % 10 === 0) {
      console.log(
        `progress ${i + 1}/${apps.length} success=${success} failed=${failed}`,
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
        targetApplications: apps.length,
        attemptedRequests: attempted,
        success,
        failed,
        rateLimitedRetries: rateLimited,
        missingRecipient,
        invalidRecipient,
        aiFailed,
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
