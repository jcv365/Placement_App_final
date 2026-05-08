// Builds the formatted CV PDF from the already-generated text and saves it to the DB.
// Reads the text file written by _format_candidate_cv.js, then uses pdf-lib to build the PDF.
const { PrismaClient } = require("@prisma/client");
const { PDFDocument, StandardFonts, rgb, PageSizes } = require("pdf-lib");
const fs = require("fs");

const CANDIDATE_ID = process.argv[2] || "cmnegz3m90005v6a4rur1ey87";
const TEXT_FILE = `/app/data/temp/_formatted_cv_${CANDIDATE_ID}.txt`;

const p = new PrismaClient();

// ─── Safe latin-1 text filter ────────────────────────────────────────────────
function safeText(str) {
  return (str || "")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^\x20-\x7E]/g, "?");
}

function wrapText(text, font, size, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(safeText(test), size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function buildPdf(sections) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595.28; // A4
  const pageH = 841.89;
  const marginL = 50;
  const marginR = 50;
  const contentW = pageW - marginL - marginR;

  let page = doc.addPage([pageW, pageH]);
  let y = pageH - 50;

  function ensureSpace(needed) {
    if (y - needed < 50) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - 50;
    }
  }

  function drawText(text, font, size, options = {}) {
    const { color = rgb(0, 0, 0), x = marginL, indent = 0 } = options;
    const lines = wrapText(safeText(text), font, size, contentW - indent);
    for (const line of lines) {
      ensureSpace(size + 4);
      page.drawText(safeText(line), { x: x + indent, y, size, font, color });
      y -= size + 4;
    }
  }

  function drawSectionHeader(title) {
    ensureSpace(24);
    y -= 6;
    page.drawText(safeText(title), {
      x: marginL,
      y,
      size: 10,
      font: bold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 13;
    page.drawLine({
      start: { x: marginL, y },
      end: { x: pageW - marginR, y },
      thickness: 0.5,
      color: rgb(0.5, 0.5, 0.5),
    });
    y -= 8;
  }

  // Name
  const nameText = safeText(sections.candidateName.toUpperCase());
  const nameSize = 18;
  const nameW = bold.widthOfTextAtSize(nameText, nameSize);
  page.drawText(nameText, {
    x: (pageW - nameW) / 2,
    y,
    size: nameSize,
    font: bold,
  });
  y -= nameSize + 4;

  const subtitle = "Curriculum Vitae";
  const subSize = 9;
  const subW = regular.widthOfTextAtSize(subtitle, subSize);
  page.drawText(subtitle, {
    x: (pageW - subW) / 2,
    y,
    size: subSize,
    font: regular,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= subSize + 6;
  page.drawLine({
    start: { x: marginL, y },
    end: { x: pageW - marginR, y },
    thickness: 0.8,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 12;

  // Summary
  drawSectionHeader("PROFESSIONAL SUMMARY");
  drawText(sections.professionalSummary, regular, 9.5);
  y -= 4;

  // Skills
  if (sections.coreSkills?.length) {
    drawSectionHeader("CORE SKILLS & TECHNOLOGIES");
    drawText(sections.coreSkills.join(" | "), regular, 9.5);
    y -= 4;
  }

  // Certifications
  if (sections.certifications?.length) {
    drawSectionHeader("CERTIFICATIONS");
    for (const cert of sections.certifications) {
      drawText(`\u2022 ${cert}`, regular, 9.5);
    }
    y -= 4;
  }

  // Experience
  if (sections.experience?.length) {
    drawSectionHeader("PROFESSIONAL EXPERIENCE");
    for (const exp of sections.experience) {
      ensureSpace(30);
      drawText(exp.title, bold, 9.5);
      drawText(`${exp.company} | ${exp.period}`, regular, 9, {
        color: rgb(0.3, 0.3, 0.3),
      });
      for (const b of exp.bullets || []) {
        drawText(`\u2022 ${b}`, regular, 9.5, { indent: 10 });
      }
      y -= 6;
    }
  }

  // Education
  if (sections.education?.length) {
    drawSectionHeader("EDUCATION");
    for (const edu of sections.education) {
      drawText(`\u2022 ${edu}`, regular, 9.5);
    }
    y -= 4;
  }

  // Achievements
  if (sections.keyAchievements?.length) {
    drawSectionHeader("KEY ACHIEVEMENTS");
    for (const ach of sections.keyAchievements) {
      drawText(`\u2022 ${ach}`, regular, 9.5);
    }
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function main() {
  // Re-read the sections from the DB-stored data or re-run the LLM.
  // For speed, we reconstruct sections from the text file using the DB fields.
  const candidate = await p.candidate.findFirst({
    where: { id: CANDIDATE_ID },
    select: {
      fullName: true,
      skillsCsv: true,
      certificationsCsv: true,
      suggestedRolesCsv: true,
      rawCV: true,
    },
  });

  if (!candidate) throw new Error("Candidate not found");

  // We need the structured sections — re-call the LLM using same logic as before
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
          res.on("data", (c) => (data += c));
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

  const base = process.env.LLMLITE_API_BASE || process.env.OPENAI_BASE_URL;
  const key = process.env.LLMLITE_API_KEY || process.env.OPENAI_API_KEY;
  const url = base.replace(/\/$/, "") + "/chat/completions";

  console.log("Calling AI for structured sections...");

  const result = await httpPost(
    url,
    {
      model: process.env.LLMLITE_MODEL || "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert CV writer for UK/SA IT contract placements. Return ONLY valid JSON with this exact schema:
{"candidateName":"string","professionalSummary":"string","coreSkills":["string"],"certifications":["string"],"experience":[{"title":"string","company":"string","period":"string","bullets":["string"]}],"education":["string"],"keyAchievements":["string"]}
Rules: British English, no contact info, reverse-chronological experience, achievement-led bullets.`,
        },
        {
          role: "user",
          content: `Name: ${candidate.fullName}\nSkills: ${candidate.skillsCsv}\nCerts: ${candidate.certificationsCsv}\nRoles: ${candidate.suggestedRolesCsv}\n\nRaw CV:\n---\n${candidate.rawCV}\n---`,
        },
      ],
      temperature: 0.3,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    },
    { Authorization: `Bearer ${key}` },
  );

  if (result.status !== 200)
    throw new Error(
      `LLM error ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}`,
    );

  const sections = JSON.parse(result.body?.choices?.[0]?.message?.content);
  console.log("Sections received. Building PDF...");

  const pdfBuffer = await buildPdf(sections);

  const safeSlug = candidate.fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const formattedCvFileName = `${safeSlug}-formatted.pdf`;

  // Render plain text too
  const lines = [];
  lines.push(sections.candidateName.toUpperCase(), "");
  lines.push(
    "PROFESSIONAL SUMMARY",
    "─".repeat(60),
    sections.professionalSummary,
    "",
  );
  if (sections.coreSkills?.length) {
    lines.push(
      "CORE SKILLS & TECHNOLOGIES",
      "─".repeat(60),
      sections.coreSkills.join(" | "),
      "",
    );
  }
  if (sections.certifications?.length) {
    lines.push(
      "CERTIFICATIONS",
      "─".repeat(60),
      ...sections.certifications.map((c) => `• ${c}`),
      "",
    );
  }
  if (sections.experience?.length) {
    lines.push("PROFESSIONAL EXPERIENCE", "─".repeat(60));
    sections.experience.forEach((e) => {
      lines.push(
        e.title,
        `${e.company} | ${e.period}`,
        ...(e.bullets || []).map((b) => `  • ${b}`),
        "",
      );
    });
  }
  if (sections.education?.length) {
    lines.push(
      "EDUCATION",
      "─".repeat(60),
      ...sections.education.map((e) => `• ${e}`),
      "",
    );
  }
  if (sections.keyAchievements?.length) {
    lines.push(
      "KEY ACHIEVEMENTS",
      "─".repeat(60),
      ...sections.keyAchievements.map((a) => `• ${a}`),
      "",
    );
  }
  const formattedText = lines.join("\n");

  await p.candidate.update({
    where: { id: CANDIDATE_ID },
    data: {
      formattedCvText: formattedText,
      formattedCvPdfData: new Uint8Array(pdfBuffer),
      formattedCvFileName,
      formattedCvGeneratedAt: new Date(),
    },
  });

  console.log(`\nSaved to DB:`);
  console.log(`  fileName: ${formattedCvFileName}`);
  console.log(`  pdfBytes: ${pdfBuffer.byteLength}`);
  console.log(`  textLength: ${formattedText.length}`);
  console.log(
    `\nDownload via: GET /api/candidates/${CANDIDATE_ID}/formatted-cv`,
  );

  await p.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  p.$disconnect();
  process.exit(1);
});
