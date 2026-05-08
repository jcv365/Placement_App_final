import type { FormattedCvSections } from "@/lib/cvFormatter";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import path from "path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

type PdfJsTextItem = {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
};

type RedactPdfParams = {
  pdfBytes: Uint8Array | Buffer;
  email?: string | null;
  phone?: string | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildContactPatterns(params: {
  email?: string | null;
  phone?: string | null;
}): RegExp[] {
  const patterns: RegExp[] = [];

  if (params.email?.trim()) {
    patterns.push(new RegExp(escapeRegExp(params.email.trim()), "i"));
  }

  if (params.phone?.trim()) {
    patterns.push(new RegExp(escapeRegExp(params.phone.trim()), "i"));
  }

  patterns.push(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  patterns.push(/(?:\+?\d[\d\s().-]{7,}\d)/);
  patterns.push(/https?:\/\/(?:www\.)?linkedin\.com\/[A-Za-z0-9\-_/?.=&%]+/i);

  return patterns;
}

function shouldRedactText(value: string, patterns: RegExp[]): boolean {
  const text = value.trim();
  if (!text) return false;

  return patterns.some((pattern) => {
    const match = text.match(pattern);
    if (!match) return false;

    if (pattern.source.includes("\\+?\\d")) {
      const digits = match[0].replace(/\D/g, "");
      return digits.length >= 8 && digits.length <= 15;
    }

    return true;
  });
}

export async function redactContactDetailsInPdf(
  params: RedactPdfParams,
): Promise<Buffer> {
  const inputBytes =
    params.pdfBytes instanceof Buffer
      ? params.pdfBytes
      : Buffer.from(params.pdfBytes);

  const patterns = buildContactPatterns({
    email: params.email,
    phone: params.phone,
  });

  const [{ getDocument }, pdfDoc] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    PDFDocument.load(inputBytes),
  ]);

  const loadingTask = getDocument({ data: new Uint8Array(inputBytes) });
  const sourcePdf = await loadingTask.promise;
  const editablePages = pdfDoc.getPages();

  const pageCount = Math.min(sourcePdf.numPages, editablePages.length);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const sourcePage = await sourcePdf.getPage(pageIndex + 1);
    const textContent = await sourcePage.getTextContent();
    const targetPage = editablePages[pageIndex];
    const pageHeight = targetPage.getHeight();

    for (const rawItem of textContent.items as PdfJsTextItem[]) {
      const text = rawItem.str ?? "";
      if (!shouldRedactText(text, patterns)) {
        continue;
      }

      const transform = rawItem.transform;
      if (!transform || transform.length < 6) {
        continue;
      }

      const x = Number(transform[4] ?? 0);
      const yFromBottom = Number(transform[5] ?? 0);
      const width = Math.max(6, Number(rawItem.width ?? 0));
      const textHeight = Math.max(
        8,
        Math.abs(Number(rawItem.height ?? 0)) ||
          Math.abs(Number(transform[3] ?? 0)),
      );

      const y = Math.max(
        0,
        Math.min(pageHeight - 1, yFromBottom - textHeight * 0.85),
      );

      targetPage.drawRectangle({
        x: Math.max(0, x - 1),
        y,
        width: Math.min(width + 2, targetPage.getWidth()),
        height: Math.min(textHeight + 2, pageHeight - y),
        color: rgb(0, 0, 0),
      });
    }
  }

  await sourcePdf.destroy();
  const output = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(output);
}

function redactContactDetailsInText(text: string, patterns: RegExp[]): string {
  let output = text;

  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    const globalPattern = new RegExp(pattern.source, flags);

    if (pattern.source.includes("linkedin\\.com")) {
      output = output.replace(globalPattern, "[REDACTED_LINKEDIN]");
      continue;
    }

    if (pattern.source.includes("\\+?\\d")) {
      output = output.replace(globalPattern, "[REDACTED_PHONE]");
      continue;
    }

    output = output.replace(globalPattern, "[REDACTED_EMAIL]");
  }

  return output;
}

function wrapTextToWidth(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split(/\r?\n/);

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxCharsPerLine) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }

    if (current) lines.push(current);
  }

  return lines;
}

