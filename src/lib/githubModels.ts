import { extractMessageContent } from "@/lib/aiUtils";
import { requireAiGatewayConfig, resolveAiGatewayModel } from "@/lib/liteLlm";
import { normaliseBritishEnglish } from "./britishEnglish";

type GenerateGithubEmailParams = {
  systemPrompt: string;
  userPrompt: string;
  accessToken?: string;
  maxOutputTokens?: number;
  model?: string;
};

type EmailResult = { subject: string; html: string };

import { sanitiseHtml } from "@/lib/sanitiseHtml";

function parseJsonResponse(raw: string): EmailResult {
  const trimmed = raw.trim();
  const normalised = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  let parsed: EmailResult | undefined;
  const jsonCandidate = normalised.includes("{")
    ? normalised.slice(normalised.indexOf("{"), normalised.lastIndexOf("}") + 1)
    : normalised;

  try {
    const candidate = JSON.parse(jsonCandidate) as Partial<EmailResult>;
    if (candidate?.subject && candidate?.html) {
      parsed = { subject: candidate.subject, html: candidate.html };
    }
  } catch {}

  if (!parsed) {
    const firstLine = normalised
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    parsed = {
      subject: firstLine
        ? firstLine.slice(0, 120)
        : "Candidate submission update",
      html: normalised.includes("<")
        ? normalised
        : `<p>${normalised.replace(/\n/g, "<br/>")}</p>`,
    };
  }

  return {
    subject: normaliseBritishEnglish(parsed.subject),
    html: sanitiseHtml(normaliseBritishEnglish(parsed.html)),
  };
}

export async function generateEmailViaGithubModels({
  systemPrompt,
  userPrompt,
  maxOutputTokens,
  model: modelOverride,
}: GenerateGithubEmailParams): Promise<EmailResult> {
  const { apiBase, apiKey } = requireAiGatewayConfig(
    "AI email generation is not configured",
  );
  const model = resolveAiGatewayModel(modelOverride);

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: maxOutputTokens ?? 1200,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `AI email generation failed: ${response.status} ${message}`,
    );
  }

  const data = (await response.json()) as unknown;
  const content = extractMessageContent(data);
  if (!content) {
    throw new Error("AI email generation returned empty content");
  }

  return parseJsonResponse(content);
}
