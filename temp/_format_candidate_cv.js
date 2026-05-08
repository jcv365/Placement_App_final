// Direct CV formatter script — runs inside the container, no HTTP auth needed.
// Usage: node _format_candidate_cv.js <candidateId>
const { PrismaClient } = require("@prisma/client");

const CANDIDATE_ID = process.argv[2] || "cmnegz3m90005v6a4rur1ey87";

const p = new PrismaClient();

// ─── Minimal inline CV formatter (mirrors src/lib/cvFormatter.ts logic) ───────
const https = require("https");
const http = require("http");

async function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const payload = JSON.stringify(body);
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function formatCvViaLlm(candidate) {
  const base = process.env.LLMLITE_API_BASE || process.env.OPENAI_BASE_URL;
  const key = process.env.LLMLITE_API_KEY || process.env.OPENAI_API_KEY;

  if (!base || !key) {
    throw new Error("LLMLITE_API_BASE / LLMLITE_API_KEY env vars not set");
  }

  const url = base.replace(/\/$/, "") + "/chat/completions";

  const systemPrompt = `You are an expert CV writer specialising in IT contract placements in the UK and South Africa.
Rewrite the provided CV into a clean, ATS-optimised format using the following structure exactly:
1. Candidate name (full name only — NO contact details, NO email, NO phone, NO address)
2. PROFESSIONAL SUMMARY (2-4 sentences, role-focused, action-oriented, British English)
3. CORE SKILLS & TECHNOLOGIES (comma-separated, 8-15 items)
4. CERTIFICATIONS (bullet list, one per line)
5. PROFESSIONAL EXPERIENCE (reverse chronological; each role: job title, company, period, 3-5 achievement-led bullet points)
6. EDUCATION (bullet list: Degree | Institution | Year)
7. KEY ACHIEVEMENTS (3-5 quantified accomplishments)

Rules:
- British English spelling throughout
- Remove ALL personal contact information
- Achievement-led bullets starting with past-tense action verbs
- Focus on impact, not just duties
- Keep each bullet to one line where possible`;

  const userPrompt = `Candidate name: ${candidate.fullName}
Known skills: ${candidate.skillsCsv || "(see CV)"}
Known certifications: ${candidate.certificationsCsv || "(see CV)"}
Suggested roles: ${candidate.suggestedRolesCsv || "(see CV)"}

Raw CV text:
---
${candidate.rawCV}
---

Return ONLY valid JSON matching this schema:
{
  "candidateName": "string",
  "professionalSummary": "string",
  "coreSkills": ["string"],
  "certifications": ["string"],
  "experience": [
    {
      "title": "string",
      "company": "string",
      "period": "string",
      "bullets": ["string"]
    }
  ],
  "education": ["string"],
  "keyAchievements": ["string"]
}`;

  const result = await httpPost(
    url,
    {
      model: process.env.LLMLITE_MODEL || "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    },
    {
      Authorization: `Bearer ${key}`,
    },
  );

  if (result.status !== 200) {
    throw new Error(
      `LLM error ${result.status}: ${JSON.stringify(result.body)}`,
    );
  }

  const content = result.body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content in LLM response");

  return JSON.parse(content);
}

function renderCvText(sections) {
  const lines = [];
  lines.push(sections.candidateName.toUpperCase());
  lines.push("");

  lines.push("PROFESSIONAL SUMMARY");
  lines.push("─".repeat(60));
  lines.push(sections.professionalSummary);
  lines.push("");

  if (sections.coreSkills?.length) {
    lines.push("CORE SKILLS & TECHNOLOGIES");
    lines.push("─".repeat(60));
    lines.push(sections.coreSkills.join(" | "));
    lines.push("");
  }

  if (sections.certifications?.length) {
    lines.push("CERTIFICATIONS");
    lines.push("─".repeat(60));
    sections.certifications.forEach((c) => lines.push(`• ${c}`));
    lines.push("");
  }

  if (sections.experience?.length) {
    lines.push("PROFESSIONAL EXPERIENCE");
    lines.push("─".repeat(60));
    sections.experience.forEach((exp) => {
      lines.push(exp.title);
      lines.push(`${exp.company} | ${exp.period}`);
      exp.bullets?.forEach((b) => lines.push(`  • ${b}`));
      lines.push("");
    });
  }

  if (sections.education?.length) {
    lines.push("EDUCATION");
    lines.push("─".repeat(60));
    sections.education.forEach((e) => lines.push(`• ${e}`));
    lines.push("");
  }

  if (sections.keyAchievements?.length) {
    lines.push("KEY ACHIEVEMENTS");
    lines.push("─".repeat(60));
    sections.keyAchievements.forEach((a) => lines.push(`• ${a}`));
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  console.log(`\nFormatting CV for candidate: ${CANDIDATE_ID}\n`);

  const candidate = await p.candidate.findFirst({
    where: { id: CANDIDATE_ID },
    select: {
      id: true,
      fullName: true,
      rawCV: true,
      skillsCsv: true,
      certificationsCsv: true,
      suggestedRolesCsv: true,
    },
  });

  if (!candidate) throw new Error("Candidate not found");
  if (!candidate.rawCV?.trim())
    throw new Error("No rawCV stored for this candidate");

  console.log(`Candidate: ${candidate.fullName}`);
  console.log(`Raw CV length: ${candidate.rawCV.length} chars`);
  console.log("Calling AI to format CV...");

  const sections = await formatCvViaLlm(candidate);

  const formattedText = renderCvText(sections);

  // Write text output to a shared location
  const fs = require("fs");
  const os = require("os");
  const outPath = `/app/data/temp/_formatted_cv_${CANDIDATE_ID}.txt`;
  fs.writeFileSync(outPath, formattedText, "utf8");
  console.log(`\nFormatted CV text written to: ${outPath}`);
  console.log(`\n${"=".repeat(70)}`);
  console.log(formattedText);
  console.log("=".repeat(70));

  await p.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  p.$disconnect();
  process.exit(1);
});
