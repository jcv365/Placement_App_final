// Investigate the 63 missing DB drafts
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

function parseEmails(raw) {
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@") && s.includes("."));
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
      application: {
        select: {
          jobId: true,
          candidateId: true,
          job: {
            select: {
              title: true,
              opportunityEmail: true,
              requiresNonSaLocation: true,
              requiresUsWorkAuth: true,
            },
          },
          candidate: { select: { fullName: true } },
        },
      },
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

  // Categorise
  let noEmail = 0;
  let locationBlocked = 0;
  let usAuthBlocked = 0;
  let other = 0;

  for (const d of missing) {
    const emails = parseEmails(d.application.job.opportunityEmail);
    const isLocationBlocked = d.application.job.requiresNonSaLocation === true;
    const isUsAuth = d.application.job.requiresUsWorkAuth === true;

    if (emails.length === 0) {
      noEmail++;
    } else if (isLocationBlocked) {
      locationBlocked++;
    } else if (isUsAuth) {
      usAuthBlocked++;
    } else {
      other++;
    }
  }

  console.log(`  No opportunity email: ${noEmail}`);
  console.log(`  Location-restricted (should be blocked): ${locationBlocked}`);
  console.log(`  US work auth required: ${usAuthBlocked}`);
  console.log(`  Other (should have draft): ${other}`);

  if (other > 0) {
    console.log("\n  These 'other' drafts are genuinely missing:");
    missing
      .filter((d) => {
        const emails = parseEmails(d.application.job.opportunityEmail);
        return (
          emails.length > 0 &&
          d.application.job.requiresNonSaLocation !== true &&
          d.application.job.requiresUsWorkAuth !== true
        );
      })
      .forEach((d) => {
        console.log(
          `    - "${d.subject?.trim()}" → job: "${d.application.job.title}" → email: "${d.application.job.opportunityEmail}"`,
        );
      });
  }

  if (noEmail > 0) {
    console.log(`\n  No-email drafts (first 5):`);
    missing
      .filter(
        (d) => parseEmails(d.application.job.opportunityEmail).length === 0,
      )
      .slice(0, 5)
      .forEach((d) => {
        console.log(
          `    - "${d.subject?.trim()}" → job: "${d.application.job.title}"`,
        );
      });
  }

  if (locationBlocked > 0) {
    console.log(`\n  Location-blocked drafts (should be deleted from DB):`);
    missing
      .filter((d) => d.application.job.requiresNonSaLocation === true)
      .slice(0, 5)
      .forEach((d) => {
        console.log(
          `    - "${d.subject?.trim()}" → job: "${d.application.job.title}"`,
        );
      });
  }

  await p.$disconnect();
}

main().catch((e) => console.error(e));
