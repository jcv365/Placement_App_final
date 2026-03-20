import { normaliseBritishEnglish } from "./britishEnglish";

type GenerateGithubEmailParams = {
  systemPrompt: string;
  userPrompt: string;
  accessToken: string;
  maxOutputTokens?: number;
};

type EmailResult = { subject: string; html: string };

const MAX_RATE_LIMIT_RETRY_WAIT_SECONDS = 90;
const MIN_REQUEST_INTERVAL_MS = 61_000;

let githubModelsNextAllowedAt = 0;

function sanitiseHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/ on\w+="[^"]*"/gi, "");
}

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

function extractMessageContent(data: unknown): string | undefined {
  const payload = data as {
    output_text?: string;
    choices?: Array<{
      text?: string;
      message?: {
        content?:
          | string
          | {
              text?: string;
            }
          | Array<{
              type?: string;
              text?: string;
              content?: string;
              value?: string;
            }>;
      };
    }>;
  };

  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const firstChoice = payload?.choices?.[0];
  if (!firstChoice) {
    return undefined;
  }

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
    const fromObject = (messageContent as { text?: string }).text;
    if (typeof fromObject === "string" && fromObject.trim()) {
      return fromObject;
    }
  }

  if (Array.isArray(messageContent)) {
    const merged = messageContent
      .map((part) => {
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        if (typeof part?.value === "string") return part.value;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();

    return merged || undefined;
  }

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGithubModelsSlot() {
  const now = Date.now();
  if (githubModelsNextAllowedAt <= now) {
    return;
  }

  await sleep(githubModelsNextAllowedAt - now);
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

function getModelCandidates(preferredModel?: string): string[] {
  const preferred = (preferredModel ?? "").trim();
  const preferredWithoutProvider = preferred.includes("/")
    ? (preferred.split("/").pop() ?? "")
    : preferred;

  const preferredIsFiveThree =
    preferred === "gpt-5.3" ||
    preferred === "openai/gpt-5.3" ||
    preferredWithoutProvider === "gpt-5.3";

  const preferredIsFiveOne =
    preferred === "gpt-5.1" ||
    preferred === "openai/gpt-5.1" ||
    preferredWithoutProvider === "gpt-5.1";

  const candidates = [
    // Always try 5.3 first.
    "gpt-5.3",
    "openai/gpt-5.3",
    preferredIsFiveThree ? preferred : "",
    // Use 5.1 only as fallback after 5.3 fails.
    "gpt-5.1",
    "openai/gpt-5.1",
    preferredIsFiveOne ? preferred : "",
  ].filter(Boolean) as string[];

  return Array.from(new Set(candidates));
}

export async function generateEmailViaGithubModels({
  systemPrompt,
  userPrompt,
  accessToken,
  maxOutputTokens,
}: GenerateGithubEmailParams): Promise<EmailResult> {
  const endpoint =
    process.env.GITHUB_MODELS_ENDPOINT ??
    "https://models.inference.ai.azure.com/chat/completions";
  const modelCandidates = getModelCandidates(process.env.GITHUB_MODELS_MODEL);

  let lastError = "GitHub Models request failed";
  let usedRateLimitRetry = false;
  let sawDailyModelLimit = false;

  for (const model of modelCandidates) {
    let skipToNextModel = false;
    const tokenParamVariants = ["max_completion_tokens", "max_tokens"] as const;
    const temperatureVariants = [0.3, undefined] as const;

    for (const tokenParam of tokenParamVariants) {
      if (skipToNextModel) {
        break;
      }

      for (const temperature of temperatureVariants) {
        if (skipToNextModel) {
          break;
        }

        const requestBody: Record<string, unknown> = {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
        };
        requestBody[tokenParam] = maxOutputTokens ?? 1200;
        if (temperature !== undefined) {
          requestBody.temperature = temperature;
        }

        for (let attempt = 0; attempt < 2; attempt += 1) {
          await waitForGithubModelsSlot();

          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const message = await response.text();
            lastError = `GitHub Models error: ${response.status} ${message}`;

            if (response.status === 429) {
              if (/UserByModelByDay|ByDay/i.test(message)) {
                sawDailyModelLimit = true;
                lastError = `GitHub Models daily request limit reached for model '${model}'`;
                skipToNextModel = true;
                break;
              }

              const waitSeconds = parseRateLimitWaitSeconds(
                message,
                response.headers.get("retry-after"),
              );

              if (
                attempt < 1 &&
                !usedRateLimitRetry &&
                waitSeconds !== undefined &&
                waitSeconds <= MAX_RATE_LIMIT_RETRY_WAIT_SECONDS
              ) {
                usedRateLimitRetry = true;
                githubModelsNextAllowedAt = Math.max(
                  githubModelsNextAllowedAt,
                  Date.now() + (waitSeconds + 1) * 1000,
                );
                continue;
              }

              throw new Error(lastError);
            }

            if (/unknown model|model.*not found/i.test(message)) {
              break;
            }

            if (/unsupported parameter|unsupported value/i.test(message)) {
              continue;
            }

            throw new Error(lastError);
          }

          const data = (await response.json()) as unknown;

          const content = extractMessageContent(data);
          if (!content) {
            throw new Error("GitHub Models returned empty content");
          }

          githubModelsNextAllowedAt = Math.max(
            githubModelsNextAllowedAt,
            Date.now() + MIN_REQUEST_INTERVAL_MS,
          );

          return parseJsonResponse(content);
        }
      }
    }
  }

  if (sawDailyModelLimit) {
    throw new Error(
      `GitHub Models daily request limit reached for available fallback models. Tried models: ${modelCandidates.join(
        ", ",
      )}`,
    );
  }

  throw new Error(`${lastError}. Tried models: ${modelCandidates.join(", ")}`);
}
