type CandidateProfile = {
  fullName?: string;
  email?: string;
  phone?: string;
  skills: string[];
  certifications: string[];
  suggestedRoles: string[];
};

type Provider = "github-models" | "azure-openai";
type PreferredProvider = "auto" | Provider | "copilot-studio";

const CV_PROMPT_BUDGETS = [12000, 8000, 5000] as const;

function getProfileSignalCount(profile: CandidateProfile): number {
  let signals = 0;
  if (profile.email) signals += 1;
  if (profile.phone) signals += 1;
  if (profile.skills.length > 0) signals += 1;
  if (profile.certifications.length > 0) signals += 1;
  if (profile.suggestedRoles.length > 0) signals += 1;
  return signals;
}

function scoreProfile(profile: CandidateProfile): number {
  const signalScore = getProfileSignalCount(profile) * 20;
  const skillsBonus = Math.min(profile.skills.length, 8) * 4;
  const certBonus = Math.min(profile.certifications.length, 5) * 3;
  const rolesBonus = Math.min(profile.suggestedRoles.length, 5) * 3;
  const contactBonus = (profile.email ? 6 : 0) + (profile.phone ? 6 : 0);
  return signalScore + skillsBonus + certBonus + rolesBonus + contactBonus;
}

function isProfileStrong(profile: CandidateProfile): boolean {
  const signals = getProfileSignalCount(profile);
  if (signals >= 3) {
    return true;
  }

  return (
    signals >= 2 &&
    (profile.skills.length >= 2 || profile.suggestedRoles.length >= 1) &&
    Boolean(profile.email || profile.phone)
  );
}

function buildExtractionPrompts(compactCvText: string): string[] {
  const basePrompt = `CV TEXT:\n${compactCvText}\n\nRules:\n- fullName must be the candidate's person name.\n- email must be a valid email when present.\n- phone must be a contact number when present.\n- skills should be specific technologies or domains only.\n- certifications should include recognised certifications and accreditation names only.\n- suggestedRoles must be derived from the extracted skills and extracted certifications only.\n- suggestedRoles must be specific role titles (no generic placeholders).\n- Do not use employer names, personal profile wording, or unrelated CV narrative to create roles.\nReturn JSON only: {"fullName":"","email":"","phone":"","skills":[],"certifications":[],"suggestedRoles":[]}`;

  const contactRecoveryPrompt = `CV TEXT:\n${compactCvText}\n\nRecovery focus:\n- Prioritise extracting contact and skills signal before anything else.\n- Prefer exact email/phone values from CV contact sections.\n- Include at least top technical skills when present.\n- Include certifications only if explicitly stated.\n- suggestedRoles must come from skills/certifications evidence only.\nReturn JSON only: {"fullName":"","email":"","phone":"","skills":[],"certifications":[],"suggestedRoles":[]}`;

  return [basePrompt, contactRecoveryPrompt];
}

function parseDelimitedList(value: string, maxItems: number): string[] {
  const parts = value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return cleanList(parts, maxItems);
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
    "gpt-5",
    "openai/gpt-5",
    "gpt-5-chat",
    "openai/gpt-5-chat",
    "gpt-4.1",
    "openai/gpt-4.1",
    "gpt-4.1-mini",
    "openai/gpt-4.1-mini",
    "gpt-4o",
    "openai/gpt-4o",
    "gpt-4o-mini",
    "openai/gpt-4o-mini",
  ].filter(Boolean) as string[];

  return Array.from(new Set(candidates));
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

function cleanList(values: string[] | undefined, maxItems: number): string[] {
  if (!values) {
    return [];
  }

  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const item = value.replace(/\s+/g, " ").trim();
    if (!item) continue;

    const key = item.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(item);

    if (output.length >= maxItems) {
      break;
    }
  }

  return output;
}

