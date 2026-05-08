// Host-side script: generates the formatted CV PDF using local pdf-lib + Inter font,
// saves the bytes to the DB directly via Prisma.
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { PrismaClient } = require("@prisma/client");

const CANDIDATE_ID = process.argv[2] || "cmnegz3m90005v6a4rur1ey87";

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const p = new PrismaClient({
  datasources: {
    db: { url: `file:${path.join(__dirname, "..", "prisma", "prod.db")}` },
  },
});

const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");

function safeText(str) {
  return (str || "")
    .replace(/[\u2022\u2023\u25E6]/g, "-")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(text, font, size, maxW) {
  const words = safeText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const try_ = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(try_, size) <= maxW) {
      cur = try_;
    } else {
      if (cur) lines.push(cur);
      if (font.widthOfTextAtSize(w, size) > maxW) {
        let part = "";
        for (const ch of w) {
          const t = part + ch;
          if (font.widthOfTextAtSize(t, size) <= maxW) {
            part = t;
          } else {
            if (part) lines.push(part);
            part = ch;
          }
        }
        if (part) lines.push(part);
        cur = "";
      } else {
        cur = w;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function buildPdf(sections) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const load = (name) =>
    doc.embedFont(fs.readFileSync(path.join(FONT_DIR, name)));
  const fonts = {
    reg: await load("Inter-Regular.ttf"),
    med: await load("Inter-Medium.ttf"),
    semi: await load("Inter-SemiBold.ttf"),
    bold: await load("Inter-Bold.ttf"),
    light: await load("Inter-Light.ttf"),
  };

  // ── Layout ──────────────────────────────────────────────────────────────────
  const PAGE_W = 595;
  const PAGE_H = 842;
  const SB = 163; // sidebar width
  const SB_PAD = 16; // sidebar inner horizontal padding
  const SB_TW = SB - SB_PAD - 10; // sidebar text max width = 137pt
  const CX = SB + 18; // main content text left = 181pt
  const CR = 36; // main content right margin
  const CW = PAGE_W - CX - CR; // main content text width = 378pt
  const MB = 44; // bottom margin
  const BODY_SZ = 9.5;
  const SMALL_SZ = 8.5;
  const BLLT_SZ = 9;
  const HEAD_SZ = 8.5;
  const NAME_SZ = 17;
  const LINE_H = 17.5;
  const SM_LH = 16;
  const SB_LH = 15.5;
  const SECT_G = 24;
  const SB_SG = 17;

  // ── Colours ─────────────────────────────────────────────────────────────────
  const NAVY = rgb(0.055, 0.15, 0.32); // deep navy sidebar
  const TEAL = rgb(0.04, 0.67, 0.67); // primary teal accent
  const TEAL_XL = rgb(0.6, 0.9, 0.92); // light teal for sidebar subtitle
  const SB_BODY = rgb(0.75, 0.83, 0.91); // sidebar body text (pale slate-blue)
  const SB_LBL = rgb(0.42, 0.72, 0.78); // sidebar label (muted teal)
  const RULE_L = rgb(0.87, 0.9, 0.93); // faint rule in main content
  const DARK = rgb(0.12, 0.13, 0.15); // near-black body
  const SLATE = rgb(0.44, 0.48, 0.54); // secondary (dates)
  const WHITE = rgb(1, 1, 1);

  // ── Mutable state ───────────────────────────────────────────────────────────
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 26; // main content cursor
  let sY = PAGE_H - 22; // sidebar cursor (page 1 only)

  // ── Page decorations ─────────────────────────────────────────────────────────
  function decoratePage(pg) {
    pg.drawRectangle({
      x: 0,
      y: PAGE_H - 5,
      width: PAGE_W,
      height: 5,
      color: TEAL,
    }); // top bar
    pg.drawRectangle({
      x: 0,
      y: 0,
      width: SB,
      height: PAGE_H - 5,
      color: NAVY,
    }); // sidebar bg
    pg.drawRectangle({ x: SB, y: 0, width: 2, height: PAGE_H, color: TEAL }); // sidebar border
    pg.drawRectangle({ x: 0, y: 0, width: SB, height: 4, color: TEAL }); // sidebar bottom bar
  }
  decoratePage(page);

  // ── Ensure main content space ──────────────────────────────────────────────
  function ensureMain(h) {
    if (y - h < MB) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      decoratePage(page);
      y = PAGE_H - 26;
    }
  }

  // ── Sidebar section label ──────────────────────────────────────────────────
  function sidebarLabel(title) {
    sY -= SB_SG;
    page.drawRectangle({
      x: SB_PAD,
      y: sY + 3,
      width: 20,
      height: 1.5,
      color: TEAL,
    });
    sY -= 5;
    page.drawText(title.toUpperCase(), {
      x: SB_PAD,
      y: sY,
      size: 7,
      font: fonts.semi,
      color: SB_LBL,
      characterSpacing: 1.5,
    });
    sY -= 9;
    page.drawRectangle({
      x: SB_PAD,
      y: sY,
      width: SB_TW,
      height: 0.5,
      color: rgb(0.14, 0.28, 0.46),
    });
    sY -= 11;
  }

  // ── Sidebar item with teal square dot ─────────────────────────────────────
  function sidebarItem(text) {
    const lines = wrapText(text, fonts.light, SMALL_SZ, SB_TW - 10);
    for (let i = 0; i < lines.length; i++) {
      if (i === 0)
        page.drawRectangle({
          x: SB_PAD,
          y: sY + 4,
          width: 3,
          height: 3,
          color: TEAL,
        });
      page.drawText(lines[i], {
        x: SB_PAD + 9,
        y: sY,
        size: SMALL_SZ,
        font: fonts.light,
        color: SB_BODY,
      });
      sY -= SB_LH;
    }
    sY -= 1;
  }

  // ── Main content text ──────────────────────────────────────────────────────
  function mainText(text, opts = {}) {
    const fnt = opts.font ?? fonts.light;
    const size = opts.size ?? BODY_SZ;
    const indent = opts.indent ?? 0;
    const col = opts.colour ?? DARK;
    const mw = opts.maxW ?? CW - indent;
    for (const line of wrapText(text, fnt, size, mw)) {
      ensureMain(LINE_H);
      page.drawText(line, { x: CX + indent, y, size, font: fnt, color: col });
      y -= LINE_H;
    }
  }

  // ── Bullet item in main content ────────────────────────────────────────────
  function mainBullet(text) {
    const lines = wrapText(text, fonts.light, BLLT_SZ, CW - 14);
    for (let i = 0; i < lines.length; i++) {
      ensureMain(LINE_H);
      if (i === 0)
        page.drawRectangle({
          x: CX + 3,
          y: y + 4,
          width: 3,
          height: 3,
          color: TEAL,
        });
      page.drawText(lines[i], {
        x: CX + 13,
        y,
        size: BLLT_SZ,
        font: fonts.light,
        color: DARK,
      });
      y -= LINE_H;
    }
  }

  // ── Main section header ────────────────────────────────────────────────────
  function mainSection(title) {
    y -= SECT_G;
    ensureMain(LINE_H + 12);
    page.drawText(title.toUpperCase(), {
      x: CX,
      y,
      size: HEAD_SZ,
      font: fonts.semi,
      color: NAVY,
      characterSpacing: 1.3,
    });
    y -= HEAD_SZ + 5;
    page.drawRectangle({ x: CX, y, width: CW, height: 1.5, color: TEAL });
    y -= 13;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SIDEBAR (page 1 only)
  // ════════════════════════════════════════════════════════════════════════════

  // Name — centred, Inter Bold white
  for (const line of wrapText(
    safeText(sections.candidateName),
    fonts.bold,
    NAME_SZ,
    SB_TW,
  )) {
    const xC = Math.max(
      SB_PAD,
      (SB - fonts.bold.widthOfTextAtSize(line, NAME_SZ)) / 2,
    );
    page.drawText(line, {
      x: xC,
      y: sY,
      size: NAME_SZ,
      font: fonts.bold,
      color: WHITE,
    });
    sY -= NAME_SZ + 5;
  }

  // Role subtitle — centred, Inter Medium light teal
  sY -= 2;
  for (const line of wrapText(
    safeText(sections.experience?.[0]?.title ?? "IT Contract Professional"),
    fonts.med,
    8,
    SB_TW,
  )) {
    const xC = Math.max(
      SB_PAD,
      (SB - fonts.med.widthOfTextAtSize(line, 8)) / 2,
    );
    page.drawText(line, {
      x: xC,
      y: sY,
      size: 8,
      font: fonts.med,
      color: TEAL_XL,
    });
    sY -= 11;
  }

  // Thin teal separator
  sY -= 7;
  page.drawRectangle({
    x: SB_PAD + 14,
    y: sY,
    width: SB_TW - 28,
    height: 0.75,
    color: TEAL,
  });
  sY -= 8;

  if (sections.coreSkills?.length) {
    sidebarLabel("Core Skills");
    for (const s of sections.coreSkills) sidebarItem(s);
  }
  if (sections.certifications?.length) {
    sidebarLabel("Certifications");
    for (const c of sections.certifications) sidebarItem(c);
  }
  if (sections.education?.length) {
    sidebarLabel("Education");
    for (const e of sections.education) sidebarItem(e);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MAIN CONTENT
  // ════════════════════════════════════════════════════════════════════════════

  if (sections.professionalSummary) {
    mainSection("Professional Summary");
    mainText(sections.professionalSummary, { font: fonts.light });
  }

  if (sections.experience?.length) {
    mainSection("Professional Experience");
    for (const exp of sections.experience) {
      ensureMain(LINE_H * 4);

      // Job title
      mainText(exp.title, { font: fonts.bold, size: 10.5, colour: DARK });

      // Company (left) + period (right-aligned)
      if (exp.company || exp.period) {
        ensureMain(SM_LH);
        const company = safeText(exp.company ?? "");
        const period = exp.period ? safeText(exp.period) : "";
        page.drawText(company, {
          x: CX,
          y,
          size: SMALL_SZ,
          font: fonts.semi,
          color: TEAL,
        });
        if (period) {
          const pW = fonts.reg.widthOfTextAtSize(period, SMALL_SZ);
          page.drawText(period, {
            x: CX + CW - pW,
            y,
            size: SMALL_SZ,
            font: fonts.reg,
            color: SLATE,
          });
        }
        y -= LINE_H;
      }

      for (const b of exp.bullets ?? []) mainBullet(b);
      y -= 10;
    }
  }

  if (sections.keyAchievements?.length) {
    mainSection("Key Achievements");
    for (const ach of sections.keyAchievements) mainBullet(ach);
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

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

async function main() {
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
  if (!candidate.rawCV?.trim()) throw new Error("No rawCV stored");

  console.log(`Building formatted CV PDF for: ${candidate.fullName}`);
  console.log("Calling AI...");

  const base =
    process.env.LLMLITE_API_BASE ||
    process.env.OPENAI_API_BASE ||
    process.env.OPENAI_BASE_URL;
  const key = process.env.LLMLITE_API_KEY || process.env.OPENAI_API_KEY;
  if (!base || !key)
    throw new Error(
      "LLM env vars not set — ensure .env.local has OPENAI_API_BASE and OPENAI_API_KEY",
    );

  const url = base.replace(/\/$/, "") + "/chat/completions";

  const result = await httpPost(
    url,
    {
      model: process.env.LLMLITE_MODEL || "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert CV writer for UK/SA IT contract placements. Return ONLY valid JSON with this schema:
{"candidateName":"string","professionalSummary":"string","coreSkills":["string"],"certifications":["string"],"experience":[{"title":"string","company":"string","period":"string","bullets":["string"]}],"education":["string"],"keyAchievements":["string"]}
Rules: British English, no contact info, reverse-chronological, achievement-led bullets.`,
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

  if (result.status !== 200) throw new Error(`LLM error ${result.status}`);

  const sections = JSON.parse(result.body?.choices?.[0]?.message?.content);
  console.log("Building PDF...");

  const pdfBuffer = await buildPdf(sections);

  // Render plain text
  const lines = [];
  lines.push(sections.candidateName.toUpperCase(), "");
  lines.push(
    "PROFESSIONAL SUMMARY",
    "─".repeat(60),
    sections.professionalSummary,
    "",
  );
  if (sections.coreSkills?.length)
    lines.push(
      "CORE SKILLS & TECHNOLOGIES",
      "─".repeat(60),
      sections.coreSkills.join(" | "),
      "",
    );
  if (sections.certifications?.length)
    lines.push(
      "CERTIFICATIONS",
      "─".repeat(60),
      ...sections.certifications.map((c) => `• ${c}`),
      "",
    );
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
  if (sections.education?.length)
    lines.push(
      "EDUCATION",
      "─".repeat(60),
      ...sections.education.map((e) => `• ${e}`),
      "",
    );
  if (sections.keyAchievements?.length)
    lines.push(
      "KEY ACHIEVEMENTS",
      "─".repeat(60),
      ...sections.keyAchievements.map((a) => `• ${a}`),
      "",
    );
  const formattedText = lines.join("\n");

  const safeSlug = candidate.fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const formattedCvFileName = `${safeSlug}-formatted.pdf`;

  // Also write PDF to temp/ for direct viewing
  const pdfPath = path.join(__dirname, `_${CANDIDATE_ID}.pdf`);
  fs.writeFileSync(pdfPath, pdfBuffer);
  console.log(`PDF written to: ${pdfPath}`);

  // Save to DB (host Prisma client pointing at prod.db)
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
  console.log(`  fileName  : ${formattedCvFileName}`);
  console.log(`  pdfBytes  : ${pdfBuffer.byteLength}`);
  console.log(`  textLength: ${formattedText.length}`);
  console.log(
    `\nDownload URL (app): http://localhost:3001/api/candidates/${CANDIDATE_ID}/formatted-cv`,
  );

  await p.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  p.$disconnect();
  process.exit(1);
});
