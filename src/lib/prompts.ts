import type { VossToggles } from "@/lib/voss";

export type PreferredWordRange = {
  min: number;
  max: number;
  label: string;
};

const DEFAULT_WORD_RANGE: PreferredWordRange = {
  min: 220,
  max: 320,
  label: "220-320 words",
};

function clampWordCount(value: number): number {
  return Math.max(80, Math.min(2000, value));
}

export function resolvePreferredWordRange(
  preferredLength?: string,
): PreferredWordRange {
  const cleaned = preferredLength?.trim();
  if (!cleaned) {
    return DEFAULT_WORD_RANGE;
  }

  const matches = Array.from(cleaned.matchAll(/\d{2,4}/g))
    .map((match) => Number.parseInt(match[0], 10))
    .filter((value) => Number.isFinite(value));

  if (matches.length >= 2) {
    const first = clampWordCount(matches[0]);
    const second = clampWordCount(matches[1]);
    const min = Math.min(first, second);
    const max = Math.max(first, second);
    return {
      min,
      max,
      label: `${min}-${max} words`,
    };
  }

  if (matches.length === 1) {
    const target = clampWordCount(matches[0]);
    const spread = Math.max(30, Math.round(target * 0.18));
    const min = clampWordCount(target - spread);
    const max = clampWordCount(target + spread);
    return {
      min,
      max,
      label: `${min}-${max} words (target ${target})`,
    };
  }

  return DEFAULT_WORD_RANGE;
}

export const EMAIL_SYSTEM_PROMPT = (
  preferredWordRange: PreferredWordRange = DEFAULT_WORD_RANGE,
) => `SYSTEM ROLE
You are drafting a human and professional client-submission email in British English for a placement company acting as a company-to-company partner. Calibrate depth and detail to the requested length. Your output must be Outlook-ready HTML (paragraphs with <p>…</p>, basic inline <strong>/<em>, no external CSS, no scripts).

INPUTS YOU WILL RECEIVE
The user prompt will include:
- Job Description (JD)
- Candidate CV summary
- Hiring company name
- Role title
- Recipient name or team
- Sender company (the company-to-company partner)
- Optional scheduling slot
- Enabled Chris Voss techniques

HARD CONSTRAINTS (DO NOT VIOLATE)
1) Length: ${preferredWordRange.label} (strict).
2) British English only (for example: organisation, prioritise, programme, sceptical, metre, modelling).
3) Use only evidence explicitly present in the provided JD/CV (no guesses, no hallucinations).
4) Apply only Chris Voss techniques explicitly enabled by the provided toggles. Do not introduce disabled techniques. Do not name techniques in the email.
5) Explicitly position the sender company as the hiring company's company-to-company partner.
6) Avoid rigid section labels (for example, "CV to JD alignment", "Candidate summary", "Role highlights") and robotic phrasing (for example, "matched via CV skill").
7) Tone must be natural, consultative, commercially clear, and persuasive; avoid hype and clichés.
8) Output must be Outlook-safe HTML content only (no markdown, no script/style blocks).
9) Never include unresolved placeholders or invented fields.

VOICE & TONE
- Calm, respectful, and confident, as an experienced consultant.
- Client-facing framing that sells strengths while remaining factual and specific.
- Prefer plain language and clear paragraph flow.

DIFFERENTIATION MANDATE
- This draft must feel stronger than a typical agency submission.
- Lead with decision-relevant outcomes and role-critical evidence, not generic praise.
- Make the candidate memorable by combining technical signal, delivery impact, and practical fit in one narrative.
- Avoid bland filler phrases (for example, "great fit", "highly motivated", "strong communication skills") unless backed by concrete evidence.

ANTI-BLAND ENFORCEMENT
- Avoid generic openers (for example, "I hope you're well", "I wanted to reach out", "Please find attached").
- Avoid empty adjectives without proof (for example, "excellent", "outstanding", "brilliant") unless immediately evidenced.
- Include one specific risk-reduction line and one speed-to-impact line tied to JD/CV facts.
- Make the close decision-oriented, not passive.

EMAIL FLOW (DO NOT ADD SECTION LABELS)
- A concise subject line (ideally includes role and company).
- Greeting.
- Opening with role context, business pressure, and a sharp relevance hook.
- Evidence-led case for fit and likely impact with concrete, JD-linked proof points.
- Consultative next-step nudge using only enabled techniques.
- Professional close and signature context as the company-to-company partner.

STYLE GUARDRAILS
- No marketing hype (for example, "world-class", "rockstar").
- Prefer prose over bullet lists unless evidence readability clearly benefits.
- Keep claims attributable to JD/CV evidence only.
- Use specific language that sounds written for this exact role, not reusable boilerplate.

HTML OUTPUT REQUIREMENTS
- Use only <p>, <br>, <strong>, <em>, and safe entities.
- No tables, images, anchors, external styles, or inline styles.

SPELLING ENFORCEMENT
Convert American spellings to British spellings before finalising (for example: organization→organisation, prioritize→prioritise, program→programme where applicable, color→colour, modeling→modelling, meter→metre, skeptical→sceptical).

QUALITY CHECK (RUN SILENTLY)
- ${preferredWordRange.label}.
- British English spelling.
- No disallowed labels or robotic phrasing.
- Facts only from JD/CV.
- Only enabled Voss techniques applied.
- Sender clearly positioned as company-to-company partner.
- Outlook-safe HTML.

OUTPUT FORMAT
Return JSON with exactly: { "subject": "...", "html": "..." }.`;

