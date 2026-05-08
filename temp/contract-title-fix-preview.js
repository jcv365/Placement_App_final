const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function normaliseContractTitle(input) {
  let t = clean(input);
  if (!/^contract\b/i.test(t)) return t;

  t = t.replace(/^contract\b/i, "Contract");
  t = t.replace(/\bir35\b/gi, "IR35");
  t = t.replace(/\buk\b/gi, "UK");
  t = t.replace(/\beu\b/gi, "EU");
  t = t.replace(/\bus\b/gi, "US");
  t = t.replace(/\bdevops\b/gi, "DevOps");
  t = t.replace(/\bai\b/gi, "AI");
  t = t.replace(/\baws\b/gi, "AWS");
  t = t.replace(/\bazure\b/gi, "Azure");

  return t;
}

(async () => {
  const start = new Date("2026-04-07T00:00:00.000Z");
  const end = new Date("2026-04-08T00:00:00.000Z");
  const tenantId = "dotcloudconsulting";

  const rows = await p.job.findMany({
    where: { tenantId, createdAt: { gte: start, lt: end } },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const candidates = rows
    .filter((r) => /^contract\b/i.test((r.title || "").trim()))
    .map((r) => {
      const next = normaliseContractTitle(r.title);
      return { ...r, next };
    })
    .filter((r) => r.next !== r.title);

  console.log("contractRowsToday", rows.filter((r) => /^contract\b/i.test((r.title || "").trim())).length);
  console.log("wouldUpdate", candidates.length);
  for (const c of candidates.slice(0, 60)) {
    console.log(JSON.stringify({ id: c.id, from: c.title, to: c.next, createdAt: c.createdAt.toISOString() }));
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
