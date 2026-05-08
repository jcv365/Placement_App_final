"use strict";
/**
 * sendDraftsAgent.cjs
 *
 * Enhanced send-drafts agent. Finds Outlook draft messages for a given date
 * (today by default), validates each one, sends via Microsoft Graph API, and
 * retries once on transient failure. Structured error output is written to
 * stderr so it can be captured by monitoring pipelines.
 *
 * This is a separate script from sendTodaysDrafts.cjs. Both can coexist.
 * sendDraftsAgent is intended for scheduled/automated use; sendTodaysDrafts.cjs
 * remains available for quick manual sends.
 *
 * Usage:
 *   node scripts/sendDraftsAgent.cjs                            # dry run (today)
 *   node scripts/sendDraftsAgent.cjs --apply                    # send today's drafts
 *   node scripts/sendDraftsAgent.cjs --apply --filter "riaan"   # match subject OR recipient
 *   node scripts/sendDraftsAgent.cjs --apply --subject-filter "teaming" # subject line only
 *   node scripts/sendDraftsAgent.cjs --apply --since 2026-04-13 # a specific date
 *   node scripts/sendDraftsAgent.cjs --apply --all-dates        # ignore date filter
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
const ALL_DATES = process.argv.includes("--all-dates");

const filterIdx = process.argv.indexOf("--filter");
const NAME_FILTER =
  filterIdx !== -1 && process.argv[filterIdx + 1]
    ? process.argv[filterIdx + 1].trim().toLowerCase()
    : null;

// --subject-filter matches only against the email subject (not recipient address).
// Safer than --filter when the search term may appear in email addresses as a substring.
const subjectFilterIdx = process.argv.indexOf("--subject-filter");
const SUBJECT_FILTER =
  subjectFilterIdx !== -1 && process.argv[subjectFilterIdx + 1]
    ? process.argv[subjectFilterIdx + 1].trim().toLowerCase()
    : null;

const sinceIdx = process.argv.indexOf("--since");
const TARGET_DATE =
  sinceIdx !== -1 && process.argv[sinceIdx + 1]
    ? process.argv[sinceIdx + 1].trim().slice(0, 10)
    : new Date().toISOString().slice(0, 10); // default: today

const RETRY_DELAY_MS = 5000;

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

async function fetchAllDrafts(mailbox, accessToken) {
  const drafts = [];
  let url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/Drafts/messages` +
    `?$top=50&$select=id,subject,createdDateTime,toRecipients,isDraft`;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempts to send a draft. On failure waits RETRY_DELAY_MS and tries once
 * more. If the second attempt also fails, returns false and logs a structured
 * error to stderr.
 */
async function sendWithRetry(mailbox, draft, accessToken) {
  const label = draft.subject ?? draft.id;
  try {
    await sendDraft(mailbox, draft.id, accessToken);
    return true;
  } catch (firstErr) {
    console.error(
      `  ⚠  First attempt failed for "${label}": ${firstErr.message}. Retrying in ${RETRY_DELAY_MS / 1000}s...`,
    );
    await sleep(RETRY_DELAY_MS);
    try {
      await sendDraft(mailbox, draft.id, accessToken);
      return true;
    } catch (secondErr) {
      // Structured stderr output for monitoring pipelines.
      const errorPayload = {
        event: "send_draft_failed",
        messageId: draft.id,
        subject: draft.subject,
        toRecipients: (draft.toRecipients ?? []).map(
          (r) => r.emailAddress?.address,
        ),
        error: secondErr.message,
        timestamp: new Date().toISOString(),
      };
      process.stderr.write(JSON.stringify(errorPayload) + "\n");
      return false;
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const mailbox = getSharedMailbox();

  console.log("=".repeat(60));
  console.log("Send Drafts Agent");
  console.log("=".repeat(60));
  console.log(`Mode    : ${APPLY ? "APPLY (will send emails)" : "DRY RUN"}`);
  console.log(`Mailbox : ${mailbox}`);
  if (ALL_DATES) {
    console.log(`Date    : ALL (no date filter)`);
  } else {
    console.log(`Date    : ${TARGET_DATE}`);
  }
  if (NAME_FILTER)
    console.log(`Filter  : "${NAME_FILTER}" (subject + recipient)`);
  if (SUBJECT_FILTER)
    console.log(`Filter  : "${SUBJECT_FILTER}" (subject only)`);
  console.log();

  console.log("Acquiring Graph access token...");
  const accessToken = await getGraphAppAccessToken();
  console.log("Token acquired.\n");

  console.log("Fetching drafts...");
  const allDrafts = await fetchAllDrafts(mailbox, accessToken);
  console.log(`Total drafts in mailbox: ${allDrafts.length}`);

  // Filter by date unless --all-dates is set.
  let candidates = ALL_DATES
    ? allDrafts
    : allDrafts.filter((d) =>
        (d.createdDateTime ?? "").startsWith(TARGET_DATE),
      );
  console.log(
    ALL_DATES
      ? `Selected drafts: ${candidates.length}`
      : `Drafts for ${TARGET_DATE}: ${candidates.length}`,
  );

  // Optional name/subject filter.
  if (NAME_FILTER) {
    candidates = candidates.filter((d) => {
      const subject = (d.subject ?? "").toLowerCase();
      const recipients = (d.toRecipients ?? [])
        .map((r) => r.emailAddress?.address ?? "")
        .join(" ")
        .toLowerCase();
      return subject.includes(NAME_FILTER) || recipients.includes(NAME_FILTER);
    });
    console.log(`After filter: ${candidates.length}`);
  }

  // --subject-filter matches subject line only — avoids substring false-positives
  // on recipient addresses (e.g. "nda" matching "brendan@example.com").
  if (SUBJECT_FILTER) {
    candidates = candidates.filter((d) =>
      (d.subject ?? "").toLowerCase().includes(SUBJECT_FILTER),
    );
    console.log(`After subject filter: ${candidates.length}`);
  }

  if (candidates.length === 0) {
    console.log("\nNo drafts to process.");
    return;
  }

  console.log();

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const draft = candidates[i];
    const to =
      (draft.toRecipients ?? [])
        .map((r) => r.emailAddress?.address)
        .filter(Boolean)
        .join(", ") || "(no recipients)";
    const prefix = `[${i + 1}/${candidates.length}]`;

    console.log(`${prefix} ${draft.subject ?? "(no subject)"}`);
    console.log(`        To: ${to}`);
    console.log(`        Created: ${draft.createdDateTime ?? "unknown"}`);

    if (!APPLY) {
      console.log(`        [dry-run] would send`);
      continue;
    }

    const ok = await sendWithRetry(mailbox, draft, accessToken);
    if (ok) {
      console.log(`        Status: Sent ✓`);
      sent++;
    } else {
      console.log(`        Status: Failed ✗ (see stderr)`);
      failed++;
    }
    console.log();
  }

  // Summary.
  console.log();
  console.log("=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`Drafts found : ${candidates.length}`);
  if (APPLY) {
    console.log(`Sent         : ${sent}`);
    console.log(`Failed       : ${failed}`);
  } else {
    console.log();
    console.log("This was a dry run. Add --apply to send emails.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
