const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function wordCount(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function subjectPatternOk(subject, roleTitle, candidateName) {
  if (!subject) return false;
  // Accept either hyphen/dash variants
  const norm = subject.replace(/\u2013|\u2014|–|—/g, "-");
  const parts = norm.split(/\s-\s/).map((p) => p.trim());
  if (parts.length < 3) return false;
  // last part should contain candidate name
  return parts[parts.length - 1]
    .toLowerCase()
    .includes(candidateName.toLowerCase().split(" ")[0]);
}

async function main() {
  const drafts = await p.emailDraft.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      application: {
        select: {
          id: true,
          job: { select: { title: true } },
          candidate: { select: { fullName: true } },
        },
      },
    },
  });
  console.log(`Checking ${drafts.length} drafts`);
  const results = [];
  for (const d of drafts) {
    const text = stripHtml(d.htmlBody || "");
    const wc = wordCount(text);
    const roleTitle = d.application?.job?.title || "(unknown)";
    const cand = d.application?.candidate?.fullName || "(unknown)";
    const failures = [];
    // subject
    if (!subjectPatternOk(d.subject || "", roleTitle, cand))
      failures.push("subject pattern");
    // greeting
    if (!/^Hi( [A-Za-z ,]+)?,/.test(text)) failures.push("greeting");
    // Relevant strengths label
    if (!/Relevant strengths:/i.test(text))
      failures.push("missing Relevant strengths label");
    // bullets count
    const bullets =
      (text.match(/\n?-\s[^\n]+/g) || []).length ||
      (text.match(/-\s[^-]{20,}/g) || []).length;
    if (bullets < 3) failures.push("few bullets");
    // transparency paragraph
    if (!/(One point to flag:|To be transparent,)/.test(text))
      failures.push("transparency opener");
    // Commercially
    if (!/Commercially,/i.test(text)) failures.push("missing Commercially,");
    // closing
    if (!/Kind regards,?/i.test(text)) failures.push("closing");
    // word count
    if (wc < 160 || wc > 350) failures.push(`wordcount ${wc}`);

    results.push({
      id: d.id,
      createdAt: d.createdAt,
      subject: d.subject,
      candidate: cand,
      job: roleTitle,
      wordCount: wc,
      failures,
    });
  }
  // print summary
  const failed = results.filter((r) => r.failures.length > 0);
  console.log(`${failed.length}/${results.length} drafts have issues`);
  failed.slice(0, 50).forEach((r) => {
    console.log("---");
    console.log(`id: ${r.id}`);
    console.log(`createdAt: ${r.createdAt.toISOString()}`);
    console.log(`subject: ${r.subject}`);
    console.log(`candidate: ${r.candidate}`);
    console.log(`job: ${r.job}`);
    console.log(`wordCount: ${r.wordCount}`);
    console.log(`failures: ${r.failures.join(", ")}`);
  });
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