function compactCvTextForInference(cvText: string, maxChars: number): string {
  const cleaned = cvText
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= maxChars) {
    return cleaned;
  }

  const lines = cleaned
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const sectionHeadingPattern =
    /^(professional\s+summary|summary|profile|contact|skills?|technical\s+skills?|core\s+skills?|experience|employment\s+history|work\s+history|projects?|certifications?|education|tools?|technologies)$/i;
  const contactPattern =
    /@|\+?\d[\d\s\-()]{6,}|\b(email|phone|mobile|contact|linkedin)\b/i;
  const skillsPattern =
    /\b(skills?|technologies|tools?|stack|aws|azure|gcp|kubernetes|docker|terraform|python|java|typescript|react|node|sql|linux|network|security|devops|data)\b/i;
  const certPattern =
    /\b(certifications?|certified|iso\s?27001|cissp|cism|ccna|ccnp|aws\s+certified|azure\s+certified)\b/i;
  const experiencePattern =
    /\b(experience|employment|engineer|architect|consultant|manager|analyst|lead|project|delivered|implemented|designed|migrated)\b/i;

  const contact: string[] = [];
  const summary: string[] = [];
  const skills: string[] = [];
  const certifications: string[] = [];
  const experience: string[] = [];
  const fallback: string[] = [];
  const seen = new Set<string>();

  let activeSection = "";
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (sectionHeadingPattern.test(line) && line.length < 80) {
      activeSection = key;
      continue;
    }

    const looksContact = contactPattern.test(line) || /\bname\b/i.test(line);
    const looksSkills = skillsPattern.test(line);
    const looksCert = certPattern.test(line);
    const looksExperience = experiencePattern.test(line);
    const looksSummary = /\b(summary|profile|objective|about)\b/i.test(
      activeSection,
    );

    if (looksContact) {
      contact.push(line);
      continue;
    }

    if (looksCert || /\bcert/i.test(activeSection)) {
      certifications.push(line);
      continue;
    }

    if (looksSkills || /\bskills?|tools?|technolog/i.test(activeSection)) {
      skills.push(line);
      continue;
    }

    if (looksSummary) {
      summary.push(line);
      continue;
    }

    if (
      looksExperience ||
      /\bexperience|employment|projects?\b/i.test(activeSection)
    ) {
      experience.push(line);
      continue;
    }

    fallback.push(line);
  }

  const compose = (
    title: string,
    entries: string[],
    limitChars: number,
    hardCapItems: number,
  ): string => {
    const selected: string[] = [];
    let used = 0;

    for (const entry of entries) {
      if (selected.length >= hardCapItems) {
        break;
      }
      const size = entry.length + 2;
      if (used + size > limitChars && selected.length > 0) {
        break;
      }
      selected.push(entry);
      used += size;
    }

    if (selected.length === 0) {
      return "";
    }

    return `${title}:\n${selected.join("\n")}`;
  };

  const blocks = [
    compose("CONTACT SIGNALS", contact, Math.floor(maxChars * 0.12), 8),
    compose("PROFILE SIGNALS", summary, Math.floor(maxChars * 0.14), 8),
    compose("SKILLS SIGNALS", skills, Math.floor(maxChars * 0.2), 20),
    compose(
      "CERTIFICATION SIGNALS",
      certifications,
      Math.floor(maxChars * 0.12),
      10,
    ),
    compose("EXPERIENCE SIGNALS", experience, Math.floor(maxChars * 0.3), 24),
    compose("ADDITIONAL SIGNALS", fallback, Math.floor(maxChars * 0.12), 12),
  ].filter(Boolean);

  const packed = blocks.join("\n\n").trim();
  if (packed.length >= Math.floor(maxChars * 0.7)) {
    return packed.slice(0, maxChars).trim();
  }

  const head = cleaned.slice(0, Math.floor(maxChars * 0.5));
  const tail = cleaned.slice(-Math.floor(maxChars * 0.18));
  const blended = [packed, head, tail].filter(Boolean).join("\n\n");
  return blended.slice(0, maxChars).trim();
}

