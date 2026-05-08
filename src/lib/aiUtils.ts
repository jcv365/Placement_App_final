/**
 * Extract the text content from a chat completion or responses API payload.
 * Handles OpenAI-compatible response shapes returned through LiteLLM.
 *
 * Reasoning models (e.g. deepseek-r1, glm) put chain-of-thought in a
 * "reasoning" field and the actual output in "content".  When content is
 * empty and finish_reason is "length", the model ran out of tokens during
 * its thinking phase — we return undefined so callers can retry with more
 * tokens.  When content is empty but finish_reason is NOT "length", we
 * fall back to the reasoning field (some model configs put output there).
 */
export function extractMessageContent(data: unknown): string | undefined {
  const payload = data as {
    output_text?: string;
    choices?: Array<{
      text?: string;
      finish_reason?: string;
      message?: {
        content?:
          | string
          | { text?: string }
          | Array<{ text?: string; content?: string; value?: string }>;
        reasoning?: string;
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
  const contentString =
    typeof messageContent === "string" && messageContent.trim()
      ? messageContent.trim()
      : undefined;

  // If content is present, return it directly.
  if (contentString) return contentString;

  // Content is empty — check if this is a reasoning model that ran out of tokens.
  const reasoning = firstChoice.message?.reasoning?.trim();
  const finishReason = firstChoice.finish_reason;

  if (!contentString && finishReason === "length") {
    // Model exhausted tokens during reasoning phase — reasoning field contains
    // incomplete thoughts, not usable output.  Return undefined so the caller
    // can retry with a larger token budget.
    return undefined;
  }

  // Content empty but not truncated — fall back to reasoning if available
  // (some model configurations put the actual output there).
  if (reasoning) return reasoning;

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
