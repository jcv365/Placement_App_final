/**
 * Check how many of the 649 remaining DB drafts still have Outlook drafts
 * vs how many were incorrectly deleted.
 */
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
  const payload = await response.json();
  return payload.access_token;
}

async function main() {
  const token = await getAccessToken();

  // Count remaining Outlook drafts
  let allDrafts = [];
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/drafts/messages?$select=id,subject&$top=200`;
  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`List error: ${response.status}`);
    const data = await response.json();
    allDrafts = allDrafts.concat(data.value || []);
    url = data["@odata.nextLink"] || null;
  }

  console.log(`Remaining Outlook drafts: ${allDrafts.length}`);
  console.log(`Remaining DB drafts: 649`);
  console.log(`Outlook drafts deleted: 383`);
  console.log(
    `Expected remaining Outlook drafts (if all 649 had Outlook drafts): ~649`,
  );
  console.log(`Missing Outlook drafts: ${649 - allDrafts.length}`);

  // Show some sample remaining Outlook drafts
  console.log("\nSample remaining Outlook drafts:");
  for (const d of allDrafts.slice(0, 5)) {
    console.log(`  - ${d.subject}`);
  }
}

main().catch((e) => console.error(e));
