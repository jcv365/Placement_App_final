"use strict";
/**
 * sendTodaysDrafts.cjs
 *
 * Finds all draft messages in the shared Outlook mailbox that were created
 * today and sends them via Microsoft Graph API.
 *
 * Usage:
 *   node scripts/sendTodaysDrafts.cjs                  # dry run (lists drafts)
 *   node scripts/sendTodaysDrafts.cjs --apply           # send all today's drafts
 *   node scripts/sendTodaysDrafts.cjs --apply --filter "Riaan"  # send matching only
 *
 * Required env (in .env.local or shell):
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   Optionally: OUTLOOK_SHARED_MAILBOX
 */

const path = require("path");
const fs = require("fs");

// ── Env loading ──────────────────────────────────────────────────────────────

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(__dirname, "../.env.local"));
loadEnvFile(path.resolve(__dirname, "../.env"));

// ── CLI flags ────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes("--apply");
const filterFlagIdx = process.argv.indexOf("--filter");
const NAME_FILTER =
  filterFlagIdx !== -1 && process.argv[filterFlagIdx + 1]
    ? process.argv[filterFlagIdx + 1].trim().toLowerCase()
    : null;

// ── Graph helpers ────────────────────────────────────────────────────────────

function getSharedMailbox() {
  return (
    process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
    process.env.GRAPH_SENDER_USER?.trim() ||
    ""
  );
}

async function getGraphAppAccessToken() {
  const tenantId = process.env.GRAPH_TENANT_ID?.trim();
  const clientId = process.env.GRAPH_CLIENT_ID?.trim();
  const clientSecret = process.env.GRAPH_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Graph credentials not configured. Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET.",
    );
  }
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Graph token error: ${response.status} ${message}`);
  }
  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("Graph token response did not include an access token");
  }
  return payload.access_token;
}

// Fetch all draft messages in the mailbox (paginates automatically).
async function fetchAllDrafts(mailbox, accessToken) {
  const drafts = [];
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/Drafts/messages?$top=50&$select=id,subject,createdDateTime,toRecipients`;

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Graph list drafts error: ${response.status} ${message}`);
    }
    const data = await response.json();
    drafts.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  return drafts;
}

async function sendDraft(mailbox, messageId, accessToken) {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${messageId}/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Graph send error: ${response.status} ${message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const mailbox = getSharedMailbox();
  // Today in UTC — compare only the date portion of createdDateTime
  const todayPrefix = new Date().toISOString().slice(0, 10); // "2026-04-13"

  console.log("=".repeat(60));
  console.log("Send Today's Drafts");
  console.log("=".repeat(60));
  console.log(`Mode    : ${APPLY ? "APPLY (will send emails)" : "DRY RUN"}`);
  console.log(`Mailbox : ${mailbox}`);
  console.log(`Date    : ${todayPrefix}`);
  if (NAME_FILTER) console.log(`Filter  : "${NAME_FILTER}"`);
  console.log();

  console.log("Acquiring Graph access token...");
  const accessToken = await getGraphAppAccessToken();
  console.log("Token acquired.\n");

  console.log("Fetching drafts...");
  const allDrafts = await fetchAllDrafts(mailbox, accessToken);
  console.log(`Total drafts in mailbox: ${allDrafts.length}`);

  // Filter to today's drafts
  let todaysDrafts = allDrafts.filter((d) =>
    (d.createdDateTime ?? "").startsWith(todayPrefix),
  );
  console.log(`Drafts created today   : ${todaysDrafts.length}`);

  // Optional name filter (matches against subject or first recipient address)
  if (NAME_FILTER) {
    todaysDrafts = todaysDrafts.filter((d) => {
      const subject = (d.subject ?? "").toLowerCase();
      const recipients = (d.toRecipients ?? [])
        .map((r) => r.emailAddress?.address ?? "")
        .join(" ")
        .toLowerCase();
      return subject.includes(NAME_FILTER) || recipients.includes(NAME_FILTER);
    });
    console.log(`After filter           : ${todaysDrafts.length}`);
  }

  if (todaysDrafts.length === 0) {
    console.log("\nNo drafts to send.");
    return;
  }

  console.log();

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < todaysDrafts.length; i++) {
    const draft = todaysDrafts[i];
    const to =
      (draft.toRecipients ?? [])
        .map((r) => r.emailAddress?.address)
        .filter(Boolean)
        .join(", ") || "(no recipients)";
    const prefix = `[${i + 1}/${todaysDrafts.length}]`;
    console.log(`${prefix} ${draft.subject}`);
    console.log(`        To: ${to}`);

    if (APPLY) {
      try {
        await sendDraft(mailbox, draft.id, accessToken);
        console.log(`        Status: Sent`);
        sent++;
      } catch (err) {
        console.error(`        Status: FAILED — ${err.message}`);
        failed++;
      }
    } else {
      console.log(`        Status: (dry run — not sent)`);
    }
    console.log();
  }

  console.log("=".repeat(60));
  if (APPLY) {
    console.log(`Done. Sent: ${sent}, Failed: ${failed}`);
  } else {
    console.log(
      `Dry run complete — ${todaysDrafts.length} email(s) would be sent.`,
    );
    console.log("Run with --apply to send them.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
