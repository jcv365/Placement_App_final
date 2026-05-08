// Quick check: count drafts with and without attachments
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

async function main() {
  const mailbox =
    process.env.OUTLOOK_SHARED_MAILBOX || "placements@dotcloud.africa";
  const token = await getGraphToken();

  let total = 0;
  let withAttachments = 0;
  let withoutAttachments = 0;
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/drafts/messages?$select=subject,hasAttachments&$top=999`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    for (const msg of data.value || []) {
      total++;
      if (msg.hasAttachments) withAttachments++;
      else withoutAttachments++;
    }
    url = data["@odata.nextLink"] || null;
  }

  console.log(`Total drafts: ${total}`);
  console.log(`With attachments: ${withAttachments}`);
  console.log(`Without attachments: ${withoutAttachments}`);
}

main().catch((e) => console.error(e));
