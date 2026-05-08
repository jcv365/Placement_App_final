import { getGraphAppAccessToken } from "@/lib/graph";

/**
 * Sends an existing Outlook draft by messageId from the shared mailbox.
 */
export async function sendDraftFromMailbox(
  mailbox: string,
  messageId: string,
): Promise<void> {
  const accessToken = await getGraphAppAccessToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${messageId}/send`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Length": "0",
    },
  });
  if (!response.ok) {
    const msg = await response.text();
    throw new Error(`[SEND_DRAFT] ${response.status} ${msg}`);
  }
}
