import { fetchWithTimeout, getAiRequestTimeoutMs } from "@/lib/aiJson";
import { extractMessageContent } from "@/lib/aiUtils";
import {
    isAiGatewayConfigured,
    requireAiGatewayConfig,
    resolveAiGatewayModel,
} from "@/lib/liteLlm";

type InferredMetadata = {
  roleTitle?: string;
  candidateName?: string;
};

function parseInferenceJson(raw: string): InferredMetadata {
  const trimmed = raw.trim();
  const normalised = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  const candidate = normalised.includes("{")
    ? normalised.slice(normalised.indexOf("{"), normalised.lastIndexOf("}") + 1)
    : normalised;

  const parsed = JSON.parse(candidate) as {
    roleTitle?: string;
    candidateName?: string;
  };

  const roleTitle = parsed.roleTitle?.trim();
  const candidateName = parsed.candidateName?.trim();

  return {
    roleTitle: roleTitle && roleTitle.length <= 90 ? roleTitle : undefined,
    candidateName:
      candidateName && candidateName.length <= 70 ? candidateName : undefined,
  };
}

function isGatewayConfigured(): boolean {
  return isAiGatewayConfigured();
}

async function inferWithGateway(
  systemPrompt: string,
  userPrompt: string,
  modelOverride?: string,
): Promise<InferredMetadata> {
  const { apiBase, apiKey } = requireAiGatewayConfig(
    "AI metadata inference is not configured",
  );
  const model = resolveAiGatewayModel(modelOverride);

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
        temperature: 0,
        max_tokens: 500,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    },
    getAiRequestTimeoutMs(),
  );

  if (!response.ok) {
    const message = await response.text().catch(() => "(no body)");
    throw new Error(`LiteLLM inference error: ${response.status} ${message}`);
  }

  const data = (await response.json()) as unknown;
  const dump = JSON.stringify(data).slice(0, 2000);
  const content = extractMessageContent(data);
  if (!content) {
    throw new Error(`LiteLLM inference returned empty content. Raw: ${dump}`);
  }

  return parseInferenceJson(content);
}

export async function inferMetadataFromUploadedText(params: {
  jobText?: string;
  candidateText?: string;
  model?: string;
}): Promise<InferredMetadata> {
  if (!isGatewayConfigured()) {
    throw new Error(
      "AI metadata inference is not configured. Set LITELLM_API_BASE and LITELLM_API_KEY in the app environment.",
    );
  }

  const systemPrompt =
    "Extract only reliable metadata from uploaded text. Return strict JSON with keys roleTitle and candidateName. If unknown, return empty string. Ignore greeting/application boilerplate, certification names, skills lists, and generic labels.";

  const userPrompt = `JOB TEXT:\n${params.jobText ?? ""}\n\nCANDIDATE TEXT:\n${params.candidateText ?? ""}\n\nRules:\n- roleTitle must be the actual role title only.\n- candidateName must be a person name only.\n- Never use lines like 'Thank you for applying' as a role title.\n- Never use certifications like CISM/CCIE as candidate name.\n\nReturn JSON only: { "roleTitle": "", "candidateName": "" }`;

  return inferWithGateway(systemPrompt, userPrompt, params.model);
}
