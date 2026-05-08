const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const p = new PrismaClient();

async function main() {
  const candidates = await p.candidate.findMany({
    select: { id: true, fullName: true, createdAt: true },
  });

  console.log("Total candidates in DB:", candidates.length);
  candidates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const cvDir = path.join(__dirname, "..", "cv");
  const existingDirs = fs.existsSync(cvDir)
    ? fs.readdirSync(cvDir).map((d) => d.toLowerCase())
    : [];

  console.log("\nExisting CV PDF folders:", existingDirs.length);
  console.log("\n--- All candidates ---");
  for (const c of candidates) {
    const slug = c.fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const hasPdf =
      existingDirs.includes(slug) &&
      fs.existsSync(path.join(cvDir, slug, slug + ".pdf"));
    console.log(
      hasPdf ? "  [OK]" : "  [MISSING]",
      c.id,
      JSON.stringify(c.fullName),
      c.createdAt,
    );
  }

  await p.$disconnect();
}

main();
