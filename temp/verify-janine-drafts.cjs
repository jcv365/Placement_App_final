const MAILBOX = "janine.venter@dotcloud.africa";

async function getGraphAppAccessToken() {
  const tenant = (
    process.env.GRAPH_TENANT_ID ||
    process.env.NEXT_PUBLIC_AAD_TENANT_ID ||
    ""
  ).trim();
  const clientId = (
    process.env.GRAPH_CLIENT_ID ||
    process.env.NEXT_PUBLIC_AAD_CLIENT_ID ||
    ""
  ).trim();
  const clientSecret = (process.env.GRAPH_CLIENT_SECRET || "").trim();

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );

  const payload = await response.json();
  return payload.access_token;
}

async function main() {
  const token = await getGraphAppAccessToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders('Drafts')/messages?$top=70&$orderby=createdDateTime%20desc&$select=id,createdDateTime,subject`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text);
  }

  const rows = JSON.parse(text).value || [];
  console.log(
    JSON.stringify(
      {
        mailbox: MAILBOX,
        fetched: rows.length,
        latest: rows[0]?.createdDateTime || null,
        oldestInWindow: rows[rows.length - 1]?.createdDateTime || null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
