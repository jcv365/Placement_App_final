#!/usr/bin/env node
/**
 * Batch CV PDF generator.
 * Generates a formatted PDF for every candidate that has a rawCV,
 * saves each to cv/<candidate-name>/<slug>.pdf on disk,
 * and also persists the bytes to the DB.
 *
 * Usage:  node scripts/generateAllCvPdfs.js [--skip-existing]
 */

const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { PrismaClient } = require("@prisma/client");

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const ROOT = path.join(__dirname, "..");
const FONT_DIR = path.join(ROOT, "assets", "fonts");
const OUT_DIR = path.join(ROOT, "cv");
const SKIP_EXISTING = process.argv.includes("--skip-existing");

const p = new PrismaClient({
  datasources: { db: { url: `file:${path.join(ROOT, "prisma", "prod.db")}` } },
});

// ─── Shared text utilities ────────────────────────────────────────────────────

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

// ─── PDF builder (two-column sidebar, Inter) ──────────────────────────────────

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

  const PAGE_W = 595,
    PAGE_H = 842;
  const SB = 163,
    SB_PAD = 16;
  const SB_TW = SB - SB_PAD - 10;
  const CX = SB + 18,
    CR = 36;
  const CW = PAGE_W - CX - CR;
  const MB = 44;
  const BODY_SZ = 9.5,
    SMALL_SZ = 8.5,
    BLLT_SZ = 9,
    HEAD_SZ = 8.5,
    NAME_SZ = 17;
  const LINE_H = 17.5,
    SM_LH = 16,
    SB_LH = 15.5,
    SECT_G = 24,
    SB_SG = 17;

  const NAVY = rgb(0.055, 0.15, 0.32);
  const TEAL = rgb(0.04, 0.67, 0.67);
  const TEAL_XL = rgb(0.6, 0.9, 0.92);
  const SB_BODY = rgb(0.75, 0.83, 0.91);
  const SB_LBL = rgb(0.42, 0.72, 0.78);
  const DARK = rgb(0.12, 0.13, 0.15);
  const SLATE = rgb(0.44, 0.48, 0.54);
  const WHITE = rgb(1, 1, 1);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 26;
  let sY = PAGE_H - 22;

  function decoratePage(pg) {
    pg.drawRectangle({
      x: 0,
      y: PAGE_H - 5,
      width: PAGE_W,
      height: 5,
      color: TEAL,
    });
    pg.drawRectangle({
      x: 0,
      y: 0,
      width: SB,
      height: PAGE_H - 5,
      color: NAVY,
    });
    pg.drawRectangle({ x: SB, y: 0, width: 2, height: PAGE_H, color: TEAL });
    pg.drawRectangle({ x: 0, y: 0, width: SB, height: 4, color: TEAL });
  }
  decoratePage(page);

  function ensureMain(h) {
    if (y - h < MB) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      decoratePage(page);
      y = PAGE_H - 26;
    }
  }

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

  function mainText(text, opts = {}) {
    const fnt = opts.font ?? fonts.light,
      size = opts.size ?? BODY_SZ;
    const indent = opts.indent ?? 0,
      col = opts.colour ?? DARK;
    const mw = opts.maxW ?? CW - indent;
    for (const line of wrapText(text, fnt, size, mw)) {
      ensureMain(LINE_H);
      page.drawText(line, { x: CX + indent, y, size, font: fnt, color: col });
      y -= LINE_H;
    }
  }

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

  // Sidebar
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

  // Main content
  if (sections.professionalSummary) {
    mainSection("Professional Summary");
    mainText(sections.professionalSummary, { font: fonts.light });
  }

  if (sections.experience?.length) {
    mainSection("Professional Experience");
    for (const exp of sections.experience) {
      ensureMain(LINE_H * 4);
      mainText(exp.title, { font: fonts.bold, size: 10.5, colour: DARK });
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

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpPost(url, body, headers) {
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

// ─── Per-candidate processing ─────────────────────────────────────────────────

function nameToSlug(name) {
  return (name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function processCandidate(candidate, llmUrl, llmKey, idx, total) {
  const label = `[${idx}/${total}] ${candidate.fullName}`;

  const slug = nameToSlug(candidate.fullName);
  const outDir = path.join(OUT_DIR, slug);
  const outFile = path.join(outDir, `${slug}.pdf`);

  if (SKIP_EXISTING) {
    const dbCurrent =
      candidate.formattedCvGeneratedAt != null &&
      candidate.formattedCvGeneratedAt >= candidate.updatedAt;
    const fileExists = fs.existsSync(outFile);
    if (dbCurrent && fileExists) {
      console.log(
        `${label} — skipped (DB generated ${candidate.formattedCvGeneratedAt.toISOString()}, CV last updated ${candidate.updatedAt.toISOString()})`,
      );
      return;
    }
    if (dbCurrent && !fileExists) {
      console.log(
        `${label} — DB up-to-date but PDF missing from disk, regenerating...`,
      );
    } else if (!dbCurrent && fileExists) {
      console.log(
        `${label} — disk file exists but DB is stale or unset, regenerating...`,
      );
    }
  }

  console.log(`${label} — calling AI...`);

  const result = await httpPost(
    llmUrl,
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
    { Authorization: `Bearer ${llmKey}` },
  );

  if (result.status !== 200) {
    throw new Error(
      `LLM returned ${result.status}: ${JSON.stringify(result.body)}`,
    );
  }

  const sections = JSON.parse(result.body?.choices?.[0]?.message?.content);
  console.log(`${label} — building PDF...`);

  const pdfBuffer = await buildPdf(sections);

  // Write to disk under cv/(name)/
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, pdfBuffer);
  console.log(`${label} — saved to ${outFile}`);

  // Build plain-text version for DB
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

  // Persist to DB
  await p.candidate.update({
    where: { id: candidate.id },
    data: {
      formattedCvText: formattedText,
      formattedCvPdfData: new Uint8Array(pdfBuffer),
      formattedCvFileName: `${slug}.pdf`,
      formattedCvGeneratedAt: new Date(),
    },
  });

  console.log(`${label} — done (${pdfBuffer.byteLength} bytes)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const base =
    process.env.LLMLITE_API_BASE ||
    process.env.OPENAI_API_BASE ||
    process.env.OPENAI_BASE_URL;
  const key = process.env.LLMLITE_API_KEY || process.env.OPENAI_API_KEY;
  if (!base || !key)
    throw new Error(
      "LLM env vars not set — ensure .env.local has OPENAI_API_BASE and OPENAI_API_KEY",
    );
  const llmUrl = base.replace(/\/$/, "") + "/chat/completions";

  const candidates = await p.candidate.findMany({
    select: {
      id: true,
      fullName: true,
      skillsCsv: true,
      certificationsCsv: true,
      suggestedRolesCsv: true,
      rawCV: true,
      formattedCvGeneratedAt: true,
      updatedAt: true,
    },
    orderBy: { fullName: "asc" },
  });

  const total = candidates.length;
  console.log(`\nGenerating CVs for ${total} candidates → ${OUT_DIR}\n`);
  if (SKIP_EXISTING)
    console.log(
      "(--skip-existing: skipping candidates whose DB record is current and PDF exists on disk)\n",
    );

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let ok = 0,
    failed = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c.rawCV?.trim()) {
      console.log(`[${i + 1}/${total}] ${c.fullName} — skipped (no rawCV)`);
      continue;
    }
    try {
      await processCandidate(c, llmUrl, key, i + 1, total);
      ok++;
    } catch (err) {
      console.error(
        `[${i + 1}/${total}] ${c.fullName} — FAILED: ${err.message}`,
      );
      failed++;
    }
  }

  console.log(`\n✓ Done — ${ok} generated, ${failed} failed`);
  await p.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL:", e.message);
  await p.$disconnect();
  process.exit(1);
});
