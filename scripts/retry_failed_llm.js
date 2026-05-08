// Retry only LLM-failed application generations (HTTP 502 / fetch failed)
// Usage (inside container): node scripts/retry_failed_llm.js --batch 1 --delay 10000
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Known LLM/fetch failed application IDs from last run
const FAILED_IDS = [
  "cmo8s96nq0067qf9gvj3hvg2o",
  "cmo8s96pe007dqf9g95jm1fr2",
  "cmo8s96pz007vqf9g4pi7knfv",
  "cmo8s96v200bmqf9geffnhcwv",
  "cmo8s96vb00bsqf9gw3lw8les",
  "cmo8s96vg00bvqf9gyb34pps0",
  "cmo8s96vx00c7qf9ggae030hs",
  "cmo8s974300i7qf9gm63tu3sh",
  "cmo8s975000iyqf9g44arta2k",
];

const API_BASE = "http://localhost:3000";
const COOKIES = "tenantId=dotcloudconsulting";

const BATCH_SIZE = (() => {
  const i = process.argv.indexOf("--batch");
  return i !== -1 ? parseInt(process.argv[i + 1], 10) || 1 : 1;
})();
const DELAY_MS = (() => {
  const i = process.argv.indexOf("--delay");
  return i !== -1 ? parseInt(process.argv[i + 1], 10) || 10000 : 10000;
})();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function generateEmail(applicationId, jobId, candidateId) {
  const res = await fetch(`${API_BASE}/api/email/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: COOKIES },
    body: JSON.stringify({ applicationId, jobId, candidateId }),
    timeout: 60000,
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

async function main() {
  console.log(
    `Retrying ${FAILED_IDS.length} applications | batch=${BATCH_SIZE} delay=${DELAY_MS}ms`,
  );

  // Fetch application details
  const apps = await prisma.application.findMany({
    where: { id: { in: FAILED_IDS } },
    select: { id: true, jobId: true, candidateId: true },
  });
  const appsMap = new Map(apps.map((a) => [a.id, a]));

  const toProcess = FAILED_IDS.filter((id) => appsMap.has(id));

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    console.log(
      `Processing batch ${Math.floor(i / BATCH_SIZE) + 1} — ${batch.length} apps`,
    );

    const results = await Promise.all(
      batch.map(async (appId) => {
        const { jobId, candidateId } = appsMap.get(appId);
        try {
          const res = await generateEmail(appId, jobId, candidateId);
          return { appId, res };
        } catch (err) {
          return { appId, error: err.message };
        }
      }),
    );

    for (const r of results) {
      if (r.error) {
        failed++;
        console.log(`  FAIL ${r.appId} — fetch error: ${r.error}`);
        continue;
      }
      const { res } = r;
      if (res.ok) {
        succeeded++;
        console.log(`  OK   ${r.appId}`);
      } else {
        failed++;
        console.log(
          `  FAIL ${r.appId} — HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`,
        );
      }
    }

    if (i + BATCH_SIZE < toProcess.length) await sleep(DELAY_MS);
  }

  console.log(`\nSummary: succeeded=${succeeded} failed=${failed}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err.message);
  await prisma.$disconnect();
  process.exit(1);
});
