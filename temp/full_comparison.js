// Full comparison: DB drafts vs Outlook drafts vs Sent Items
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function getGraphToken() {
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  const data = await res.json();
  return data.access_token;
}

async function fetchSubjectsFromFolder(token, mailbox, folderName) {
  const subjects = new Map(); // subject -> { hasAttachments }
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/${folderName}/messages?$select=subject,hasAttachments&$top=999`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    for (const msg of data.value || []) {
      if (msg.subject)
        subjects.set(msg.subject.trim(), {
          hasAttachments: msg.hasAttachments,
        });
    }
    url = data["@odata.nextLink"] || null;
  }
  return subjects;
}

async function main() {
  const mailbox =
    process.env.OUTLOOK_SHARED_MAILBOX || "placements@dotcloud.africa";
  const token = await getGraphToken();

  const [draftSubjects, sentSubjects] = await Promise.all([
    fetchSubjectsFromFolder(token, mailbox, "drafts"),
    fetchSubjectsFromFolder(token, mailbox, "sentitems"),
  ]);

  console.log(`Drafts: ${draftSubjects.size}`);
  let draftsWAtt = 0,
    draftsNoAtt = 0;
  for (const [subj, info] of draftSubjects) {
    if (info.hasAttachments) draftsWAtt++;
    else draftsNoAtt++;
  }
  console.log(`  With attachments: ${draftsWAtt}`);
  console.log(`  Without attachments: ${draftsNoAtt}`);

  console.log(`Sent Items: ${sentSubjects.size}`);
  let sentWAtt = 0,
    sentNoAtt = 0;
  for (const [subj, info] of sentSubjects) {
    if (info.hasAttachments) sentWAtt++;
    else sentNoAtt++;
  }
  console.log(`  With attachments: ${sentWAtt}`);
  console.log(`  Without attachments: ${sentNoAtt}`);

  // Cross-reference with DB
  const dbDrafts = await p.emailDraft.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: { subject: true },
    orderBy: { createdAt: "desc" },
  });

  // Deduplicate
  const dbSubjects = new Set(
    dbDrafts.map((d) => d.subject?.trim()).filter(Boolean),
  );
  console.log(`\nDB unique draft subjects: ${dbSubjects.size}`);

  let inDraftsOnly = 0,
    inSentOnly = 0,
    inBoth = 0,
    inNeither = 0;
  for (const subj of dbSubjects) {
    const inDrafts = draftSubjects.has(subj);
    const inSent = sentSubjects.has(subj);
    if (inDrafts && inSent) inBoth++;
    else if (inDrafts) inDraftsOnly++;
    else if (inSent) inSentOnly++;
    else inNeither++;
  }
  console.log(`In Drafts only: ${inDraftsOnly}`);
  console.log(`In Sent only: ${inSentOnly}`);
  console.log(`In both Drafts & Sent: ${inBoth}`);
  console.log(`In neither (missing!): ${inNeither}`);

  await p.$disconnect();
}

main().catch((e) => console.error(e));
