/**
 * cleanupOpportunityTitles.ts
 *
 * Backfill script: strips junk from opportunity (Job) titles that were imported
 * with LinkedIn post text, person names, company names, emoji, or "Hiring:"
 * prefixes. Titles that have no recognisable role keyword are deleted outright
 * (the job had no meaningful vacancy data).
 *
 * Usage: npx tsx scripts/cleanupOpportunityTitles.ts [--apply]
 *   Without --apply: dry-run only (prints what would change).
 *   With    --apply: writes changes to the database.
 */

import { generateStructuredJson } from "@/lib/aiJson";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// ── Title sanitisation ──────────────────────────────────────────────────────

const SEARCH_TERM_TOKENS = new Set([
  "contract",
  "contracts",
  "remote",
  "hybrid",
  "onsite",
  "outside",
  "inside",
  "ir35",
  "outsideir35",
  "insideir35",
  "uk",
  "eu",
  "europe",
  "us",
  "usa",
  "india",
  "only",
]);

function sanitiseRoleTitle(value: string): string {
  // Strip emoji first, trim, then strip leading junk labels.
  const emojiStripped = value
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{200D}\u{20E3}]/gu,
      "",
    )
    .trim();

  const stripped = emojiStripped
    .replace(
      /^(?:#hiring|hiring|urgent(?:\s+hiring)?|we'?re\s+hiring|we\s+are\s+hiring|now\s+hiring|immediately\s+hiring|looking\s+for)\s*[:\-–]?\s*/i,
      "",
    )
    .replace(
      /^(?:job\s+title|position(?:\s+(?:name|title))?|title|role)\s*[:\-–]\s*/i,
      "",
    )
    .replace(/\s*@\s*\S.*$/, "")
    .replace(/\s*[-–]\s*(?:division|team|group|department)\s+at\s+.+$/i, "")
    .trim();

  const cleaned = stripped
    .replace(/[()[\],]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const kept = cleaned
    .split(" ")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !SEARCH_TERM_TOKENS.has(p.toLowerCase()));

  const title = kept.join(" ").replace(/\s+/g, " ").trim();
  return title || cleaned;
}

// ── AI job-title verification ────────────────────────────────────────────────

type AiTitleCheckResult = { isJobTitle: boolean; rationale: string };

async function isLegitimateJobTitleAi(title: string): Promise<boolean> {
  try {
    const result = await generateStructuredJson<AiTitleCheckResult>({
      systemPrompt:
        'You are a job data quality assistant. Determine whether the given text is a legitimate IT/tech/business job title. Respond with valid JSON: { "isJobTitle": true|false, "rationale": "<one sentence>" }',
      userPrompt: `Text: "${title}"`,
      maxTokens: 80,
      temperature: 0.1,
    });
    return result?.isJobTitle === true;
  } catch {
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

type Action = "update" | "delete";

interface Change {
  id: string;
  action: Action;
  from: string;
  to?: string;
  reason: string;
}

async function run(): Promise<void> {
  console.log(
    `Running in ${APPLY ? "APPLY" : "DRY-RUN"} mode. Pass --apply to write changes.\n`,
  );

  const jobs = await prisma.job.findMany({
    select: { id: true, title: true },
  });

  const changes: Change[] = [];

  for (const job of jobs) {
    const sanitised = sanitiseRoleTitle(job.title);

    if (!sanitised) {
      // Nothing left after cleaning — AI decides whether original was valid.
      const aiSaysLegit = await isLegitimateJobTitleAi(job.title);
      if (!aiSaysLegit) {
        changes.push({
          id: job.id,
          action: "delete",
          from: job.title,
          reason: "no recognisable role after sanitisation",
        });
      }
      continue;
    }

    if (sanitised !== job.title) {
      // Title changed — AI confirms the sanitised version is a real role.
      const aiSaysLegit = await isLegitimateJobTitleAi(sanitised);
      if (!aiSaysLegit) {
        changes.push({
          id: job.id,
          action: "delete",
          from: job.title,
          reason: "AI: not a valid job title after sanitisation",
        });
      } else {
        changes.push({
          id: job.id,
          action: "update",
          from: job.title,
          to: sanitised,
          reason: "junk stripped",
        });
      }
      continue;
    }
  }

  const updates = changes.filter((c) => c.action === "update");
  const deletions = changes.filter((c) => c.action === "delete");

  console.log(`Total jobs scanned : ${jobs.length}`);
  console.log(`Titles to update   : ${updates.length}`);
  console.log(`Records to delete  : ${deletions.length}`);
  console.log();

  // Print first 50 changes for inspection.
  const preview = changes.slice(0, 50);
  for (const c of preview) {
    if (c.action === "update") {
      console.log(`UPDATE  "${c.from}"  →  "${c.to}"`);
    } else {
      console.log(`DELETE  "${c.from}"  (${c.reason})`);
    }
  }
  if (changes.length > 50) {
    console.log(`… and ${changes.length - 50} more.`);
  }

  if (!APPLY) {
    console.log("\nDry-run complete. Re-run with --apply to commit changes.");
    await prisma.$disconnect();
    return;
  }

  console.log("\nApplying changes...");

  for (const c of updates) {
    await prisma.job.update({
      where: { id: c.id },
      data: { title: c.to! },
    });
  }

  for (const c of deletions) {
    // Resolve all applications linked to this job first.
    const apps = await prisma.application.findMany({
      where: { jobId: c.id },
      select: { id: true },
    });
    const appIds = apps.map((a) => a.id);

    if (appIds.length > 0) {
      // Delete in dependency order: Invoice → Timesheet → child records → Application.
      const timesheets = await prisma.timesheet.findMany({
        where: { applicationId: { in: appIds } },
        select: { id: true },
      });
      const timesheetIds = timesheets.map((t) => t.id);
      if (timesheetIds.length > 0) {
        await prisma.invoice.deleteMany({
          where: { timesheetId: { in: timesheetIds } },
        });
      }
      await prisma.timesheet.deleteMany({
        where: { applicationId: { in: appIds } },
      });
      await prisma.placementAlert.deleteMany({
        where: { applicationId: { in: appIds } },
      });
      await prisma.emailDraft.deleteMany({
        where: { applicationId: { in: appIds } },
      });
      await prisma.note.deleteMany({
        where: { applicationId: { in: appIds } },
      });
      await prisma.applicationStageHistory.deleteMany({
        where: { applicationId: { in: appIds } },
      });
      await prisma.application.deleteMany({ where: { id: { in: appIds } } });
    }

    await prisma.job.delete({ where: { id: c.id } });
  }

  console.log(`Done. Updated ${updates.length}, deleted ${deletions.length}.`);
  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
