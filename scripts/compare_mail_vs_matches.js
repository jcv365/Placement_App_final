// Compare DB matches (applications) with Outlook Drafts and Sent items
// Usage: node scripts/compare_mail_vs_matches.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Load .env.local if present (same pattern as other scripts)
const fs = require("fs");
const path = require("path");
const envFile = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

const TENANT_ID = process.env.GRAPH_TENANT_ID?.trim();
const CLIENT_ID = process.env.GRAPH_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET?.trim();
const MAILBOX = (
  process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
  process.env.GRAPH_SENDER_USER?.trim() ||
  ""
).toLowerCase();

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !MAILBOX) {
  console.error("Missing Graph credentials in environment (.env.local)");
  process.exit(1);
}

async function getAccessToken() {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok)
    throw new Error(`Token error ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.access_token;
}

async function fetchAll(folder) {
  const enc = encodeURIComponent(MAILBOX);
  let url = `https://graph.microsoft.com/v1.0/users/${enc}/mailFolders/${folder}/messages?$select=id,subject,toRecipients,createdDateTime&$top=100&$orderby=createdDateTime asc`;
  const items = [];
  const token = await getAccessToken();
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok)
      throw new Error(`GET ${folder} error ${res.status}: ${await res.text()}`);
    const page = await res.json();
    if (Array.isArray(page.value)) items.push(...page.value);
    url = page["@odata.nextLink"] || null;
  }
  return items;
}

function norm(s) {
  return (s || "").trim().toLowerCase();
}

async function main() {
  console.log("Fetching DB applications and email drafts...");
  // recent applications: stages SHORTLISTED, EMAIL_DRAFTED, SENT_TO_CLIENT
  const apps = await prisma.application.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      currentStage: { in: ["SHORTLISTED", "EMAIL_DRAFTED", "SENT_TO_CLIENT"] },
    },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      currentStage: true,
      job: { select: { title: true } },
      candidate: { select: { fullName: true } },
      emails: { select: { subject: true, createdAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const emailDrafts = await prisma.emailDraft.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: { id: true, applicationId: true, subject: true, createdAt: true },
  });

  console.log(
    `DB: applications=${apps.length} emailDrafts=${emailDrafts.length}`,
  );

  console.log("Fetching Outlook drafts and sent items...");
  const drafts = await fetchAll("Drafts");
  const sent = await fetchAll("SentItems");
  console.log(`Mailbox: drafts=${drafts.length} sent=${sent.length}`);

  const outlookDraftSubjects = new Set(drafts.map((d) => norm(d.subject)));
  const outlookSentSubjects = new Set(sent.map((s) => norm(s.subject)));

  // Build report
  let haveDraft = 0;
  let haveSent = 0;
  let missingBoth = 0;

  console.log("\nComparison report (by application):");
  for (const a of apps) {
    const dbSubjects = (a.emails || []).map((e) => norm(e.subject));
    const anyDbDraft = dbSubjects.length > 0;
    const anyOutlookDraft =
      dbSubjects.some((s) => outlookDraftSubjects.has(s)) ||
      outlookDraftSubjects.has(norm(a.job.title));
    const anyOutlookSent =
      dbSubjects.some((s) => outlookSentSubjects.has(s)) ||
      outlookSentSubjects.has(norm(a.job.title));

    if (anyDbDraft) haveDraft++;
    if (anyOutlookSent) haveSent++;
    if (!anyDbDraft && !anyOutlookDraft && !anyOutlookSent) missingBoth++;

    console.log(
      `- ${a.id} | stage=${a.currentStage} | "${a.job.title}" / ${a.candidate.fullName}`,
    );
    console.log(
      `    DB draft: ${anyDbDraft ? "YES" : "NO"} | OutlookDraft: ${anyOutlookDraft ? "YES" : "NO"} | OutlookSent: ${anyOutlookSent ? "YES" : "NO"}`,
    );
  }

  console.log("\nTotals:");
  console.log(`  Applications checked: ${apps.length}`);
  console.log(`  With DB draft: ${haveDraft}`);
  console.log(`  With Outlook Sent: ${haveSent}`);
  console.log(`  Missing both DB draft and Outlook messages: ${missingBoth}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal:", err.message);
  await prisma.$disconnect();
  process.exit(1);
});
