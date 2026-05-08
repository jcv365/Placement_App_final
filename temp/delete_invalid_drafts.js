/**
 * Delete email drafts for jobs that have geographic location restrictions
 * that exclude South Africa-based candidates.
 *
 * This targets:
 * - India-only roles (must be based in Pune/Bengaluru/Chennai/etc.)
 * - UK-only roles (SC Clearance, UK-based only, sole UK national)
 * - Europe-only roles (must be based in Europe)
 *
 * It does NOT delete drafts for "UK-based client, remote from SA" roles.
 */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

// Patterns that indicate a location restriction incompatible with SA candidates
const INCOMPATIBLE_PATTERNS = [
  /\bbased\s+in\s+(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata)\b/i,
  /\bmust\s+be\s+based\s+in\s+(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata|india)\b/i,
  /\blocation[\s:]*\s*(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata)\b/i,
  /\bpan\s+india\b/i,
  /\bwork\s+from\s+office\b.*(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi)/i,
  /\bmust\s+be\s+based\s+in\s+europe\b/i,
  /\bbased\s+in\s+(?:the\s+)?uk\s+only\b/i,
  /\buk[\s-]based\s+only\b/i,
  /\bbased\s+in\s+uk\s+only\b/i,
  /\buk\s*\/\s*eu\s+only\b/i,
  /\buk\s+only\b/i,
  /\bmust\s+be\s+(?:based\s+in|resident\s+in)\s+(?:the\s+)?uk\b/i,
  /\bsc[\s-]?clearance\b/i,
  /\besc[\s-]?clearance\b/i,
  /\bsecurity[\s-]clearance\b/i,
  /\bsole\s+uk\s+national\b/i,
  /\bbpss\b/i,
  /\bdbs[\s-]check\b/i,
];

// Patterns that indicate the role is actually fine for SA candidates
// (UK-based client, remote from SA)
const SA_COMPATIBLE_PATTERNS = [
  /\bmust\s+be\s+currently\s+based\s+in\s+south\s+africa\b/i,
  /\bfully\s+remote\s*[\(]\s*sa\s*[\)]/i,
  /\bremote\s+from\s+south\s+africa\b/i,
  /\bwork\s+from\s+south\s+africa\b/i,
  /\bsouth\s+african\s+professionals\b/i,
];

function isIncompatibleWithSa(title, rawText) {
  const haystack = `${title} ${rawText}`;

  // If the JD explicitly says it's for SA candidates, it's compatible
  for (const pattern of SA_COMPATIBLE_PATTERNS) {
    if (pattern.test(haystack)) return false;
  }

  // Check for incompatible patterns
  for (const pattern of INCOMPATIBLE_PATTERNS) {
    if (pattern.test(haystack)) return true;
  }

  return false;
}

async function main() {
  // Find all jobs with incompatible location restrictions
  const allJobs = await p.job.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: { id: true, title: true, rawText: true },
  });

  const incompatibleJobIds = [];
  for (const job of allJobs) {
    if (isIncompatibleWithSa(job.title, job.rawText)) {
      incompatibleJobIds.push(job.id);
    }
  }
  console.log(
    `Found ${incompatibleJobIds.length} jobs with incompatible location restrictions`,
  );

  // Find and delete email drafts for these jobs
  const draftsToDelete = await p.emailDraft.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      application: { jobId: { in: incompatibleJobIds } },
    },
    select: { id: true, subject: true, applicationId: true },
  });

  console.log(`Found ${draftsToDelete.length} email drafts to delete`);

  if (draftsToDelete.length === 0) {
    console.log("No drafts to delete. Exiting.");
    await p.$disconnect();
    return;
  }

  // Show what we're about to delete
  for (const d of draftsToDelete.slice(0, 10)) {
    console.log(`  Deleting: ${d.subject}`);
  }
  if (draftsToDelete.length > 10) {
    console.log(`  ... and ${draftsToDelete.length - 10} more`);
  }

  // Delete the drafts
  const result = await p.emailDraft.deleteMany({
    where: {
      id: { in: draftsToDelete.map((d) => d.id) },
    },
  });

  console.log(`\nDeleted ${result.count} email drafts`);

  // Also check if any applications should be cleaned up
  // (applications that only had drafts for incompatible jobs)
  const orphanedApps = await p.application.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      jobId: { in: incompatibleJobIds },
      emailDrafts: { none: {} },
    },
    select: { id: true },
  });
  console.log(
    `Found ${orphanedApps.length} applications with no remaining drafts for incompatible jobs`,
  );

  await p.$disconnect();
}

main().catch((e) => console.error(e));
