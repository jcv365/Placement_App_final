type DraftParams = {
  accessToken: string;
  subject: string;
  htmlBody: string;
  to: string[];
  attachments?: GraphAttachment[];
};

type GraphAttachment = {
  filename: string;
  content?: string;
  contentBase64?: string;
  contentType?: string;
};

type SendGraphMailParams = {
  subject: string;
  text: string;
  to: string[];
  attachments?: GraphAttachment[];
};

type AppDraftParams = {
  mailbox: string;
  subject: string;
  htmlBody: string;
  to: string[];
  attachments?: GraphAttachment[];
};

const DEFAULT_GRAPH_SENDER_USER =
  process.env.GRAPH_SENDER_USER?.trim() ||
  process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
  "";

function getGraphTenantId(): string | null {
  return (
    process.env.GRAPH_TENANT_ID?.trim() ||
    process.env.NEXT_PUBLIC_AAD_TENANT_ID?.trim() ||
    null
  );
}

function getGraphClientId(): string | null {
  return (
    process.env.GRAPH_CLIENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_AAD_CLIENT_ID?.trim() ||
    null
  );
}

function getGraphClientSecret(): string | null {
  const secret = process.env.GRAPH_CLIENT_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

function getGraphSenderUser(): string | null {
  const configured = process.env.GRAPH_SENDER_USER?.trim();
  return configured && configured.length > 0
    ? configured
    : DEFAULT_GRAPH_SENDER_USER;
}

export function isGraphMailConfigured(): boolean {
  return Boolean(
    getGraphTenantId() &&
    getGraphClientId() &&
    getGraphClientSecret() &&
    getGraphSenderUser(),
  );
}

export async function getGraphAppAccessToken(): Promise<string> {
  const tenantId = getGraphTenantId();
  const clientId = getGraphClientId();
  const clientSecret = getGraphClientSecret();

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Graph app credentials are not configured");
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Graph token error: ${response.status} ${message}`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Graph token response did not include an access token");
  }

  return payload.access_token;
}

export async function sendGraphMail(
  params: SendGraphMailParams,
): Promise<void> {
  const senderUser = getGraphSenderUser();
  if (!senderUser) {
    throw new Error("Graph sender user is not configured");
  }

  const accessToken = await getGraphAppAccessToken();

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUser)}/sendMail`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message: {
          subject: params.subject,
          body: {
            contentType: "Text",
            content: params.text,
          },
          toRecipients: params.to.map((address) => ({
            emailAddress: { address },
          })),
          attachments: (params.attachments ?? []).map((attachment) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: attachment.filename,
            contentType: attachment.contentType ?? "text/plain",
            contentBytes:
              attachment.contentBase64 ??
              Buffer.from(attachment.content ?? "", "utf8").toString("base64"),
          })),
        },
        saveToSentItems: true,
      }),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Microsoft Graph sendMail error: ${response.status} ${message}`,
    );
  }
}

export async function createOutlookDraft({
  accessToken,
  subject,
  htmlBody,
  to,
  attachments,
}: DraftParams) {
  if (!accessToken) {
    const error = new Error("Missing access token");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }

  const response = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      subject,
      body: { contentType: "HTML", content: htmlBody },
      toRecipients: to.map((address) => ({ emailAddress: { address } })),
      attachments: (attachments ?? []).map((attachment) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: attachment.filename,
        contentType: attachment.contentType ?? "text/plain",
        contentBytes:
          attachment.contentBase64 ??
          Buffer.from(attachment.content ?? "", "utf8").toString("base64"),
      })),
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Microsoft Graph error: ${response.status} ${message}`);
  }

  return response.json();
}

export async function sendEmailForMailbox({
  mailbox,
  subject,
  htmlBody,
  to,
  attachments,
}: AppDraftParams): Promise<void> {
  const normalisedMailbox = mailbox.trim().toLowerCase();
  if (!normalisedMailbox) {
    throw new Error("Missing Outlook mailbox");
  }

  const accessToken = await getGraphAppAccessToken();
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(normalisedMailbox)}/sendMail`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: htmlBody },
          toRecipients: to.map((address) => ({ emailAddress: { address } })),
          attachments: (attachments ?? []).map((attachment) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: attachment.filename,
            contentType: attachment.contentType ?? "text/plain",
            contentBytes:
              attachment.contentBase64 ??
              Buffer.from(attachment.content ?? "", "utf8").toString("base64"),
          })),
        },
        saveToSentItems: true,
      }),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Microsoft Graph sendMail error: ${response.status} ${message}`,
    );
  }
}

export async function createOutlookDraftForMailbox({
  mailbox,
  subject,
  htmlBody,
  to,
  attachments,
}: AppDraftParams) {
  const normalisedMailbox = mailbox.trim().toLowerCase();
  if (!normalisedMailbox) {
    throw new Error("Missing Outlook mailbox");
  }

  const accessToken = await getGraphAppAccessToken();
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(normalisedMailbox)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        subject,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
        attachments: (attachments ?? []).map((attachment) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: attachment.filename,
          contentType: attachment.contentType ?? "text/plain",
          contentBytes:
            attachment.contentBase64 ??
            Buffer.from(attachment.content ?? "", "utf8").toString("base64"),
        })),
      }),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Microsoft Graph error: ${response.status} ${message}`);
  }

  return response.json();
}
