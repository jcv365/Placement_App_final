// Delete all Outlook drafts that have NO attachments
// Then we'll call /api/email/repair-drafts to recreate them WITH CVs
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
  if (!data.access_token) throw new Error("No token: " + JSON.stringify(data));
  return data.access_token;
}

async function main() {
  const mailbox =
    process.env.OUTLOOK_SHARED_MAILBOX ||
    process.env.GRAPH_SENDER_USER ||
    "placements@dotcloud.africa";
  const token = await getGraphToken();
  console.log("Token obtained.");

  // Fetch all drafts with their attachments info
  let allDrafts = [];
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/drafts/messages?$select=id,subject,hasAttachments&$top=999`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok)
      throw new Error("Failed to fetch drafts: " + (await res.text()));
    const data = await res.json();
    allDrafts.push(...(data.value || []));
    url = data["@odata.nextLink"] || null;
  }

  console.log(`Total drafts in folder: ${allDrafts.length}`);

  // Filter to drafts WITHOUT attachments
  const draftsWithoutAttachments = allDrafts.filter((d) => !d.hasAttachments);
  console.log(`Drafts without attachments: ${draftsWithoutAttachments.length}`);

  // Delete them in batches
  let deleted = 0;
  let failed = 0;

  for (const draft of draftsWithoutAttachments) {
    try {
      const delRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${draft.id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      if (delRes.ok) {
        deleted++;
      } else {
        failed++;
        console.error(`Failed to delete "${draft.subject}": ${delRes.status}`);
      }
    } catch (e) {
      failed++;
      console.error(`Error deleting "${draft.subject}": ${e.message}`);
    }
    // Rate limit: 4 requests per second max
    if ((deleted + failed) % 4 === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`\nDeleted: ${deleted}, Failed: ${failed}`);
  console.log(
    `Remaining drafts (with attachments): ${allDrafts.length - draftsWithoutAttachments.length}`,
  );

  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
