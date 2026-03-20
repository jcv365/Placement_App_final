export type StructuredAiProvider = "github-models" | "azure-openai";

type GenerateStructuredJsonParams = {
  provider: StructuredAiProvider;
  systemPrompt: string;
  userPrompt: string;
  githubAccessToken?: string;
  maxTokens?: number;
  temperature?: number;
};

const MAX_RATE_LIMIT_RETRY_WAIT_SECONDS = 75;
const DEFAULT_AI_REQUEST_TIMEOUT_MS = 180_000;

function getAiRequestTimeoutMs(): number {
  const fromEnv = Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv >= 10_000) {
    return fromEnv;
  }

  return DEFAULT_AI_REQUEST_TIMEOUT_MS;
}

async function fetchWithTimeout(
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRateLimitWaitSeconds(
  message: string,
  retryAfterHeader: string | null,
): number | undefined {
  const fromHeader = Number.parseInt(retryAfterHeader ?? "", 10);
  if (Number.isFinite(fromHeader) && fromHeader > 0) {
    return fromHeader;
  }

  const fromBody = message.match(/wait\s+(\d+)\s+seconds?/i)?.[1];
  if (!fromBody) {
    return undefined;
  }

  const parsed = Number.parseInt(fromBody, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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

function extractMessageContent(data: unknown): string | undefined {
  const payload = data as {
    output_text?: string;
    choices?: Array<{
      text?: string;
      message?: {
        content?:
          | string
          | { text?: string }
          | Array<{ text?: string; content?: string; value?: string }>;
      };
    }>;
  };

  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const firstChoice = payload?.choices?.[0];
  if (!firstChoice) return undefined;

  if (typeof firstChoice.text === "string" && firstChoice.text.trim()) {
    return firstChoice.text;
  }

  const messageContent = firstChoice.message?.content;
  if (typeof messageContent === "string" && messageContent.trim()) {
    return messageContent;
  }

  if (
    messageContent &&
    typeof messageContent === "object" &&
    !Array.isArray(messageContent)
  ) {
    const textValue = (messageContent as { text?: string }).text;
    if (typeof textValue === "string" && textValue.trim()) {
      return textValue;
    }
  }

  if (Array.isArray(messageContent)) {
    const merged = messageContent
      .map((part) => part?.text ?? part?.content ?? part?.value ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();
    return merged || undefined;
  }

  return undefined;
}

function getGithubModelCandidates(preferredModel?: string): string[] {
  const base = preferredModel?.trim() || "gpt-5.3";
  const withoutProvider = base.includes("/") ? base.split("/").pop() : base;

  const candidates = [
    base,
    withoutProvider,
    withoutProvider ? `openai/${withoutProvider}` : undefined,
    "gpt-5.3",
    "openai/gpt-5.3",
    // Prefer a lower-cost fallback before dropping to older families.
    "gpt-5.1",
    "openai/gpt-5.1",
    "gpt-5",
    "openai/gpt-5",
    "gpt-4.1",
    "openai/gpt-4.1",
    "gpt-4o",
    "openai/gpt-4o",
  ].filter(Boolean) as string[];

  return Array.from(new Set(candidates));
}

async function generateJsonWithGithub<T>(
  params: GenerateStructuredJsonParams,
): Promise<T> {
  const accessToken =
    params.githubAccessToken?.trim() || process.env.GITHUB_MODELS_TOKEN?.trim();
  if (!accessToken) {
    throw new Error("GitHub Models token is missing");
  }

  const endpoint =
    process.env.GITHUB_MODELS_ENDPOINT ??
    "https://models.inference.ai.azure.com/chat/completions";
  const timeoutMs = getAiRequestTimeoutMs();
  const modelCandidates = getGithubModelCandidates(
    process.env.GITHUB_MODELS_MODEL,
  );

  let lastError = "GitHub Models structured request failed";
  let dailyQuotaHit = false;

  for (const model of modelCandidates) {
    const requestBody: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: params.maxTokens ?? 900,
    };

    if (typeof params.temperature === "number") {
      requestBody.temperature = params.temperature;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(requestBody),
        },
        timeoutMs,
      );

      if (!response.ok) {
        const message = await response.text();
        lastError = `GitHub Models structured request failed: ${response.status} ${message}`;

        if (/unknown model|model.*not found/i.test(message)) {
          break;
        }

        if (response.status === 429) {
          if (/UserByModelByDay|ByDay/i.test(message)) {
            dailyQuotaHit = true;
            // This is a per-model/day quota signal, so continue to fallback models.
            break;
          }

          const waitSeconds = parseRateLimitWaitSeconds(
            message,
            response.headers.get("retry-after"),
          );

          if (
            attempt < 1 &&
            waitSeconds !== undefined &&
            waitSeconds <= MAX_RATE_LIMIT_RETRY_WAIT_SECONDS
          ) {
            await sleep((waitSeconds + 1) * 1000);
            continue;
          }

          // Try another model candidate before failing hard.
          break;
        }

        throw new Error(lastError);
      }

      const content = extractMessageContent((await response.json()) as unknown);
      if (!content) {
        lastError = "GitHub Models structured request returned empty content";
        continue;
      }

      const parsed = JSON.parse(extractJsonSegment(content)) as T;
      return parsed;
    }
  }

  if (dailyQuotaHit) {
    throw new Error(
      "GitHub Models daily quota reached across candidate models (including GPT-5.1). Retry after quota reset or connect a different GitHub token.",
    );
  }

  throw new Error(lastError);
}

async function generateJsonWithAzure<T>(
  params: GenerateStructuredJsonParams,
): Promise<T> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  if (!endpoint || !apiKey || !deployment) {
    throw new Error("Azure OpenAI env vars are missing");
  }

  const timeoutMs = getAiRequestTimeoutMs();

  const response = await fetchWithTimeout(
    `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-06-01`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: params.temperature ?? 0,
        max_tokens: params.maxTokens ?? 900,
      }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    throw new Error(
      `Azure OpenAI structured request failed: ${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Azure OpenAI structured request returned empty content");
  }

  return JSON.parse(extractJsonSegment(content)) as T;
}

export async function generateStructuredJson<T>(
  params: GenerateStructuredJsonParams,
): Promise<T> {
  if (params.provider === "github-models") {
    return generateJsonWithGithub<T>(params);
  }

  return generateJsonWithAzure<T>(params);
}
