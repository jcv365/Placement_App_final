import { extractMessageContent } from "@/lib/aiUtils";
import { requireAiGatewayConfig, resolveAiGatewayModel } from "@/lib/liteLlm";

type GenerateStructuredJsonParams = {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
};

const MAX_JSON_ATTEMPTS = 2;

const DEFAULT_AI_REQUEST_TIMEOUT_MS = 180_000;

export function getAiRequestTimeoutMs(): number {
  const fromEnv = Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv >= 10_000) {
    return fromEnv;
  }

  return DEFAULT_AI_REQUEST_TIMEOUT_MS;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`AI request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractJsonSegment(raw: string): string {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  if (!withoutFence.includes("{")) {
    return withoutFence;
  }

  return withoutFence.slice(
    withoutFence.indexOf("{"),
    withoutFence.lastIndexOf("}") + 1,
  );
}

async function generateJsonWithGateway<T>(
  params: GenerateStructuredJsonParams,
): Promise<T> {
  const { apiBase, apiKey } = requireAiGatewayConfig(
    "AI JSON generation is not configured",
  );
  // Allow callers to supply an explicit model via params (extendable)
  // For now keep backward compatibility by checking an optional field.
  const modelOverride = (params as Record<string, unknown>).model as
    | string
    | undefined;
  const model = resolveAiGatewayModel(modelOverride);

  const timeoutMs = getAiRequestTimeoutMs();

  const response = await fetchWithTimeout(
    `${apiBase}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userPrompt },
        ],
        temperature: params.temperature ?? 0,
        max_tokens: params.maxTokens ?? 16384,
      }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    throw new Error(
      `LiteLLM structured request failed: ${response.status} ${await response.text()}`,
    );
  }

  const rawResponse = (await response.json()) as unknown;
  const responseDump = JSON.stringify(rawResponse).slice(0, 2000);
  const content = extractMessageContent(rawResponse);
  if (!content) {
    throw new Error(
      `LiteLLM structured request returned empty content. Raw: ${responseDump}`,
    );
  }

  const segment = extractJsonSegment(content);
  try {
    return JSON.parse(segment) as T;
  } catch (firstErr) {
    // Attempt simple repairs
    let repaired = segment
      // replace smart quotes
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      // remove trailing commas before } or ]
      .replace(/,\s*(}|\])/g, "$1")
      // remove non-printable control characters
      .replace(/[\x00-\x1F\x7F]/g, "");

    // Try extracting first {...} again
    if (!repaired.includes("{")) {
      repaired = segment;
    }

    try {
      return JSON.parse(repaired) as T;
    } catch {
      // Final attempt: ask the model once more to return valid JSON only.
      const { apiBase, apiKey } = requireAiGatewayConfig(
        "AI JSON generation is not configured",
      );
      const retrySystem =
        "You MUST return valid JSON only. Do not include any surrounding text or explanation. Fix any malformed JSON from the previous response and output the corrected JSON now.";
      // Try a limited number of retries asking the model to return valid JSON.
      for (let attempt = 0; attempt < MAX_JSON_ATTEMPTS; attempt += 1) {
        const retryResponse = await fetchWithTimeout(
          `${apiBase}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: retrySystem },
                {
                  role: "user",
                  content:
                    "Previous model response was invalid JSON. Return fixed JSON for: \n\n" +
                    params.userPrompt,
                },
              ],
              temperature: 0,
              max_tokens: params.maxTokens ?? 16384,
            }),
          },
          getAiRequestTimeoutMs(),
        );

        if (!retryResponse.ok) {
          const txt = await retryResponse.text().catch(() => "(no body)");
          throw new Error(
            `LiteLLM structured retry failed: ${retryResponse.status} ${txt}`,
          );
        }

        const retryRaw = (await retryResponse.json()) as unknown;
        const retryDump = JSON.stringify(retryRaw).slice(0, 2000);
        const retryContent = extractMessageContent(retryRaw);
        if (!retryContent) {
          // continue to next attempt
          if (attempt === MAX_JSON_ATTEMPTS - 1) {
            throw new Error(
              `LiteLLM structured retry returned empty content. Raw: ${retryDump}`,
            );
          }
          continue;
        }

        const retrySegment = extractJsonSegment(retryContent);
        try {
          return JSON.parse(retrySegment) as T;
        } catch (finalErr) {
          if (attempt === MAX_JSON_ATTEMPTS - 1) {
            throw new Error(
              `Failed to parse AI JSON response. FirstError: ${String(
                firstErr,
              )}; FinalError: ${String(finalErr)}; RawResponse: ${responseDump}; RetryRaw: ${retryDump}`,
            );
          }
          // otherwise try again
        }
      }
      throw new Error(
        `All JSON retry attempts exhausted. First error: ${String(firstErr)}`,
      );
    }
  }
}

export async function generateStructuredJson<T>(
  params: GenerateStructuredJsonParams,
): Promise<T> {
  return generateJsonWithGateway<T>(params);
}
