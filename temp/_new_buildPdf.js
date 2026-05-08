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
  const LINE_H = 14.5;
  const SM_LH = 13;
  const SB_LH = 13;
  const SECT_G = 20;
  const SB_SG = 15;

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
    sY -= 7;
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
    y -= 8;
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
        y -= SM_LH + 2;
      }

      // Faint rule below company row
      page.drawRectangle({ x: CX, y, width: CW, height: 0.4, color: RULE_L });
      y -= 6;

      for (const b of exp.bullets ?? []) mainBullet(b);
      y -= 6;
    }
  }

  if (sections.keyAchievements?.length) {
    mainSection("Key Achievements");
    for (const ach of sections.keyAchievements) mainBullet(ach);
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