type EmailUserPromptParams = {
  jobDescription: string;
  candidateSummary: string;
  cvToJdAlignment: string;
  learningExamples?: string;
  companyName?: string;
  roleTitle?: string;
  c2cPartnerName: string;
  rulesJson: unknown;
  recipientName?: string;
  variationHint?: string;
  preferredLength?: string;
  includeSections?: Partial<VossToggles>;
  recentDraftsToAvoid?: string;
};

function normaliseVossToggles(
  includeSections?: Partial<VossToggles>,
): VossToggles {
  return {
    accusations_audit: includeSections?.accusations_audit ?? true,
    tactical_empathy: includeSections?.tactical_empathy ?? true,
    labelling: includeSections?.labelling ?? true,
    mirroring: includeSections?.mirroring ?? true,
    calibrated_questions: includeSections?.calibrated_questions ?? true,
    no_oriented_closing: includeSections?.no_oriented_closing ?? true,
  };
}

function buildEnabledTechniquesText(toggles: VossToggles): string {
  const enabled: string[] = [];

  if (toggles.accusations_audit) enabled.push("accusations audit");
  if (toggles.tactical_empathy) enabled.push("tactical empathy");
  if (toggles.labelling) enabled.push("labelling");
  if (toggles.mirroring) enabled.push("mirroring");
  if (toggles.calibrated_questions) enabled.push("calibrated questions");
  if (toggles.no_oriented_closing) enabled.push("no-oriented closing");

  return enabled.length > 0 ? enabled.join(", ") : "none";
}

function buildVossExecutionRules(toggles: VossToggles): string {
  const rules: string[] = [];

  if (toggles.accusations_audit) {
    rules.push(
      "Include exactly one brief accusations-audit line that proactively acknowledges a likely hiring concern in neutral language.",
    );
  }

  if (toggles.tactical_empathy || toggles.mirroring) {
    rules.push(
      "Open by reflecting the core hiring priority in the brief (short, natural wording tied to business pressure).",
    );
  }

  if (toggles.labelling) {
    rules.push(
      "Use exactly one concise labelling phrase (for example, 'It seems the key priority is...') without sounding scripted.",
    );
  }

  if (toggles.mirroring) {
    rules.push(
      "Use one short mirroring phrase (3-8 words) naturally in the body, not as a standalone line.",
    );
  }

  if (toggles.calibrated_questions && toggles.no_oriented_closing) {
    rules.push(
      "Close with exactly one no-oriented calibrated question that invites next steps and can be answered easily.",
    );
  } else if (toggles.calibrated_questions) {
    rules.push(
      "Close with exactly one calibrated next-step question in a practical, low-friction tone.",
    );
  } else if (toggles.no_oriented_closing) {
    rules.push(
      "Close with exactly one no-oriented question that keeps momentum without pressure.",
    );
  } else {
    rules.push(
      "Close with a short, practical next-step statement (no question needed).",
    );
  }

  return rules.length > 0
    ? rules.map((rule) => `- ${rule}`).join("\n")
    : "- Use a straightforward consultative structure with no Voss technique requirements.";
}

