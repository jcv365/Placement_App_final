import { extractMessageContent } from "@/lib/aiUtils";
import {
    isAiGatewayConfigured,
    requireAiGatewayConfig,
    resolveAiGatewayModel,
} from "@/lib/liteLlm";

type CandidateProfile = {
  fullName?: string;
  email?: string;
  phone?: string;
  skills: string[];
  certifications: string[];
  suggestedRoles: string[];
};

type Provider = "litellm";

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

function getAvailableProviders(): Provider[] {
  const hasGateway = isAiGatewayConfigured();

  return hasGateway ? ["litellm"] : [];
}

async function inferWithGateway(
  systemPrompt: string,
  userPrompt: string,
  modelOverride?: string,
): Promise<CandidateProfile> {
  const { apiBase, apiKey } = requireAiGatewayConfig(
    "Candidate extraction AI is not configured",
  );
  const model = resolveAiGatewayModel(modelOverride);

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 700,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `LiteLLM extraction failed: ${response.status} ${await response.text()}`,
    );
  }

  const content = extractMessageContent((await response.json()) as unknown);
  if (!content) {
    throw new Error("LiteLLM extraction returned empty content");
  }

  return parseCandidateProfile(content);
}

export async function inferCandidateProfileFromCv(params: {
  cvText: string;
  fastMode?: boolean;
  model?: string;
}): Promise<CandidateProfile> {
  const providers = getAvailableProviders();
  if (providers.length === 0) {
    throw new Error(
      "Candidate extraction AI is not configured. Set LITELLM_API_BASE and LITELLM_API_KEY in the app environment.",
    );
  }

  const systemPrompt =
    "Extract candidate profile from CV text. Return strict JSON with keys fullName, email, phone, skills, certifications, and suggestedRoles. Only return values present in the CV. Keep skills, certifications, and suggestedRoles concise and technical. Derive suggestedRoles from extracted skills and certifications only.";

  const budgets = params.fastMode ? [5000] : [...CV_PROMPT_BUDGETS];

  let lastError: string | undefined;
  let bestProfile: CandidateProfile | undefined;
  let bestScore = -1;

  for (const budget of budgets) {
    const compactCvText = compactCvTextForInference(params.cvText, budget);
    const promptVariants = params.fastMode
      ? [buildExtractionPrompts(compactCvText)[0]]
      : buildExtractionPrompts(compactCvText);

    for (const userPrompt of promptVariants) {
      for (const provider of providers) {
        try {
          const profile = await inferWithGateway(
            systemPrompt,
            userPrompt,
            params.model,
          );

          const profileScore = scoreProfile(profile);
          if (profileScore > bestScore) {
            bestScore = profileScore;
            bestProfile = profile;
          }

          if (params.fastMode) {
            return profile;
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
  fastMode?: boolean;
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
    fastMode: params.fastMode,
  });

  if (profile.suggestedRoles.length === 0) {
    throw new Error(
      "AI could not infer suggested roles from the provided skills and certifications.",
    );
  }

  return profile.suggestedRoles;
}
