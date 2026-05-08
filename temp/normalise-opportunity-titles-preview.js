const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const ACRONYMS = new Set([
  "AI","ML","AWS","GCP","AZURE","UK","EU","US","UAE","IR35","SRE","HPC","QA","UI","UX","SQL","SAP","DEX","B2B","B2C","SC","MDS"
]);

const SPECIAL_CASE = new Map([
  ["devops", "DevOps"],
  ["fullstack", "Full Stack"],
  ["full-stack", "Full-Stack"],
  ["frontend", "Frontend"],
  ["backend", "Backend"],
  ["next.js", "Next.js"],
]);

const LOWER_WORDS = new Set(["and","or","to","for","of","in","on","at","a","an","the","with","by"]);

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function titleWord(word, isFirst) {
  if (!word) return word;
  const direct = SPECIAL_CASE.get(word.toLowerCase());
  if (direct) return direct;

  const stripped = word.replace(/[^a-zA-Z0-9.+#/-]/g, "");
  if (ACRONYMS.has(stripped.toUpperCase())) {
    return stripped.toUpperCase();
  }

  if (!isFirst && LOWER_WORDS.has(word.toLowerCase())) {
    return word.toLowerCase();
  }

  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseToken(token, isFirst) {
  if (token.includes("/")) {
    return token
      .split("/")
      .map((part, i) => titleCaseToken(part, isFirst && i === 0))
      .join("/");
  }

  if (token.includes("-")) {
    return token
      .split("-")
      .map((part, i) => titleWord(part, isFirst && i === 0))
      .join("-");
  }

  return titleWord(token, isFirst);
}

function normaliseTitle(raw) {
  let title = clean(raw)
    .replace(/^#hiring\s*/i, "")
    .replace(/^hiring\s*[:\-]\s*/i, "")
    .replace(/^job title\s*[:\-]\s*/i, "");

  if (!title) return title;

  const words = title.split(" ").filter(Boolean);
  const transformed = words.map((w, i) => titleCaseToken(w, i === 0)).join(" ");

  return transformed
    .replace(/\bDevops\b/g, "DevOps")
    .replace(/\bIr35\b/g, "IR35")
    .replace(/\bAws\b/g, "AWS")
    .replace(/\bAi\b/g, "AI")
    .replace(/\bUk\b/g, "UK")
    .replace(/\bEu\b/g, "EU")
    .replace(/\bUs\b/g, "US");
}

(async () => {
  const start = new Date("2026-04-07T00:00:00.000Z");
  const end = new Date("2026-04-08T00:00:00.000Z");
  const tenantId = "dotcloudconsulting";

  const jobs = await p.job.findMany({
    where: { tenantId, createdAt: { gte: start, lt: end } },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const changes = [];
  for (const j of jobs) {
    const next = normaliseTitle(j.title);
    if (!next || next === j.title) continue;
    changes.push({ id: j.id, from: j.title, to: next, createdAt: j.createdAt.toISOString() });
  }

  console.log("totalToday", jobs.length);
  console.log("wouldNormalise", changes.length);
  for (const c of changes.slice(0, 50)) {
    console.log(JSON.stringify(c));
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
