import { readSharedGithubAccessToken } from "@/lib/githubAuthStore";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

type ReadFileParams = {
  fileName?: string;
  mimeType?: string;
  bytes: ArrayBuffer;
};

type ExtractedDocumentText = {
  text?: string;
};

const MAX_AI_BASE64_BYTES = 120_000;

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

function normaliseText(value: string): string {
  return value
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function validateText(value: string | undefined): string | undefined {
  const cleaned = normaliseText(value ?? "");
  if (cleaned.length < 20) {
    return undefined;
  }

  const alphaNumericChars = cleaned.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const alphaNumericRatio = alphaNumericChars / cleaned.length;
  if (alphaNumericRatio <= 0.2) {
    return undefined;
  }

  return cleaned;
}

function inferFileKind(
  params: ReadFileParams,
): "pdf" | "docx" | "text" | "unknown" {
  const name = params.fileName?.toLowerCase() ?? "";
  const mime = params.mimeType?.toLowerCase() ?? "";

  if (mime.includes("pdf") || name.endsWith(".pdf")) {
    return "pdf";
  }

  if (mime.includes("wordprocessingml.document") || name.endsWith(".docx")) {
    return "docx";
  }

  if (
    mime.startsWith("text/") ||
    /\.(txt|md|csv|json|xml|html|htm)$/i.test(name)
  ) {
    return "text";
  }

  return "unknown";
}

async function extractTextLocally(
  params: ReadFileParams,
): Promise<string | undefined> {
  const kind = inferFileKind(params);
  const buffer = Buffer.from(params.bytes);

  try {
    if (kind === "text") {
      const decoded = new TextDecoder("utf-8").decode(
        new Uint8Array(params.bytes),
      );
      return validateText(decoded);
    }

    if (kind === "pdf") {
      const parsed = await pdfParse(buffer);
      return validateText(parsed.text);
    }

    if (kind === "docx") {
      const parsed = await mammoth.extractRawText({ buffer });
      return validateText(parsed.value);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function getModelCandidates(preferredModel?: string): string[] {
  const base = preferredModel?.trim() || "gpt-5.3";
  const withoutProvider = base.includes("/") ? base.split("/").pop() : base;

  const candidates = [
    base,
    withoutProvider,
    withoutProvider ? `openai/${withoutProvider}` : undefined,
    "gpt-5.3",
    "openai/gpt-5.3",
    "gpt-5",
    "openai/gpt-5",
  ].filter(Boolean) as string[];

  return Array.from(new Set(candidates));
}

function encodeForPrompt(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString("base64");
}

export async function readTextFromFile(
  params: ReadFileParams,
): Promise<string | undefined> {
  const localText = await extractTextLocally(params);
  if (localText) {
    return localText;
  }

  const accessToken =
    process.env.GITHUB_MODELS_TOKEN?.trim() ||
    (await readSharedGithubAccessToken())?.trim();
  if (!accessToken) {
    throw new Error(
      "AI extraction requires a GitHub Models token. Configure ChatGPT 5.3 access in Settings.",
    );
  }

  // Guardrail for prompt size because file bytes are sent as base64 text to the model.
  if (params.bytes.byteLength > MAX_AI_BASE64_BYTES) {
    throw new Error(
      "The uploaded file is too large for direct AI byte extraction. Upload a text-based PDF/DOCX or paste text directly.",
    );
  }

  const endpoint =
    process.env.GITHUB_MODELS_ENDPOINT ??
    "https://models.inference.ai.azure.com/chat/completions";
  const fileName = params.fileName ?? "uploaded-file";
  const mimeType = params.mimeType ?? "application/octet-stream";
  const base64Source = encodeForPrompt(params.bytes);

  const systemPrompt =
    "You are a document transcription assistant. Extract readable text from the supplied encoded file and return strict JSON with key text only. Preserve important line breaks and section headings. Do not summarise.";

  const userPrompt = `FILE NAME: ${fileName}\nMIME TYPE: ${mimeType}\nBASE64:\n${base64Source}\n\nReturn JSON only: {"text":""}`;

  let lastError = "ChatGPT extraction failed";
  const models = getModelCandidates(process.env.GITHUB_MODELS_MODEL);

  for (const model of models) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 3000,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      lastError = `ChatGPT extraction failed: ${response.status} ${message}`;
      if (/unknown model|model.*not found/i.test(message)) {
        continue;
      }
      throw new Error(lastError);
    }

    const content = extractMessageContent((await response.json()) as unknown);
    if (!content) {
      lastError = "ChatGPT extraction returned empty content";
      continue;
    }

    const parsed = JSON.parse(
      extractJsonSegment(content),
    ) as ExtractedDocumentText;
    const validated = validateText(parsed.text);
    if (validated) {
      return validated;
    }

    lastError = "ChatGPT extraction returned unusable text";
  }

  throw new Error(lastError);
}
