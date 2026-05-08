const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const TOKENS = new Set([
  "contract",
  "contracts",
  "remote",
  "hybrid",
  "onsite",
  "outside",
  "inside",
  "ir35",
  "outsideir35",
  "insideir35",
  "uk",
  "eu",
  "europe",
  "us",
  "usa",
  "india",
  "only",
]);

function sanitiseRoleTitle(value) {
  const cleaned = String(value || "")
    .replace(/[()\[\],]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const kept = cleaned
    .split(" ")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !TOKENS.has(p.toLowerCase()));

  const title = kept.join(" ").replace(/\s+/g, " ").trim();
  return title || cleaned;
}

(async () => {
  const start = new Date("2026-04-07T00:00:00.000Z");
  const end = new Date("2026-04-08T00:00:00.000Z");
  const tenantId = process.env.TARGET_TENANT_ID || "default";

  const jobs = await p.job.findMany({
    where: { tenantId, createdAt: { gte: start, lt: end } },
    select: { id: true, title: true },
  });

  let updated = 0;
  const samples = [];

  for (const job of jobs) {
    const next = sanitiseRoleTitle(job.title);
    if (!next || next === job.title) continue;

    await p.job.update({ where: { id: job.id }, data: { title: next } });
    updated += 1;

    if (samples.length < 20) {
      samples.push({ id: job.id, from: job.title, to: next });
    }
  }

  console.log("updatedTitles", updated);
  for (const s of samples) console.log(JSON.stringify(s));

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
