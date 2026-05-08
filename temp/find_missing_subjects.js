// Find the 59 missing drafts by comparing subjects more carefully
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
  const subjects = new Set();
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/${folderName}/messages?$select=subject&$top=999`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    for (const msg of data.value || []) {
      if (msg.subject) subjects.add(msg.subject.trim());
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
  const allOutlookSubjects = new Set([...draftSubjects, ...sentSubjects]);

  const dbDrafts = await p.emailDraft.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: {
      subject: true,
      application: { select: { jobId: true, candidateId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Deduplicate
  const pairMap = new Map();
  for (const d of dbDrafts) {
    const key = `${d.application.jobId}::${d.application.candidateId}`;
    if (!pairMap.has(key)) pairMap.set(key, d);
  }
  const dbPairs = [...pairMap.values()];

  const missing = dbPairs.filter(
    (d) => !allOutlookSubjects.has(d.subject?.trim() ?? ""),
  );
  console.log(`Missing from Outlook: ${missing.length}`);

  missing.slice(0, 20).forEach((d) => {
    console.log(`  - "${d.subject?.trim()}"`);
  });

  await p.$disconnect();
}

main().catch((e) => console.error(e));
