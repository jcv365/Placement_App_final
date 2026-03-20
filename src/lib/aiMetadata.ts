type InferredMetadata = {
  roleTitle?: string;
  candidateName?: string;
};

type Provider = "github-models" | "azure-openai";

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
    const fromObject = (messageContent as { text?: string }).text;
    if (typeof fromObject === "string" && fromObject.trim()) {
      return fromObject;
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

function getAvailableProviders(): Provider[] {
  const hasGithub = Boolean(process.env.GITHUB_MODELS_TOKEN?.trim());
  if (hasGithub) return ["github-models"];
  return [];
}

async function inferWithGithubModels(
  systemPrompt: string,
  userPrompt: string,
  accessToken?: string,
): Promise<InferredMetadata> {
  const endpoint =
    process.env.GITHUB_MODELS_ENDPOINT ??
    "https://models.inference.ai.azure.com/chat/completions";
  const model = process.env.GITHUB_MODELS_MODEL?.trim() || "gpt-5.3";
  const token = (accessToken ?? process.env.GITHUB_MODELS_TOKEN) as string;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 500,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `GitHub Models inference error: ${response.status} ${message}`,
    );
  }

  const data = (await response.json()) as unknown;
  const content = extractMessageContent(data);
  if (!content) {
    throw new Error("GitHub Models inference returned empty content");
  }

  return parseInferenceJson(content);
}

async function inferWithAzureOpenAI(
  systemPrompt: string,
  userPrompt: string,
): Promise<InferredMetadata> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT as string;
  const apiKey = process.env.AZURE_OPENAI_API_KEY as string;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT as string;

  const response = await fetch(
    `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-06-01`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        temperature: 0,
        max_tokens: 500,
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
    throw new Error(
      `Azure OpenAI inference error: ${response.status} ${message}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Azure OpenAI inference returned empty content");
  }

  return parseInferenceJson(content);
}

export async function inferMetadataFromUploadedText(params: {
  jobText?: string;
  candidateText?: string;
  githubAccessToken?: string;
}): Promise<InferredMetadata> {
  const hasDirectGithubToken = Boolean(params.githubAccessToken?.trim());
  const providers = hasDirectGithubToken
    ? ([
        "github-models",
        ...getAvailableProviders().filter((p) => p !== "github-models"),
      ] as Provider[])
    : getAvailableProviders();

  if (providers.length === 0) {
    throw new Error(
      "AI metadata inference is not configured. Connect GitHub Models.",
    );
  }

  const systemPrompt =
    "Extract only reliable metadata from uploaded text. Return strict JSON with keys roleTitle and candidateName. If unknown, return empty string. Ignore greeting/application boilerplate, certification names, skills lists, and generic labels.";

  const userPrompt = `JOB TEXT:\n${params.jobText ?? ""}\n\nCANDIDATE TEXT:\n${params.candidateText ?? ""}\n\nRules:\n- roleTitle must be the actual role title only.\n- candidateName must be a person name only.\n- Never use lines like 'Thank you for applying' as a role title.\n- Never use certifications like CISM/CCIE as candidate name.\n\nReturn JSON only: { "roleTitle": "", "candidateName": "" }`;

  let lastError: string | undefined;

  for (const provider of providers) {
    try {
      if (provider === "github-models") {
        return await inferWithGithubModels(
          systemPrompt,
          userPrompt,
          params.githubAccessToken,
        );
      }

      return await inferWithAzureOpenAI(systemPrompt, userPrompt);
    } catch (error) {
      lastError = (error as Error).message;
    }
  }

  throw new Error(lastError ?? "AI metadata inference failed");
}
