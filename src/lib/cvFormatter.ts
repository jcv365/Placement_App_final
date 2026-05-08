import { generateStructuredJson } from "@/lib/aiJson";

export type CvExperienceEntry = {
  title: string;
  company: string;
  period: string;
  bullets: string[];
};

export type FormattedCvSections = {
  candidateName: string;
  professionalSummary: string;
  coreSkills: string[];
  certifications: string[];
  experience: CvExperienceEntry[];
  education: string[];
  keyAchievements: string[];
};

const MAX_SKILLS = 24;
const MAX_BULLETS_PER_ROLE = 6;
const MAX_EXPERIENCE_ENTRIES = 10;

function safeTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => safeTrimmedString(item))
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseSections(
  raw: Record<string, unknown>,
  fallbackName: string,
): FormattedCvSections {
  const experience: CvExperienceEntry[] = [];
  const rawExp = raw.experience;
  if (Array.isArray(rawExp)) {
    for (const entry of rawExp.slice(0, MAX_EXPERIENCE_ENTRIES)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const title = safeTrimmedString(e.title);
      const company = safeTrimmedString(e.company);
      const period = safeTrimmedString(e.period);
      if (!title && !company) continue;
      experience.push({
        title: title || "Consultant",
        company: company || "Undisclosed",
        period,
        bullets: safeStringArray(e.bullets, MAX_BULLETS_PER_ROLE),
      });
    }
  }

  const name = safeTrimmedString(raw.candidateName) || fallbackName;

  return {
    candidateName: name,
    professionalSummary: safeTrimmedString(raw.professionalSummary),
    coreSkills: safeStringArray(raw.coreSkills, MAX_SKILLS),
    certifications: safeStringArray(raw.certifications, 15),
    experience,
    education: safeStringArray(raw.education, 8),
    keyAchievements: safeStringArray(raw.keyAchievements, 5),
  };
}

/** Render structured sections to plain text in the standard ATS template. */
export function renderFormattedCvText(sections: FormattedCvSections): string {
  const lines: string[] = [];

  lines.push(sections.candidateName.toUpperCase());
  lines.push("");

  if (sections.professionalSummary) {
    lines.push("PROFESSIONAL SUMMARY");
    lines.push(sections.professionalSummary);
    lines.push("");
  }

  if (sections.coreSkills.length > 0) {
    lines.push("CORE SKILLS & TECHNOLOGIES");
    const chunkSize = 5;
    for (let i = 0; i < sections.coreSkills.length; i += chunkSize) {
      lines.push(sections.coreSkills.slice(i, i + chunkSize).join(" | "));
    }
    lines.push("");
  }

  if (sections.certifications.length > 0) {
    lines.push("CERTIFICATIONS");
    for (const cert of sections.certifications) {
      lines.push(`• ${cert}`);
    }
    lines.push("");
  }

  if (sections.experience.length > 0) {
    lines.push("PROFESSIONAL EXPERIENCE");
    lines.push("");
    for (const entry of sections.experience) {
      lines.push(entry.title);
      lines.push(`${entry.company}${entry.period ? ` | ${entry.period}` : ""}`);
      for (const bullet of entry.bullets) {
        lines.push(`• ${bullet}`);
      }
      lines.push("");
    }
  }

  if (sections.education.length > 0) {
    lines.push("EDUCATION");
    for (const edu of sections.education) {
      lines.push(`• ${edu}`);
    }
    lines.push("");
  }

  if (sections.keyAchievements.length > 0) {
    lines.push("KEY ACHIEVEMENTS");
    for (const ach of sections.keyAchievements) {
      lines.push(`• ${ach}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * AI agent: rewrites a raw CV into a structured, ATS-optimised format.
 * Returns structured sections — use renderFormattedCvText to get plain text,
 * or buildFormattedCvPdf (pdfRedaction.ts) to get a PDF.
 */
export async function formatCvForAts(params: {
  rawCvText: string;
  candidateName: string;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
}): Promise<FormattedCvSections> {
  const systemPrompt = [
    "You are a professional CV writer for a contract IT and technology staffing agency in South Africa.",
    "Rewrite raw CV text into a clean, structured, ATS-optimised format following these strict rules:",
    "- British English throughout.",
    "- Include ONLY factual information present in the raw CV. Do not invent or embellish.",
    "- Remove ALL contact information: email addresses, phone numbers, LinkedIn URLs, physical addresses, personal social media.",
    "- professionalSummary: 2–4 sentences covering total years of experience, technical domain, key certifications, and career value proposition.",
    "- coreSkills: specific technologies, tools, platforms, and domains. No soft skills or generic terms.",
    "- experience: reverse-chronological order. bullets must be achievement-led and quantified wherever the CV provides evidence.",
    "- education: format each entry as 'Degree/Qualification | Institution | Year'.",
    "- keyAchievements: 3–5 standout career wins, quantified, not duplicated from experience bullets.",
    "Return JSON only. No markdown fences. No contact details in any field.",
  ].join("\n");

  const jsonTemplate = JSON.stringify({
    candidateName: "",
    professionalSummary: "",
    coreSkills: [],
    certifications: [],
    experience: [{ title: "", company: "", period: "", bullets: [] }],
    education: [],
    keyAchievements: [],
  });

  const userPrompt = [
    `RAW CV TEXT:\n${params.rawCvText.slice(0, 8000)}`,
    `CANDIDATE NAME: ${params.candidateName}`,
    `KNOWN SKILLS: ${params.skillsCsv || "not provided"}`,
    `KNOWN CERTIFICATIONS: ${params.certificationsCsv || "not provided"}`,
    `SUGGESTED ROLES: ${params.suggestedRolesCsv || "not provided"}`,
    "",
    `Return JSON matching this exact structure:\n${jsonTemplate}`,
  ].join("\n\n");

  const raw = await generateStructuredJson<Record<string, unknown>>({
    systemPrompt,
    userPrompt,
    maxTokens: 3000,
    temperature: 0,
  });

  return parseSections(raw, params.candidateName);

  // NOTE: keep above optimistic path. If the AI fails or returns malformed
  // content despite retries, fall back to a conservative, deterministic
  // formatting so downstream journeys can continue without blocking.
}

// Fallback wrapper that attempts AI formatting but returns a safe fallback
export async function formatCvForAtsWithFallback(params: {
  rawCvText: string;
  candidateName: string;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
}): Promise<FormattedCvSections> {
  try {
    return await formatCvForAts(params);
  } catch (err) {
    console.error("[CV_FORMAT_FALLBACK] AI formatting failed", {
      message: (err as Error)?.message ?? err,
    });

    const coreSkills = (params.skillsCsv || "")
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 24);

    return {
      candidateName: params.candidateName,
      professionalSummary:
        "Formatted summary unavailable — using raw CV excerpt.",
      coreSkills,
      certifications: (params.certificationsCsv || "")
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 15),
      experience: [],
      education: [],
      keyAchievements: [],
    };
  }
}