function isRequestTooLargeError(message: string): boolean {
  return /413|request body too large|max tokens|max size|tokens limit reached/i.test(
    message,
  );
}

function parseCandidateProfile(raw: string): CandidateProfile {
  const trimmed = raw.trim();
  const withoutCodeFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  const jsonSegment = withoutCodeFence.includes("{")
    ? withoutCodeFence.slice(
        withoutCodeFence.indexOf("{"),
        withoutCodeFence.lastIndexOf("}") + 1,
      )
    : withoutCodeFence;

  const parsed = JSON.parse(jsonSegment) as {
    fullName?: string;
    email?: string;
    phone?: string;
    skills?: string[];
    certifications?: string[];
    suggestedRoles?: string[];
  };

  const fullName = parsed.fullName?.trim();
  const email = parsed.email?.trim().toLowerCase();
  const phone = parsed.phone?.trim();
  const skills = cleanList(parsed.skills, 20);
  const certifications = cleanList(parsed.certifications, 20);
  const suggestedRoles = cleanList(parsed.suggestedRoles, 10);

  return {
    fullName: fullName || undefined,
    email: email || undefined,
    phone: phone || undefined,
    skills,
    certifications,
    suggestedRoles,
  };
}

function getAvailableProviders(
  githubAccessToken?: string,
  preferredProvider: PreferredProvider = "auto",
): Provider[] {
  const hasGithub = Boolean(
    githubAccessToken?.trim() || process.env.GITHUB_MODELS_TOKEN?.trim(),
  );
  const hasAzure = Boolean(
    process.env.AZURE_OPENAI_ENDPOINT?.trim() &&
    process.env.AZURE_OPENAI_API_KEY?.trim() &&
    process.env.AZURE_OPENAI_DEPLOYMENT?.trim(),
  );

  if (preferredProvider === "github-models") {
    if (hasGithub) {
      return ["github-models"];
    }

    return hasAzure ? ["azure-openai"] : [];
  }

  if (preferredProvider === "azure-openai") {
    if (hasAzure) {
      return ["azure-openai"];
    }

    return hasGithub ? ["github-models"] : [];
  }

  // Copilot Studio is not yet implemented in this path; use auto ordering.
  if (hasGithub) {
    return hasAzure ? ["github-models", "azure-openai"] : ["github-models"];
  }

  if (hasAzure) {
    return ["azure-openai"];
  }

  return [];
}

async function inferWithGithubModels(
  systemPrompt: string,
  userPrompt: string,
  githubAccessToken?: string,
): Promise<CandidateProfile> {
  const endpoint =
    process.env.GITHUB_MODELS_ENDPOINT ??
    "https://models.inference.ai.azure.com/chat/completions";
  const modelCandidates = getGithubModelCandidates(
    process.env.GITHUB_MODELS_MODEL,
  );
  const accessToken =
    githubAccessToken?.trim() || process.env.GITHUB_MODELS_TOKEN?.trim();

  if (!accessToken) {
    throw new Error("GitHub Models token is missing");
  }

  let lastError = "GitHub Models extraction failed";

  for (const model of modelCandidates) {
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
        max_completion_tokens: 700,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      lastError = `GitHub Models extraction failed: ${response.status} ${responseText}`;
      if (/unknown model|model.*not found/i.test(responseText)) {
        continue;
      }

      if (
        response.status === 429 &&
        /RateLimitReached|UserByModelByDay|ByDay/i.test(responseText)
      ) {
        continue;
      }

      throw new Error(lastError);
    }

    const content = extractMessageContent((await response.json()) as unknown);
    if (!content) {
      lastError = "GitHub Models extraction returned empty content";
      continue;
    }

    return parseCandidateProfile(content);
  }

  if (/RateLimitReached|UserByModelByDay|ByDay/i.test(lastError)) {
    throw new Error(
      "GitHub Models daily limit reached for available models. Configure Azure OpenAI in Settings or retry after quota reset.",
    );
  }

  throw new Error(lastError);
}

