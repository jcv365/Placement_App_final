const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

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

async function main() {
  // Backfill requiresUkWorkAuth (expanded patterns)
  const ukJobs = await p.job.findMany({
    where: { requiresUkWorkAuth: null },
    select: { id: true, title: true, rawText: true },
  });
  let ukUpdated = 0;
  for (const job of ukJobs) {
    if (requiresUkWorkAuthorisation(job.title ?? "", job.rawText ?? "")) {
      await p.job.update({
        where: { id: job.id },
        data: { requiresUkWorkAuth: true },
      });
      ukUpdated++;
    }
  }
  console.log(
    `Updated requiresUkWorkAuth: ${ukUpdated} jobs (from ${ukJobs.length} null)`,
  );

  // Backfill requiresNonSaLocation
  const locationJobs = await p.job.findMany({
    where: { requiresNonSaLocation: null },
    select: { id: true, title: true, rawText: true },
  });
  let locationUpdated = 0;
  for (const job of locationJobs) {
    if (requiresNonSaLocationRestriction(job.title ?? "", job.rawText ?? "")) {
      await p.job.update({
        where: { id: job.id },
        data: { requiresNonSaLocation: true },
      });
      locationUpdated++;
    }
  }
  console.log(
    `Updated requiresNonSaLocation: ${locationUpdated} jobs (from ${locationJobs.length} null)`,
  );

  // Verify
  const ukTrue = await p.job.count({ where: { requiresUkWorkAuth: true } });
  const locTrue = await p.job.count({ where: { requiresNonSaLocation: true } });
  console.log(`\nVerification:`);
  console.log(`  requiresUkWorkAuth=true: ${ukTrue}`);
  console.log(`  requiresNonSaLocation=true: ${locTrue}`);

  await p.$disconnect();
}

main().catch((e) => console.error(e));
