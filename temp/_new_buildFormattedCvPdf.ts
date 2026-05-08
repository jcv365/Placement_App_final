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
  const LINE_H = 14.5;
  const SM_LH = 13;
  const SB_LH = 13;
  const SECT_GAP = 20;
  const SB_SECT_G = 15;

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
    });
    sY -= 9;
    page.drawRectangle({
      x: SB_PAD,
      y: sY,
      width: SB_TW,
      height: 0.5,
      color: rgb(0.14, 0.28, 0.46),
    });
    sY -= 7;
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
    });
    y -= HEAD_SIZE + 5;
    page.drawRectangle({ x: CX, y, width: CW, height: 1.5, color: TEAL });
    y -= 8;
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
        y -= SM_LH + 2;
      }

      // Very faint rule below company row
      page.drawRectangle({ x: CX, y, width: CW, height: 0.4, color: RULE_L });
      y -= 6;

      for (const bullet of exp.bullets) mainBullet(bullet);
      y -= 6;
    }
  }

  if (sections.keyAchievements.length > 0) {
    mainSection("Key Achievements");
    for (const ach of sections.keyAchievements) mainBullet(ach);
  }

  const output = await pdf.save({ useObjectStreams: false });
  return Buffer.from(output);
}