async function inferWithAzureOpenAI(
  systemPrompt: string,
  userPrompt: string,
): Promise<CandidateProfile> {
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
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 700,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Azure OpenAI extraction failed: ${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Azure OpenAI extraction returned empty content");
  }

  return parseCandidateProfile(content);
}

export async function inferCandidateProfileFromCv(params: {
  cvText: string;
  githubAccessToken?: string;
  preferredProvider?: PreferredProvider;
}): Promise<CandidateProfile> {
  const providers = getAvailableProviders(
    params.githubAccessToken,
    params.preferredProvider,
  );
  if (providers.length === 0) {
    throw new Error(
      "Candidate extraction AI is not configured. Connect GitHub Models or configure Azure OpenAI.",
    );
  }

  const systemPrompt =
    "Extract candidate profile from CV text. Return strict JSON with keys fullName, email, phone, skills, certifications, and suggestedRoles. Only return values present in the CV. Keep skills, certifications, and suggestedRoles concise and technical. Derive suggestedRoles from extracted skills and certifications only.";

  let lastError: string | undefined;
  let bestProfile: CandidateProfile | undefined;
  let bestScore = -1;

  for (const budget of CV_PROMPT_BUDGETS) {
    const compactCvText = compactCvTextForInference(params.cvText, budget);
    const promptVariants = buildExtractionPrompts(compactCvText);

    for (const userPrompt of promptVariants) {
      for (const provider of providers) {
        try {
          const profile =
            provider === "github-models"
              ? await inferWithGithubModels(
                  systemPrompt,
                  userPrompt,
                  params.githubAccessToken,
                )
              : await inferWithAzureOpenAI(systemPrompt, userPrompt);

          const profileScore = scoreProfile(profile);
          if (profileScore > bestScore) {
            bestScore = profileScore;
            bestProfile = profile;
          }

          if (isProfileStrong(profile)) {
            return profile;
          }
        } catch (error) {
          lastError = (error as Error).message;
        }
      }
    }

    if (!lastError || !isRequestTooLargeError(lastError)) {
      break;
    }
  }

  if (lastError && isRequestTooLargeError(lastError)) {
    throw new Error(
      "CV is too large for the configured AI model. Please upload a shorter CV version.",
    );
  }

  if (bestProfile && bestScore >= 40) {
    return bestProfile;
  }

  throw new Error(lastError ?? "Candidate extraction AI failed");
}

export async function inferSuggestedRolesFromSkillsAndCertifications(params: {
  skillsCsv: string;
  certificationsCsv: string;
  githubAccessToken?: string;
  preferredProvider?: PreferredProvider;
}): Promise<string[]> {
  const skills = parseDelimitedList(params.skillsCsv, 30);
  const certifications = parseDelimitedList(params.certificationsCsv, 30);

  if (skills.length === 0 && certifications.length === 0) {
    throw new Error(
      "Skills or certifications are required to regenerate suggested roles.",
    );
  }

  const syntheticCvText = [
    "Candidate profile evidence for role inference:",
    skills.length > 0
      ? `Skills:\n- ${skills.join("\n- ")}`
      : "Skills: None provided",
    certifications.length > 0
      ? `Certifications:\n- ${certifications.join("\n- ")}`
      : "Certifications: None provided",
  ].join("\n\n");

  const profile = await inferCandidateProfileFromCv({
    cvText: syntheticCvText,
    githubAccessToken: params.githubAccessToken,
    preferredProvider: params.preferredProvider,
  });

  if (profile.suggestedRoles.length === 0) {
    throw new Error(
      "AI could not infer suggested roles from the provided skills and certifications.",
    );
  }

  return profile.suggestedRoles;
}
