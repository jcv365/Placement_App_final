// Applies the formattedCv columns to the SQLite DB, bypassing prisma migrate.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const stmts = [
  'ALTER TABLE Candidate ADD COLUMN "formattedCvText" TEXT',
  'ALTER TABLE Candidate ADD COLUMN "formattedCvPdfData" BLOB',
  'ALTER TABLE Candidate ADD COLUMN "formattedCvFileName" TEXT',
  'ALTER TABLE Candidate ADD COLUMN "formattedCvGeneratedAt" DATETIME',
];

async function main() {
  for (const sql of stmts) {
    try {
      await p.$executeRawUnsafe(sql);
      console.log("OK:", sql);
    } catch (e) {
      // SQLite raises "duplicate column name" when the column already exists — that's fine.
      if (e.message && e.message.includes("duplicate column name")) {
        console.log("SKIP (already exists):", sql);
      } else {
        throw e;
      }
    }
  }
  console.log("Migration complete.");
}

main()
  .then(() => p.$disconnect())
  .catch((e) => {
    console.error("FATAL:", e.message);
    p.$disconnect();
    process.exit(1);
  });
