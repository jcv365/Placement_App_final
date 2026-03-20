import { normaliseBritishEnglish } from "./britishEnglish";

type GenerateEmailParams = {
  systemPrompt: string;
  userPrompt: string;
};

type EmailResult = { subject: string; html: string };

function sanitiseHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/ on\w+="[^"]*"/gi, "");
}

export async function generateEmailViaCopilotStudio({
  systemPrompt,
  userPrompt,
}: GenerateEmailParams): Promise<EmailResult> {
  const endpoint = process.env.COPILOT_STUDIO_ENDPOINT;
  const key = process.env.COPILOT_STUDIO_KEY;

  if (!endpoint || !key) {
    throw new Error("Missing Copilot Studio configuration");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      systemPrompt,
      userPrompt,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Copilot Studio error: ${response.status} ${message}`);
  }

  const raw = (await response.json()) as EmailResult;
  if (!raw?.subject || !raw?.html) {
    throw new Error("Copilot Studio response missing subject or html");
  }

  return {
    subject: normaliseBritishEnglish(raw.subject),
    html: sanitiseHtml(normaliseBritishEnglish(raw.html)),
  };
}