export const EMAIL_USER_PROMPT = (p: EmailUserPromptParams) =>
  `JOB/CONTRACT:\n${p.jobDescription}\n\nCANDIDATE:\n${p.candidateSummary}\n\nEVIDENCE NOTES:\n${p.cvToJdAlignment}\n${p.learningExamples ? `\n\nPREFERRED STYLE REFERENCES (from previously approved drafts):\n${p.learningExamples}\nUse these as style guidance only. Do not copy content verbatim.` : ""}${p.recentDraftsToAvoid ? `\n\nRECENT DRAFTS FOR THIS CANDIDATE (AVOID REPETITION):\n${p.recentDraftsToAvoid}\nDo not reuse these openings, sentence structures, strength lines, or closing question phrasing.` : ""}\n\nCOMPANY (hiring): ${p.companyName ?? "Hiring Team"}\nROLE: ${p.roleTitle ?? "Role"}\nCompany-to-company partner (sender company): ${p.c2cPartnerName}\nPREFERRED LENGTH: ${p.preferredLength ?? "180-320 words"}\nRULES:\n${JSON.stringify(p.rulesJson, null, 2)}\n\nWrite the email as ${p.c2cPartnerName}, positioned as the hiring company's company-to-company partner. Focus on why this candidate is a strong fit for this specific JD using only supplied evidence. Keep it human, professional, and persuasive in British English.

Variation requirement:
- Avoid repeating stock openings or closings across drafts.
- Do not always start with "As your company-to-company partner".
- Use natural alternatives for the opening and strengths lead-in while keeping the same factual evidence.
- Apply this style cue for this draft: ${p.variationHint ?? "Use a fresh opening and sentence rhythm."}
- The draft must read as clearly distinct from recent drafts for this candidate, not a lightly edited copy.

Differentiation rules (must apply):
- Open with a concrete priority pressure from the brief (delivery speed, risk, stakeholder load, or capability gap).
- Show 3-5 role-critical proof points, each tied to JD evidence and candidate evidence.
- Translate evidence into likely business impact (for example delivery reliability, reduced onboarding friction, faster ramp).
- Include one concise de-risking line (for example, known unknowns or validation point) in neutral professional wording.
- Keep the narrative specific to this role and company; avoid language that could fit any candidate.
- Include one line that creates urgency through consequence (what may stall or remain exposed if this gap is not solved promptly), without fear-mongering.

Voss toggle controls (must be followed):
- Enabled techniques: ${buildEnabledTechniquesText(normaliseVossToggles(p.includeSections))}
- Disabled techniques must not appear.

Structure guidance:
- Use a natural, non-repetitive flow that reads as a bespoke note written for this exact role.
- You may use paragraphs or brief bullets where they improve clarity, but avoid the same fixed format on every draft.
- Ensure the draft includes: role context, evidence-led fit, practical impact, one de-risking line, and a decisive close.
- Do not start with any of these stock openings: "Hi Hiring Team", "For your [role] role", "Based on your [role] brief".

Voss execution rules:
${buildVossExecutionRules(normaliseVossToggles(p.includeSections))}

Style constraints:
- Do not include standalone sections called "Candidate summary" or "Role highlights".
- Weave relevant role requirements and evidence naturally into the narrative and strengths bullets.
- Keep language commercially persuasive and human, as if written by an experienced recruiter.
- Ban these unless directly evidenced and qualified: "perfect fit", "world-class", "best-in-class", "rockstar", "guru".

Return JSON with: { "subject": "...", "html": "..." }`;
