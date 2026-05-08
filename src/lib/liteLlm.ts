type AiGatewayConfig = {
  apiBase: string;
  apiKey: string;
};

function readTrimmed(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readFirstTrimmed(...names: string[]): string | undefined {
  for (const name of names) {
    const value = readTrimmed(name);
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function resolveAiGatewayConfig(): AiGatewayConfig | null {
  const apiBase = readFirstTrimmed("LITELLM_API_BASE", "OPENAI_API_BASE");
  const apiKey = readFirstTrimmed("LITELLM_API_KEY", "OPENAI_API_KEY");

  if (apiBase && apiKey) {
    return {
      apiBase: apiBase.replace(/\/$/, ""),
      apiKey,
    };
  }

  return null;
}

export function isAiGatewayConfigured(): boolean {
  return resolveAiGatewayConfig() !== null;
}

export function requireAiGatewayConfig(errorContext: string): AiGatewayConfig {
  const config = resolveAiGatewayConfig();
  if (!config) {
    throw new Error(`${errorContext}. ${getAiGatewayEnvHint()}`);
  }

  return config;
}

export function getAiGatewayEnvHint(): string {
  return "Set LITELLM_API_BASE and LITELLM_API_KEY (or OPENAI_API_BASE and OPENAI_API_KEY) in the app environment.";
}

export function resolveAiGatewayModel(modelOverride?: string): string {
  // If a caller provided an explicit model, prefer that.
  if (
    modelOverride &&
    typeof modelOverride === "string" &&
    modelOverride.length > 0
  ) {
    return modelOverride;
  }

  // Prefer explicit env model (e.g. "LITELLM_MODEL" or "OPENAI_MODEL").
  const explicit = readFirstTrimmed("LITELLM_MODEL", "OPENAI_MODEL");
  if (explicit) return explicit;

  // Default to the auto router if nothing else provided.
  return "auto";
}
