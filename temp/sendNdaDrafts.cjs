"use strict";
const fs = require("fs");
const path = require("path");

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
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
loadEnv(path.resolve(__dirname, "../.env.local"));
loadEnv(path.resolve(__dirname, "../.env"));

const mailbox =
  process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
  process.env.GRAPH_SENDER_USER?.trim() ||
  "placements@dotcloud.africa";

const SUBJECT =
  "DotCloud Consulting \u2014 NDA & Teaming Agreement: Action Required";

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
  if (!d.access_token) throw new Error("No access_token: " + JSON.stringify(d));
  return d.access_token;
}

async function main() {
  const token = await getToken();
  const enc = encodeURIComponent;
  const base = `https://graph.microsoft.com/v1.0/users/${enc(mailbox)}`;

  // Fetch all matching drafts
  const drafts = [];
  let url =
    `${base}/mailFolders/Drafts/messages` +
    `?$filter=${enc("subject eq '" + SUBJECT + "'")}` +
    `&$select=id,subject,toRecipients` +
    `&$top=50`;

  while (url) {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json();
    drafts.push(...(d.value ?? []));
    url = d["@odata.nextLink"] ?? null;
  }

  console.log(`Found ${drafts.length} draft(s) matching the NDA subject`);

  let sent = 0;
  let failed = 0;

  for (const draft of drafts) {
    const to = draft.toRecipients?.[0]?.emailAddress?.address ?? "?";
    const r = await fetch(`${base}/messages/${draft.id}/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Length": "0" },
    });
    if (r.status === 202) {
      console.log(`  Sent  -> ${to}`);
      sent++;
    } else {
      const msg = await r.text();
      console.error(`  FAIL  -> ${to}: ${r.status} ${msg.slice(0, 200)}`);
      failed++;
    }
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
