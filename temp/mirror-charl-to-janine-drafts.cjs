const SOURCE_MAILBOX = "charl.venter@dotcloud.africa";
const TARGET_MAILBOX = "janine.venter@dotcloud.africa";
const TARGET_COUNT = 61;

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

  if (!tenant || !clientId || !clientSecret) {
    throw new Error("Graph app credentials are not configured in runtime env");
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(
      `Token request failed: ${response.status} ${await response.text()}`,
    );
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("Token response did not include access_token");
  }

  return payload.access_token;
}

async function listLatestDrafts(mailbox, accessToken, top) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders('Drafts')/messages?$top=${top}&$orderby=createdDateTime%20desc&$select=id,subject,body,toRecipients,ccRecipients,bccRecipients,internetMessageId,createdDateTime`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Failed to list drafts for ${mailbox}: ${response.status} ${text}`,
    );
  }

  const payload = JSON.parse(text);
  return Array.isArray(payload.value) ? payload.value : [];
}

function recipientArray(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => item?.emailAddress?.address)
    .filter(
      (address) => typeof address === "string" && address.trim().length > 0,
    )
    .map((address) => ({ emailAddress: { address: address.trim() } }));
}

function messageFingerprint(message) {
  const to = recipientArray(message.toRecipients)
    .map((x) => x.emailAddress.address.toLowerCase())
    .sort()
    .join(";");
  const subject = (message.subject || "").trim().toLowerCase();
  return `${subject}::${to}`;
}

async function createDraftInMailbox(mailbox, accessToken, source) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages`;
  const payload = {
    subject: source.subject || "",
    body: source.body || { contentType: "HTML", content: "" },
    toRecipients: recipientArray(source.toRecipients),
    ccRecipients: recipientArray(source.ccRecipients),
    bccRecipients: recipientArray(source.bccRecipients),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Create draft failed (${response.status}): ${text}`);
  }

  return JSON.parse(text);
}

async function main() {
  const accessToken = await getGraphAppAccessToken();

  const sourceDrafts = await listLatestDrafts(
    SOURCE_MAILBOX,
    accessToken,
    TARGET_COUNT + 10,
  );
  const targetDrafts = await listLatestDrafts(TARGET_MAILBOX, accessToken, 300);

  const sourceTop = sourceDrafts.slice(0, TARGET_COUNT);
  const targetFingerprints = new Set(targetDrafts.map(messageFingerprint));

  let created = 0;
  let skippedAlreadyPresent = 0;
  const failures = [];

  for (const draft of sourceTop) {
    const fp = messageFingerprint(draft);
    if (targetFingerprints.has(fp)) {
      skippedAlreadyPresent += 1;
      continue;
    }

    try {
      await createDraftInMailbox(TARGET_MAILBOX, accessToken, draft);
      created += 1;
      targetFingerprints.add(fp);
    } catch (error) {
      failures.push({
        sourceId: draft.id,
        subject: draft.subject,
        error: String(error?.message || error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        sourceMailbox: SOURCE_MAILBOX,
        targetMailbox: TARGET_MAILBOX,
        requestedMirrorCount: TARGET_COUNT,
        sourceAvailable: sourceDrafts.length,
        sourceConsidered: sourceTop.length,
        targetPreExistingChecked: targetDrafts.length,
        created,
        skippedAlreadyPresent,
        failed: failures.length,
        failSamples: failures.slice(0, 10),
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