export async function buildRedactedCvPdfFromText(params: {
  cvText: string;
  candidateName?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<Buffer> {
  const patterns = buildContactPatterns({
    email: params.email,
    phone: params.phone,
  });

  const sourceText =
    params.cvText?.trim() || "Curriculum vitae details unavailable.";
  const redactedText = redactContactDetailsInText(sourceText, patterns);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595;
  const pageHeight = 842;
  const marginX = 42;
  const marginTop = 48;
  const marginBottom = 42;
  const lineHeight = 14;

  const heading = `${params.candidateName?.trim() || "Candidate"} CV (contact details redacted)`;
  const bodyLines = wrapTextToWidth(redactedText, 92);

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - marginTop;

  page.drawText(heading, {
    x: marginX,
    y,
    size: 13,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  y -= 24;

  for (const line of bodyLines) {
    if (y < marginBottom) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - marginTop;
    }

    page.drawText(line || " ", {
      x: marginX,
      y,
      size: 10,
      font,
      color: rgb(0, 0, 0),
      maxWidth: pageWidth - marginX * 2,
    });
    y -= lineHeight;
  }

  const output = await pdf.save({ useObjectStreams: false });
  return Buffer.from(output);
}

// ─── Formatted CV PDF (two-column sidebar, Inter font) ────────────────────────

/**
 * Build a professionally formatted CV PDF using Inter font.
 * Two-column layout: navy sidebar (name, skills, certs, education) +
 * white main content panel (summary, experience, achievements).
 * No contact information is included. Returns a Buffer of PDF bytes.
 */
export async function buildFormattedCvPdf(
  sections: FormattedCvSections,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
  const loadFont = (name: string) =>
    pdf.embedFont(fs.readFileSync(path.join(FONT_DIR, name)));

  const fonts = {
    reg: await loadFont("Inter-Regular.ttf"),
    med: await loadFont("Inter-Medium.ttf"),
    semi: await loadFont("Inter-SemiBold.ttf"),
    bold: await loadFont("Inter-Bold.ttf"),
    light: await loadFont("Inter-Light.ttf"),
  };

  // ── Layout constants ─────────────────────────────────────────────────────────
  const PAGE_W = 595;
  const PAGE_H = 842;
  const SB = 163; // sidebar width
  const SB_PAD = 16; // sidebar inner horizontal padding
  const SB_TW = SB - SB_PAD - 10; // sidebar text max width = 137pt
  const CX = SB + 18; // main content left edge = 181pt
  const CR = 36; // main content right margin
  const CW = PAGE_W - CX - CR; // main content width = 378pt
  const MB = 44; // bottom margin
  const BODY_SIZE = 9.5;
  const SMALL_SIZE = 8.5;
  const BLLT_SIZE = 9;
  const HEAD_SIZE = 8.5;
  const NAME_SIZE = 17;
  const LINE_H = 17.5;
  const SM_LH = 16;
  const SB_LH = 15.5;
  const SECT_GAP = 24;
  const SB_SECT_G = 17;

  // ── Colour palette ───────────────────────────────────────────────────────────
  const NAVY = rgb(0.055, 0.15, 0.32); // deep navy sidebar
  const TEAL = rgb(0.04, 0.67, 0.67); // primary teal accent
  const TEAL_XL = rgb(0.6, 0.9, 0.92); // light teal for sidebar subtitle
  const SB_BODY = rgb(0.75, 0.83, 0.91); // sidebar body text (pale slate-blue)
  const SB_LBL = rgb(0.42, 0.72, 0.78); // sidebar section label (muted teal)
  const RULE_L = rgb(0.87, 0.9, 0.93); // faint rule in main content
  const DARK = rgb(0.12, 0.13, 0.15); // near-black body text
  const SLATE = rgb(0.44, 0.48, 0.54); // dates / secondary text
  const WHITE = rgb(1, 1, 1);

  // ── Mutable page state ───────────────────────────────────────────────────────
  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y: number = PAGE_H - 26; // main content cursor
  let sY: number = PAGE_H - 22; // sidebar cursor (page 1 only)

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function safeT(raw: string): string {
    return (raw ?? "")
      .replace(/[\u2022\u2023\u25E6]/g, "-")
      .replace(/\u2013|\u2014/g, "-")
      .replace(/\u2018|\u2019/g, "'")
      .replace(/\u201C|\u201D/g, '"')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function wrap(
    text: string,
    font: PDFFont,
    size: number,
    maxW: number,
  ): string[] {
    const words = safeT(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) <= maxW) {
        cur = t;
      } else {
        if (cur) lines.push(cur);
        if (font.widthOfTextAtSize(w, size) > maxW) {
          let part = "";
          for (const ch of w) {
            const seg = part + ch;
            if (font.widthOfTextAtSize(seg, size) <= maxW) {
              part = seg;
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

  function decoratePage(pg: PDFPage): void {
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
    }); // sidebar
    pg.drawRectangle({ x: SB, y: 0, width: 2, height: PAGE_H, color: TEAL }); // border
    pg.drawRectangle({ x: 0, y: 0, width: SB, height: 4, color: TEAL }); // bottom bar
  }
  decoratePage(page);

  function ensureMain(h: number): void {
    if (y - h < MB) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      decoratePage(page);
      y = PAGE_H - 26;
    }
  }

  function sidebarLabel(title: string): void {
    sY -= SB_SECT_G;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
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

  function sidebarItem(rawText: string): void {
    const lines = wrap(rawText, fonts.light, SMALL_SIZE, SB_TW - 10);
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
        size: SMALL_SIZE,
        font: fonts.light,
        color: SB_BODY,
      });
      sY -= SB_LH;
    }
    sY -= 1;
  }

  function mainText(
    rawText: string,
    opts: {
      font?: PDFFont;
      size?: number;
      indent?: number;
      colour?: ReturnType<typeof rgb>;
      maxW?: number;
    } = {},
  ): void {
    const fnt = opts.font ?? fonts.light;
    const size = opts.size ?? BODY_SIZE;
    const indent = opts.indent ?? 0;
    const col = opts.colour ?? DARK;
    const mw = opts.maxW ?? CW - indent;
    for (const line of wrap(rawText, fnt, size, mw)) {
      ensureMain(LINE_H);
      page.drawText(line, { x: CX + indent, y, size, font: fnt, color: col });
      y -= LINE_H;
    }
  }

  function mainBullet(rawText: string): void {
    const lines = wrap(rawText, fonts.light, BLLT_SIZE, CW - 14);
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
        size: BLLT_SIZE,
        font: fonts.light,
        color: DARK,
      });
      y -= LINE_H;
    }
  }

  function mainSection(title: string): void {
    y -= SECT_GAP;
    ensureMain(LINE_H + 12);
    page.drawText(title.toUpperCase(), {
      x: CX,
      y,
      size: HEAD_SIZE,
      font: fonts.semi,
      color: NAVY,
      characterSpacing: 1.3,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    y -= HEAD_SIZE + 5;
    page.drawRectangle({ x: CX, y, width: CW, height: 1.5, color: TEAL });
    y -= 13;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SIDEBAR (page 1 only)
  // ════════════════════════════════════════════════════════════════════════════

  // Name — centred, Inter Bold white
  for (const line of wrap(
    safeT(sections.candidateName),
    fonts.bold,
    NAME_SIZE,
    SB_TW,
  )) {
    const xC = Math.max(
      SB_PAD,
      (SB - fonts.bold.widthOfTextAtSize(line, NAME_SIZE)) / 2,
    );
    page.drawText(line, {
      x: xC,
      y: sY,
      size: NAME_SIZE,
      font: fonts.bold,
      color: WHITE,
    });
    sY -= NAME_SIZE + 5;
  }

  // Role subtitle — centred, Inter Medium light teal
  sY -= 2;
  for (const line of wrap(
    safeT(sections.experience?.[0]?.title ?? "IT Contract Professional"),
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

  if (sections.coreSkills.length > 0) {
    sidebarLabel("Core Skills");
    for (const s of sections.coreSkills) sidebarItem(s);
  }
  if (sections.certifications.length > 0) {
    sidebarLabel("Certifications");
    for (const c of sections.certifications) sidebarItem(c);
  }
  if (sections.education.length > 0) {
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

  if (sections.experience.length > 0) {
    mainSection("Professional Experience");
    for (const exp of sections.experience) {
      ensureMain(LINE_H * 4);

      // Job title — bold, near-black
      mainText(exp.title, { font: fonts.bold, size: 10.5, colour: DARK });

      // Company (left) + period (right-aligned on same baseline)
      if (exp.company || exp.period) {
        ensureMain(SM_LH);
        const company = safeT(exp.company ?? "");
        const period = exp.period ? safeT(exp.period) : "";
        page.drawText(company, {
          x: CX,
          y,
          size: SMALL_SIZE,
          font: fonts.semi,
          color: TEAL,
        });
        if (period) {
          const pW = fonts.reg.widthOfTextAtSize(period, SMALL_SIZE);
          page.drawText(period, {
            x: CX + CW - pW,
            y,
            size: SMALL_SIZE,
            font: fonts.reg,
            color: SLATE,
          });
        }
        y -= LINE_H;
      }

      for (const bullet of exp.bullets) mainBullet(bullet);
      y -= 10;
    }
  }

  if (sections.keyAchievements.length > 0) {
    mainSection("Key Achievements");
    for (const ach of sections.keyAchievements) mainBullet(ach);
  }

  const output = await pdf.save({ useObjectStreams: false });
  return Buffer.from(output);
}
