// @ts-check
/**
 * sendOutlookDrafts.js
 *
 * Reads all messages from the shared mailbox's Drafts folder via Microsoft
 * Graph API, removes duplicate drafts (same subject + same first recipient),
 * and sends each unique draft.
 *
 * Usage:
 *   node scripts/sendOutlookDrafts.js            # dry run — reports what it would do
 *   node scripts/sendOutlookDrafts.js --send      # actually delete duplicates and send
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// 1. Load .env.local
// ---------------------------------------------------------------------------
const envPath = path.join(__dirname, "..", ".env.local");
const envLines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const value = trimmed
    .slice(eqIdx + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = value;
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
  console.error(
    "Missing required env vars: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, OUTLOOK_SHARED_MAILBOX",
  );
  process.exit(1);
}

const DRY_RUN = !process.argv.includes("--send");

if (DRY_RUN) {
  console.log(
    "=== DRY RUN — pass --send to actually delete duplicates and send drafts ===\n",
  );
} else {
  console.log("=== LIVE MODE — will delete duplicates and send drafts ===\n");
}

// ---------------------------------------------------------------------------
// 2. Auth
// ---------------------------------------------------------------------------
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token error ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("No access_token in response");
  return json.access_token;
}

// ---------------------------------------------------------------------------
// 3. Graph helpers
// ---------------------------------------------------------------------------
async function graphGet(token, url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${url} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function graphPost(token, url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${url} → ${res.status}: ${text}`);
  }
  // sendMail returns 202 No Content
  return res.status;
}

async function graphDelete(token, url) {
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DELETE ${url} → ${res.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// 4. Fetch all Drafts (paged)
// ---------------------------------------------------------------------------
async function fetchAllDrafts(token) {
  const mailboxEncoded = encodeURIComponent(MAILBOX);
  let url =
    `https://graph.microsoft.com/v1.0/users/${mailboxEncoded}/mailFolders/Drafts/messages` +
    `?$select=id,subject,toRecipients,createdDateTime&$top=100&$orderby=createdDateTime asc`;

  const messages = [];
  while (url) {
    const page = await graphGet(token, url);
    if (Array.isArray(page.value)) messages.push(...page.value);
    url = page["@odata.nextLink"] || null;
  }
  return messages;
}

// ---------------------------------------------------------------------------
// 5. Deduplicate
//    Key = subject + sorted recipient addresses
//    Keeps the FIRST (oldest) draft, marks the rest for deletion.
// ---------------------------------------------------------------------------
function deduplicateDrafts(messages) {
  /** @type {Map<string, typeof messages[0]>} */
  const seen = new Map();
  /** @type {typeof messages} */
  const toKeep = [];
  /** @type {typeof messages} */
  const toDelete = [];

  for (const msg of messages) {
    const recipients = (msg.toRecipients || [])
      .map((r) => r.emailAddress?.address?.toLowerCase() ?? "")
      .sort()
      .join("|");
    const key = `${(msg.subject || "").trim().toLowerCase()}||${recipients}`;

    if (seen.has(key)) {
      toDelete.push(msg);
    } else {
      seen.set(key, msg);
      toKeep.push(msg);
    }
  }

  return { toKeep, toDelete };
}

// ---------------------------------------------------------------------------
// 6. Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Mailbox: ${MAILBOX}\n`);

  const token = await getAccessToken();
  console.log("✓ Access token obtained\n");

  console.log("Fetching all Drafts...");
  const allDrafts = await fetchAllDrafts(token);
  console.log(`  Total drafts found: ${allDrafts.length}\n`);

  const { toKeep, toDelete } = deduplicateDrafts(allDrafts);

  console.log(`  Unique drafts (to send): ${toKeep.length}`);
  console.log(`  Duplicates (to delete):  ${toDelete.length}\n`);

  if (toKeep.length === 0) {
    console.log("Nothing to do — no drafts found.");
    return;
  }

  // Show preview
  console.log("--- Unique drafts ---");
  for (const msg of toKeep) {
    const to = (msg.toRecipients || [])
      .map((r) => r.emailAddress?.address)
      .join(", ");
    console.log(`  [${msg.createdDateTime}] "${msg.subject}" → ${to}`);
  }

  if (toDelete.length > 0) {
    console.log("\n--- Duplicates to delete ---");
    for (const msg of toDelete) {
      const to = (msg.toRecipients || [])
        .map((r) => r.emailAddress?.address)
        .join(", ");
      console.log(`  [${msg.createdDateTime}] "${msg.subject}" → ${to}`);
    }
  }

  if (DRY_RUN) {
    console.log("\nDry run complete. Re-run with --send to execute.");
    return;
  }

  // --- Delete duplicates ---
  if (toDelete.length > 0) {
    console.log(`\nDeleting ${toDelete.length} duplicates...`);
    const mailboxEncoded = encodeURIComponent(MAILBOX);
    let deleted = 0;
    let deleteFailed = 0;
    for (const msg of toDelete) {
      try {
        await graphDelete(
          token,
          `https://graph.microsoft.com/v1.0/users/${mailboxEncoded}/messages/${msg.id}`,
        );
        deleted++;
        process.stdout.write(`\r  Deleted ${deleted}/${toDelete.length}  `);
      } catch (err) {
        deleteFailed++;
        console.error(
          `\n  WARN: Failed to delete "${msg.subject}": ${err.message}`,
        );
      }
    }
    console.log(`\n✓ Deleted ${deleted} duplicates (${deleteFailed} failed)\n`);
  }

  // --- Send unique drafts ---
  console.log(`Sending ${toKeep.length} drafts...`);
  const mailboxEncoded = encodeURIComponent(MAILBOX);
  let sent = 0;
  let sendFailed = 0;
  const failed = [];

  for (const msg of toKeep) {
    try {
      await graphPost(
        token,
        `https://graph.microsoft.com/v1.0/users/${mailboxEncoded}/messages/${msg.id}/send`,
      );
      sent++;
      process.stdout.write(`\r  Sent ${sent}/${toKeep.length}  `);
    } catch (err) {
      sendFailed++;
      failed.push({ subject: msg.subject, error: err.message });
      console.error(`\n  ERROR sending "${msg.subject}": ${err.message}`);
    }
  }

  console.log(`\n\n=== Done ===`);
  console.log(`  Sent:   ${sent}`);
  console.log(`  Failed: ${sendFailed}`);

  if (failed.length > 0) {
    console.log("\nFailed items:");
    for (const f of failed) console.log(`  - "${f.subject}": ${f.error}`);
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
