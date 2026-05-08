// @ts-check
/**
 * readInbox.js
 *
 * Reads recent messages from the shared mailbox Inbox via Microsoft Graph API.
 * Useful for checking replies/bounce-backs from recruiters after sending drafts.
 *
 * Usage:
 *   node scripts/readInbox.js             # last 50 inbox messages
 *   node scripts/readInbox.js --top 100   # last N messages
 *   node scripts/readInbox.js --body      # also print message body snippets
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

const args = process.argv.slice(2);
const topIdx = args.indexOf("--top");
const TOP = topIdx !== -1 ? parseInt(args[topIdx + 1], 10) || 50 : 50;
const SHOW_BODY = args.includes("--body");

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
// 3. Fetch inbox messages (paged up to TOP)
// ---------------------------------------------------------------------------
async function fetchInbox(token, top) {
  const mailboxEncoded = encodeURIComponent(MAILBOX);
  const selectFields = SHOW_BODY
    ? "id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,body"
    : "id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview";

  let url =
    `https://graph.microsoft.com/v1.0/users/${mailboxEncoded}/mailFolders/Inbox/messages` +
    `?$select=${selectFields}&$top=${Math.min(top, 100)}&$orderby=receivedDateTime desc`;

  const messages = [];
  while (url && messages.length < top) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET inbox → ${res.status}: ${text}`);
    }
    const page = await res.json();
    if (Array.isArray(page.value)) messages.push(...page.value);
    url = messages.length < top ? page["@odata.nextLink"] || null : null;
  }
  return messages.slice(0, top);
}

// ---------------------------------------------------------------------------
// 4. Categorise messages
// ---------------------------------------------------------------------------
function categorise(messages) {
  const categories = {
    bounces: [],
    outOfOffice: [],
    replies: [],
    other: [],
  };

  for (const msg of messages) {
    const subject = (msg.subject || "").toLowerCase();
    const preview = (msg.bodyPreview || "").toLowerCase();
    const from = msg.from?.emailAddress?.address?.toLowerCase() || "";

    const isBounce =
      subject.includes("undeliverable") ||
      subject.includes("delivery failed") ||
      subject.includes("mail delivery") ||
      subject.includes("returned mail") ||
      subject.includes("bounce") ||
      from.includes("mailer-daemon") ||
      from.includes("postmaster");

    const isOOO =
      subject.includes("out of office") ||
      subject.includes("automatic reply") ||
      subject.includes("auto-reply") ||
      subject.includes("i am away") ||
      subject.includes("on leave") ||
      preview.includes("out of office") ||
      preview.includes("on annual leave");

    const isReply =
      subject.startsWith("re:") ||
      subject.startsWith("re ") ||
      msg.subject?.startsWith("RE:");

    if (isBounce) categories.bounces.push(msg);
    else if (isOOO) categories.outOfOffice.push(msg);
    else if (isReply) categories.replies.push(msg);
    else categories.other.push(msg);
  }

  return categories;
}

// ---------------------------------------------------------------------------
// 5. Print
// ---------------------------------------------------------------------------
function printMsg(msg, idx) {
  const from = msg.from?.emailAddress?.address || "unknown";
  const name = msg.from?.emailAddress?.name || "";
  const date = msg.receivedDateTime
    ? new Date(msg.receivedDateTime)
        .toISOString()
        .replace("T", " ")
        .slice(0, 16)
    : "?";
  const unread = msg.isRead === false ? " [UNREAD]" : "";
  console.log(`  ${idx + 1}. [${date}]${unread} From: ${name} <${from}>`);
  console.log(`     Subject: ${msg.subject}`);
  if (SHOW_BODY && msg.body?.content) {
    // Strip HTML tags for readability
    const text = msg.body.content
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 500);
    console.log(`     Body: ${text}`);
  } else if (msg.bodyPreview) {
    const preview = msg.bodyPreview.trim().slice(0, 200);
    console.log(`     Preview: ${preview}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// 6. Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Mailbox: ${MAILBOX}\n`);

  const token = await getAccessToken();
  console.log(`✓ Access token obtained\n`);

  console.log(`Fetching last ${TOP} inbox messages...\n`);
  const messages = await fetchInbox(token, TOP);
  console.log(`  Total fetched: ${messages.length}\n`);

  const cats = categorise(messages);

  console.log(`=== Summary ===`);
  console.log(`  Bounces / Delivery failures: ${cats.bounces.length}`);
  console.log(`  Out-of-office auto-replies:  ${cats.outOfOffice.length}`);
  console.log(`  Genuine replies:             ${cats.replies.length}`);
  console.log(`  Other:                       ${cats.other.length}`);
  console.log();

  if (cats.bounces.length) {
    console.log(`--- BOUNCES / DELIVERY FAILURES (${cats.bounces.length}) ---`);
    cats.bounces.forEach(printMsg);
  }

  if (cats.replies.length) {
    console.log(`--- GENUINE REPLIES (${cats.replies.length}) ---`);
    cats.replies.forEach(printMsg);
  }

  if (cats.outOfOffice.length) {
    console.log(`--- OUT OF OFFICE (${cats.outOfOffice.length}) ---`);
    cats.outOfOffice.forEach(printMsg);
  }

  if (cats.other.length) {
    console.log(`--- OTHER (${cats.other.length}) ---`);
    cats.other.forEach(printMsg);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
