process.chdir("/app");
const { PrismaClient } = require("/app/node_modules/.prisma/client");
const p = new PrismaClient();

async function main() {
  // Check if column already exists
  const cols = await p.$queryRawUnsafe("PRAGMA table_info(Candidate)");
  const exists = cols.some((c) => c.name === "cvStorageMode");
  if (exists) {
    console.log("COLUMN ALREADY EXISTS — no action needed");
  } else {
    await p.$executeRawUnsafe(
      "ALTER TABLE Candidate ADD COLUMN \"cvStorageMode\" TEXT NOT NULL DEFAULT 'FULL'",
    );
    console.log("COLUMN ADDED OK");
  }
  // Also record in _prisma_migrations so Prisma migrate status stays consistent
  const migName = "20260414100000_candidate_cv_storage_mode";
  const existing = await p.$queryRawUnsafe(
    "SELECT id FROM _prisma_migrations WHERE migration_name = ?",
    migName,
  );
  if (existing.length === 0) {
    await p.$executeRawUnsafe(
      "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (lower(hex(randomblob(16))), 'manual', datetime('now'), ?, NULL, NULL, datetime('now'), 1)",
      migName,
    );
    console.log("Migration recorded in _prisma_migrations");
  } else {
    console.log("Migration already recorded");
  }
  await p.$disconnect();
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
