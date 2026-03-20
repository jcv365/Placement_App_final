import { generateEmailViaCopilotStudio } from "@/lib/copilotStudio";
import { normaliseBritishEnglish } from "./britishEnglish";
import { EMAIL_SYSTEM_PROMPT } from "./prompts";

type GenerateEmailParams = {
  systemPrompt?: string;
  userPrompt: string;
  maxOutputTokens?: number;
};

type EmailResult = { subject: string; html: string };

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

function sanitiseHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/ on\w+="[^"]*"/gi, "");
}

function parseJsonResponse(raw: string): EmailResult {
  const parsed = JSON.parse(raw) as EmailResult;
  if (!parsed?.subject || !parsed?.html) {
    throw new Error("LLM response missing subject or html");
  }
  return {
    subject: normaliseBritishEnglish(parsed.subject),
    html: sanitiseHtml(normaliseBritishEnglish(parsed.html)),
  };
}

export async function generateEmail({
  systemPrompt = EMAIL_SYSTEM_PROMPT(),
  userPrompt,
  maxOutputTokens,
}: GenerateEmailParams): Promise<EmailResult> {
  if (process.env.USE_COPILOT_STUDIO === "true") {
    return generateEmailViaCopilotStudio({ systemPrompt, userPrompt });
  }

  const endpoint = getEnv("AZURE_OPENAI_ENDPOINT");
  const apiKey = getEnv("AZURE_OPENAI_API_KEY");
  const deployment = getEnv("AZURE_OPENAI_DEPLOYMENT");

  const response = await fetch(
    `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-06-01`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        temperature: 0.3,
        max_tokens: maxOutputTokens ?? 1200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Azure OpenAI error: ${response.status} ${message}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Azure OpenAI returned empty content");
  }

  return parseJsonResponse(content);
}
