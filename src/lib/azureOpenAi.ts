import { normaliseBritishEnglish } from "./britishEnglish";
import { requireAiGatewayConfig, resolveAiGatewayModel } from "./liteLlm";
import { EMAIL_SYSTEM_PROMPT } from "./prompts";

type GenerateEmailParams = {
  systemPrompt?: string;
  userPrompt: string;
  maxOutputTokens?: number;
  model?: string;
};

type EmailResult = { subject: string; html: string };

import { fetchWithTimeout, getAiRequestTimeoutMs } from "@/lib/aiJson";
import { sanitiseHtml } from "@/lib/sanitiseHtml";

function extractJsonSegment(raw: string): string {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  if (!withoutFence.includes("{")) return withoutFence;
  const segment = withoutFence.slice(
    withoutFence.indexOf("{"),
    withoutFence.lastIndexOf("}") + 1,
  );
  // Strip control characters (0x00–0x1F except tab/line-feed/carriage-return)
  // that some local models inject inside JSON string values, breaking
  // JSON.parse.  Keep \t \n \r which are valid in JSON strings when escaped.
  return segment.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

function plainTextToEmailResult(raw: string): EmailResult | null {
  const lines = raw.split(/\r?\n/);
  let subject = "";
  let bodyStart = 0;

  // Look for "Subject: ..." as the first non-empty line or within MIME-style headers.
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim();
    const subjectMatch = line.match(/^Subject:\s*(.+)$/i);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
      bodyStart = i + 1;
      break;
    }
  }

  if (!subject) return null;

  // Skip blank lines after the subject line.
  while (bodyStart < lines.length && !lines[bodyStart]?.trim()) {
    bodyStart++;
  }

  const bodyLines = lines.slice(bodyStart);
  if (!bodyLines.length) return null;

  // Convert the plain-text body paragraphs into simple <p> HTML.
  const html = bodyLines
    .reduce<string[]>((acc, line) => {
      const t = line.trim();
      if (t) {
        acc.push(`<p>${t}</p>`);
      }
      return acc;
    }, [])
    .join("\n");

  if (!html) return null;
  return { subject, html };
}

function parseJsonResponse(raw: string): EmailResult {
  // Primary path: try to extract and parse JSON.
  try {
    const parsed = JSON.parse(extractJsonSegment(raw)) as EmailResult;
    if (parsed?.subject && parsed?.html) {
      return {
        subject: normaliseBritishEnglish(parsed.subject),
        html: sanitiseHtml(normaliseBritishEnglish(parsed.html)),
      };
    }
  } catch {
    // Fall through to plain-text recovery below.
  }

  // Fallback: attempt to recover from a plain-text "Subject: ..." email format
  // returned by weaker fallback models that ignore JSON format instructions.
  const recovered = plainTextToEmailResult(raw);
  if (recovered) {
    return {
      subject: normaliseBritishEnglish(recovered.subject),
      html: sanitiseHtml(normaliseBritishEnglish(recovered.html)),
    };
  }

  throw new Error("LLM response missing subject or html");
}

export async function generateEmail({
  systemPrompt = EMAIL_SYSTEM_PROMPT(),
  userPrompt,
  maxOutputTokens,
  model: modelOverride,
}: GenerateEmailParams): Promise<EmailResult> {
  const { apiBase, apiKey } = requireAiGatewayConfig(
    "AI email generation is not configured",
  );
  const model = resolveAiGatewayModel(modelOverride);

  const response = await fetchWithTimeout(
    `${apiBase}/chat/completions`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: maxOutputTokens ?? 16384,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    },
    getAiRequestTimeoutMs(),
  );

  if (!response.ok) {
    const message = await response.text().catch(() => "(no body)");
    throw new Error(`LiteLLM gateway error: ${response.status} ${message}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const choices = data.choices as
    | {
        message?: { content?: string; reasoning?: string };
        finish_reason?: string;
      }[]
    | undefined;

  // Reasoning models (e.g. deepseek-r1, glm) put chain-of-thought in a
  // "reasoning" field and the actual output in "content".  When
  // finish_reason is "length" and content is empty, the model ran out of
  // tokens during its thinking phase — the reasoning field contains
  // incomplete thoughts, NOT the email JSON.  In that case we must NOT
  // fall back to reasoning; we need to retry with more tokens.
  const content = choices?.[0]?.message?.content?.trim() || "";
  const reasoning = choices?.[0]?.message?.reasoning?.trim() || "";
  const finishReason = choices?.[0]?.finish_reason;

  if (!content && finishReason === "length") {
    throw new Error(
      "LLM ran out of tokens during reasoning. Increase max_tokens or use a non-reasoning model.",
    );
  }

  // If content is empty but reasoning exists and finish_reason is NOT "length",
  // the model may have put its output in reasoning (some model configurations).
  const effectiveContent = content || reasoning;
  if (!effectiveContent) {
    throw new Error("LiteLLM gateway returned empty content");
  }

  return parseJsonResponse(effectiveContent);
}
