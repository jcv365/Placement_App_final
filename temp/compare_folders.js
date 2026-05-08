const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID;
const GRAPH_CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const MAILBOX = (
  process.env.OUTLOOK_SHARED_MAILBOX || "placements@dotcloud.africa"
)
  .trim()
  .toLowerCase();

async function getAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: GRAPH_CLIENT_ID,
    client_secret: GRAPH_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`Token error: ${response.status}`);
  return (await response.json()).access_token;
}

async function listMessages(accessToken, folder, select) {
  let all = [];
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/${folder}/messages?$select=${select}&$top=200`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`List ${folder} error: ${res.status}`);
    const data = await res.json();
    all = all.concat(data.value || []);
    url = data["@odata.nextLink"] || null;
  }
  return all;
}

async function main() {
  const token = await getAccessToken();

  // List drafts
  const drafts = await listMessages(token, "drafts", "subject,hasAttachments");
  console.log(`Drafts folder: ${drafts.length} messages`);
  const draftsWithAttach = drafts.filter((d) => d.hasAttachments).length;
  const draftsWithoutAttach = drafts.filter((d) => !d.hasAttachments).length;
  console.log(`  With attachments: ${draftsWithAttach}`);
  console.log(`  Without attachments: ${draftsWithoutAttach}`);

  // List sent items
  const sent = await listMessages(token, "sentitems", "subject,hasAttachments");
  console.log(`\nSent Items folder: ${sent.length} messages`);
  const sentWithAttach = sent.filter((s) => s.hasAttachments).length;
  const sentWithoutAttach = sent.filter((s) => !s.hasAttachments).length;
  console.log(`  With attachments: ${sentWithAttach}`);
  console.log(`  Without attachments: ${sentWithoutAttach}`);

  // Build subject sets for comparison
  const draftSubjects = new Set(
    drafts.map((d) => (d.subject || "").trim().toLowerCase()),
  );
  const sentSubjects = new Set(
    sent.map((s) => (s.subject || "").trim().toLowerCase()),
  );

  // DB drafts
  const dbDrafts = await p.emailDraft.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: { subject: true },
  });
  const dbSubjects = new Set(
    dbDrafts.map((d) => (d.subject || "").trim().toLowerCase()),
  );
  console.log(`\nDB EmailDraft records: ${dbDrafts.length}`);

  // Cross-reference
  const inDraftsOnly = [...dbSubjects].filter(
    (s) => draftSubjects.has(s) && !sentSubjects.has(s),
  );
  const inSentOnly = [...dbSubjects].filter(
    (s) => sentSubjects.has(s) && !draftSubjects.has(s),
  );
  const inBoth = [...dbSubjects].filter(
    (s) => draftSubjects.has(s) && sentSubjects.has(s),
  );
  const inNeither = [...dbSubjects].filter(
    (s) => !draftSubjects.has(s) && !sentSubjects.has(s),
  );

  console.log(`\nDB drafts cross-reference:`);
  console.log(`  In Drafts only: ${inDraftsOnly.length}`);
  console.log(`  In Sent only: ${inSentOnly.length}`);
  console.log(`  In both Drafts & Sent: ${inBoth.length}`);
  console.log(`  In neither (missing!): ${inNeither.length}`);

  if (inNeither.length > 0) {
    console.log(`\n  Missing from both folders (sample):`);
    for (const s of inNeither.slice(0, 10)) {
      console.log(`    - "${s}"`);
    }
  }

  // Drafts missing attachments that are NOT in Sent (still need fixing)
  const draftsNeedingAttach = drafts.filter((d) => {
    const key = (d.subject || "").trim().toLowerCase();
    return !d.hasAttachments && dbSubjects.has(key);
  });
  console.log(
    `\nDrafts still missing attachments (and in DB): ${draftsNeedingAttach.length}`,
  );

  await p.$disconnect();
}
main().catch((e) => console.error(e));
