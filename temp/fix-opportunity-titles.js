const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const BAD_TITLE_PATTERNS = [
  /feed post/i,
  /founder\s*@/i,
  /lunchtime leads/i,
  /^#?informationtechnology/i,
  /\bvisit my services\b/i,
  /\bremote locations\b/i,
  /^north america$/i,
  /^egypt$/i,
  /^india$/i,
  /^delhi$/i,
  /^mumbai$/i,
  /^pune$/i,
  /^bangalore$/i,
  /^hyderabad$/i,
  /^web3$/i,
  /^blockchain$/i,
  /^data science$/i,
  /^python$/i,
  /^java$/i,
  /^crypto$/i,
  /^engineering$/i,
  /^aiml$/i,
  /^cloud$/i,
  /^security$/i,
  /^big data$/i,
  /^genai$/i,
  /^chatgpt$/i,
  /^public speaker$/i,
  /^stem ambassador$/i,
];

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function stripFeed(raw) {
  let t = clean(raw);
  t = t.replace(/^feed post\s+/i, "");
  const followIdx = t.search(/\b(Follow|Join)\b/i);
  if (followIdx > 0 && followIdx < 220) {
    t = t.slice(followIdx + 6).trim();
  }
  return t;
}

function extract(raw, title) {
  const t = stripFeed(raw);
  const rules = [
    /(?:job title|hiring|we\s*are\s*hiring|we're\s*hiring|urgent hiring|contract opportunity)\s*[:\-–]\s*([^|•\n]{6,120})/i,
    /(?:looking for|recruiting for|needs? (?:an? )?)\s+([^.!\n]{6,120})/i,
    /(?:open positions?)\s*[:\-–]\s*([^|•\n]{6,120})/i,
  ];

  for (const r of rules) {
    const m = t.match(r);
    if (m && m[1]) {
      return clean(m[1]).replace(/^#hiring\s*/i, "").slice(0, 90);
    }
  }

  const first = t.split(/[.!?]/)[0] || title;
  return clean(first).replace(/^#hiring\s*/i, "").slice(0, 90);
}

function isBad(title) {
  const c = clean(title);
  if (!c) return true;
  if (c.length > 90) return true;
  return BAD_TITLE_PATTERNS.some((r) => r.test(c));
}

(async () => {
  const start = new Date("2026-04-07T00:00:00.000Z");
  const end = new Date("2026-04-08T00:00:00.000Z");
  const tenantId = "dotcloudconsulting";

  const jobs = await p.job.findMany({
    where: { tenantId, createdAt: { gte: start, lt: end } },
    select: { id: true, title: true, rawText: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const changes = [];
  for (const j of jobs) {
    if (!isBad(j.title)) continue;
    const next = extract(j.rawText, j.title);
    if (!next || next === j.title) continue;
    changes.push({ id: j.id, createdAt: j.createdAt.toISOString(), from: j.title, to: next });
  }

  console.log("totalToday", jobs.length);
  console.log("wouldChange", changes.length);
  for (const c of changes.slice(0, 30)) {
    console.log(JSON.stringify(c));
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
