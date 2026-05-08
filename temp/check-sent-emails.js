"use strict";
/**
 * Checks the Outlook Sent folder for both pipeline emails and
 * cross-references against all active candidates.
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(path.resolve(__dirname, "../.env.local"));
loadEnvFile(path.resolve(__dirname, "../.env"));

const MAILBOX =
  process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
  process.env.GRAPH_SENDER_USER?.trim() ||
  "placements@dotcloud.africa";

const NDA_SUBJECT =
  "DotCloud Consulting \u2014 NDA & Teaming Agreement: Action Required";
const ROLE_SUBJECT_PARTIAL = "Role Confirmation and Rate";

async function getToken() {
  const tid = process.env.GRAPH_TENANT_ID;
  const cid = process.env.GRAPH_CLIENT_ID;
  const cs = process.env.GRAPH_CLIENT_SECRET;
  const r = await fetch(
    `https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cid,
        client_secret: cs,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }).toString(),
    },
  );
  const d = await r.json();
  if (!d.access_token) throw new Error("No token: " + JSON.stringify(d));
  return d.access_token;
}

async function fetchAllSentMessages(token) {
  const enc = encodeURIComponent;
  let url =
    `https://graph.microsoft.com/v1.0/users/${enc(MAILBOX)}/mailFolders/SentItems/messages` +
    `?$select=id,subject,toRecipients,sentDateTime&$top=100`;
  const all = [];
  while (url) {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json();
    all.push(...(d.value || []));
    url = d["@odata.nextLink"] || null;
  }
  return all;
}

// Also check Drafts for anything not yet sent
async function fetchAllDraftMessages(token) {
  const enc = encodeURIComponent;
  let url =
    `https://graph.microsoft.com/v1.0/users/${enc(MAILBOX)}/mailFolders/Drafts/messages` +
    `?$select=id,subject,toRecipients,createdDateTime&$top=100`;
  const all = [];
  while (url) {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json();
    all.push(...(d.value || []));
    url = d["@odata.nextLink"] || null;
  }
  return all;
}

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const p = new PrismaClient();

  const candidates = await p.candidate.findMany({
    where: { isActive: true },
    select: { fullName: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  await p.$disconnect();

  console.log(`\nTotal active candidates: ${candidates.length}`);

  const token = await getToken();
  console.log("Graph token acquired.\n");

  const [sentMsgs, draftMsgs] = await Promise.all([
    fetchAllSentMessages(token),
    fetchAllDraftMessages(token),
  ]);

  console.log(`Sent items fetched : ${sentMsgs.length}`);
  console.log(`Drafts fetched     : ${draftMsgs.length}\n`);

  // Build sets of emails that received each type
  function recipientEmails(msg) {
    return (msg.toRecipients || []).map((r) =>
      r.emailAddress?.address?.toLowerCase(),
    );
  }

  const ndaSentTo = new Set();
  const roleSentTo = new Set();
  const ndaDraftTo = new Set();
  const roleDraftTo = new Set();

  for (const m of sentMsgs) {
    const s = m.subject || "";
    const emails = recipientEmails(m);
    if (s === NDA_SUBJECT) emails.forEach((e) => ndaSentTo.add(e));
    if (s.includes(ROLE_SUBJECT_PARTIAL))
      emails.forEach((e) => roleSentTo.add(e));
  }
  for (const m of draftMsgs) {
    const s = m.subject || "";
    const emails = recipientEmails(m);
    if (s === NDA_SUBJECT) emails.forEach((e) => ndaDraftTo.add(e));
    if (s.includes(ROLE_SUBJECT_PARTIAL))
      emails.forEach((e) => roleDraftTo.add(e));
  }

  console.log("=".repeat(72));
  console.log("CANDIDATE EMAIL STATUS");
  console.log("=".repeat(72));
  console.log(
    `${"Name".padEnd(40)} ${"NDA".padEnd(10)} ${"Role Confirm".padEnd(14)}`,
  );
  console.log("-".repeat(72));

  const missingNda = [];
  const missingRole = [];

  for (const c of candidates) {
    const emailLower = c.email?.toLowerCase() ?? "";
    const ndaOk = ndaSentTo.has(emailLower)
      ? "SENT"
      : ndaDraftTo.has(emailLower)
        ? "DRAFT"
        : "MISSING";
    const roleOk = roleSentTo.has(emailLower)
      ? "SENT"
      : roleDraftTo.has(emailLower)
        ? "DRAFT"
        : "MISSING";
    const line = `${c.fullName.slice(0, 39).padEnd(40)} ${ndaOk.padEnd(10)} ${roleOk.padEnd(14)}`;
    console.log(line);
    if (ndaOk === "MISSING") missingNda.push(c);
    if (roleOk === "MISSING") missingRole.push(c);
  }

  console.log("=".repeat(72));
  console.log(`\nMissing NDA email        : ${missingNda.length}`);
  if (missingNda.length)
    missingNda.forEach((c) => console.log(`  - ${c.fullName} <${c.email}>`));
  console.log(`Missing Role Confirmation: ${missingRole.length}`);
  if (missingRole.length)
    missingRole.forEach((c) => console.log(`  - ${c.fullName} <${c.email}>`));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
