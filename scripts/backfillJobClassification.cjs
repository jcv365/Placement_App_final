/**
 * Backfill script to classify existing jobs that have null isRemote,
 * requiresUsWorkAuth, or requiresUkWorkAuth fields.
 *
 * Run: node scripts/backfillJobClassification.cjs
 *
 * This script reads all jobs where any classification field is null,
 * runs the regex classifiers on title + rawText, and updates the records.
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// ── Classification logic (mirrors src/lib/jobClassification.ts) ──────────

function requiresUsWorkAuthorisation(title, rawText) {
  const haystack = `${title} ${rawText}`.toLowerCase();
  return /\busc(?:itizen)?\b|\bu\.s\.\s*citizen|\bgreen[\s-]card\b|\bgc[\s-]only\b|\bus[\s-]citizen|must\s+be\s+a\s+us|authorized\s+to\s+work\s+in\s+the\s+us|authorised\s+to\s+work\s+in\s+the\s+us|work\s+authoris(?:ed|ation)\s+in\s+the\s+us|us\s+work\s+authoris|\bead\b|employment\s+authoris(?:ation|ed)\s+document|permanent\s+resident|no\s+sponsor(?:ship)?/.test(
    haystack,
  );
}

function requiresUkWorkAuthorisation(title, rawText) {
  const haystack = `${title} ${rawText}`.toLowerCase();
  return /\buk[\s-]citizen|\bright\s+to\s+work\s+in\s+the\s+uk|uk\s+work\s+authoris|indefinite\s+leave\s+to\s+remain|must\s+be\s+a\s+uk|ilr\b|settled\s+status|pre[\s-]settled\s+status|work\s+permit\s+for\s+the\s+uk|uk\s+visa\b|\bsc[\s-]?clearance\b|\besc[\s-]?clearance\b|\bsecurity[\s-]clearance\b|\bsole\s+uk\s+national\b|\bbpss\b|\bdbs[\s-]check\b|\bnpp[\s-]v[\s-]clearance\b|\bctc[\s-]clearance\b/.test(
    haystack,
  );
}

function requiresNonSaLocationRestriction(title, rawText) {
  const haystack = `${title} ${rawText}`.toLowerCase();

  const indiaPatterns =
    /\bbased\s+in\s+(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata)\b|\bmust\s+be\s+based\s+in\s+(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata|india)\b|\blocation[\s:]*\s*(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata)\b|\bpan\s+india\b|\bwork\s+from\s+office\b.*(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi)/;

  const europePatterns =
    /\bmust\s+be\s+based\s+in\s+europe\b|\bbased\s+in\s+(?:the\s+)?uk\s+only\b|\buk[\s-]based\s+only\b|\bbased\s+in\s+(?:the\s+)?eu\b/;

  const ukOnlyPatterns =
    /\bbased\s+in\s+uk\s+only\b|\buk\s*\/\s*eu\s+only\b|\buk\s+only\b|\bmust\s+be\s+(?:based\s+in|resident\s+in)\s+(?:the\s+)?uk\b/;

  return (
    indiaPatterns.test(haystack) ||
    europePatterns.test(haystack) ||
    ukOnlyPatterns.test(haystack)
  );
}

function isRemoteRole(title, rawText) {
  const haystack = `${title} ${rawText}`.toLowerCase();
  return /\bfully[\s-]remote\b|\bremote[\s-]first\b|\bremote[\s-]only\b|\b100%[\s-]remote\b|\bwork[\s-]from[\s-]anywhere\b|\bwork[\s-]from[\s-]home\b|\bwfh\b|\bremote\b/.test(
    haystack,
  );
}

function classifyJob(title, rawText) {
  return {
    isRemote: isRemoteRole(title, rawText) || null,
    requiresUsWorkAuth: requiresUsWorkAuthorisation(title, rawText) || null,
    requiresUkWorkAuth: requiresUkWorkAuthorisation(title, rawText) || null,
    requiresNonSaLocation:
      requiresNonSaLocationRestriction(title, rawText) || null,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching jobs with null classification fields...");

  const jobs = await prisma.job.findMany({
    where: {
      OR: [
        { isRemote: null },
        { requiresUsWorkAuth: null },
        { requiresUkWorkAuth: null },
        { requiresNonSaLocation: null },
      ],
    },
    select: {
      id: true,
      title: true,
      rawText: true,
      isRemote: true,
      requiresUsWorkAuth: true,
      requiresUkWorkAuth: true,
      requiresNonSaLocation: true,
    },
  });

  console.log(`Found ${jobs.length} job(s) to backfill.`);

  let updated = 0;
  let skipped = 0;

  for (const job of jobs) {
    const classification = classifyJob(job.title ?? "", job.rawText ?? "");

    const updates = {};
    if (job.isRemote === null) updates.isRemote = classification.isRemote;
    if (job.requiresUsWorkAuth === null)
      updates.requiresUsWorkAuth = classification.requiresUsWorkAuth;
    if (job.requiresUkWorkAuth === null)
      updates.requiresUkWorkAuth = classification.requiresUkWorkAuth;
    if (job.requiresNonSaLocation === null)
      updates.requiresNonSaLocation = classification.requiresNonSaLocation;

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    await prisma.job.update({
      where: { id: job.id },
      data: updates,
    });

    updated++;
    if (updated % 50 === 0) {
      console.log(`  ... ${updated} jobs updated`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
