#!/usr/bin/env node
// Deletes all drafts from the shared Outlook mailbox that were created by generate-missing-direct.cjs
// These drafts don't follow the proper AI prompts and need to be removed.
"use strict";

const path = require("path");
const fs = require("fs");

// Load .env.local
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
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

const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const MAILBOX =
  process.env.OUTLOOK_SHARED_MAILBOX ||
  process.env.GRAPH_SENDER_USER ||
  "placements@dotcloud.africa";

const DRY_RUN = process.argv.includes("--dry-run");

async function getGraphToken() {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.access_token)
    throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function listAllDrafts(token) {
  const drafts = [];
  let url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/drafts/messages` +
    `?$select=id,subject,createdDateTime,toRecipients&$top=999`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph error listing drafts ${res.status}: ${text}`);
    }
    const data = await res.json();
    for (const msg of data.value ?? []) {
      drafts.push(msg);
    }
    url = data["@odata.nextLink"] ?? null;
  }
  return drafts;
}

// The bad drafts from generate-missing-direct.cjs use "Candidate | Title" format
// and were created on 2026-04-29. The good drafts use "Title – B2B – Candidate" format.
function isBadDraft(draft) {
  // Filter: created on 2026-04-29 (today) AND subject contains " | " (pipe format)
  const created = draft.createdDateTime || "";
  const subject = draft.subject || "";
  const isToday = created.startsWith("2026-04-29");
  const hasPipeFormat = subject.includes(" | ");
  return isToday && hasPipeFormat;
}

async function deleteDraft(token, messageId) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages/${messageId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  // 204 No Content = success, 404 = already gone
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Delete failed ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function main() {
  console.log(`Mailbox: ${MAILBOX}`);
  if (DRY_RUN) console.log("*** DRY RUN — no drafts will be deleted ***\n");

  const token = await getGraphToken();
  console.log("Fetching all drafts from mailbox...");

  const drafts = await listAllDrafts(token);
  console.log(`  Total drafts found: ${drafts.length}\n`);

  if (drafts.length === 0) {
    console.log("No drafts to delete.");
    return;
  }

  // Filter to only bad drafts (today + pipe format)
  const badDrafts = drafts.filter(isBadDraft);
  const goodDrafts = drafts.filter((d) => !isBadDraft(d));

  console.log(`  Good drafts (keeping): ${goodDrafts.length}`);
  console.log(`  Bad drafts (deleting): ${badDrafts.length}\n`);

  if (badDrafts.length === 0) {
    console.log("No bad drafts found. Nothing to delete.");
    return;
  }

  console.log("Bad drafts to delete:");
  for (const d of badDrafts) {
    const to = (d.toRecipients || [])
      .map((r) => r.emailAddress?.address || "?")
      .join(", ");
    console.log(
      `  - ${d.subject || "(no subject)"} → To: ${to} (${d.createdDateTime})`,
    );
  }
  console.log();

  if (DRY_RUN) {
    console.log(`Would delete ${badDrafts.length} bad drafts.`);
    return;
  }

  // Delete bad drafts only
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < badDrafts.length; i++) {
    const d = badDrafts[i];
    process.stdout.write(
      `  [${i + 1}/${badDrafts.length}] Deleting "${d.subject || "(no subject)"}"... `,
    );
    try {
      await deleteDraft(token, d.id);
      console.log("OK");
      ok++;
    } catch (err) {
      console.log(`FAIL: ${err.message.slice(0, 200)}`);
      failed++;
    }
    // Small delay to avoid throttling
    if (i < badDrafts.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Deleted: ${ok}`);
  console.log(`  Failed:  ${failed}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
