// @ts-check
/**
 * resetTodayDrafts.js
 *
 * Resets email drafts generated today (21 April 2026) so they can be
 * regenerated with the updated prompt rules.
 *
 * What it does:
 *  1. Finds EmailDraft DB records created on 2026-04-21.
 *  2. For each affected application that has NO newer draft, resets its stage
 *     from SENT_TO_CLIENT / EMAIL_DRAFTED → SHORTLISTED and adds history.
 *  3. Deletes the old EmailDraft DB records so the dedup hash will not block
 *     re-generation.
 *  4. Deletes the corresponding Outlook drafts from the mailbox.
 *
 * Run INSIDE the Docker container:
 *   docker exec -w /app <container> node /app/resetTodayDrafts.js
 *   docker exec -w /app <container> node /app/resetTodayDrafts.js --apply
 */

const APPLY = process.argv.includes("--apply");
const HISTORY_MARKER = "Reset — email regeneration (April 21 batch)";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
if (!process.env.GRAPH_TENANT_ID) {
  const fs = require("fs");
  const path = require("path");
  const envFile = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const TENANT_ID = process.env.GRAPH_TENANT_ID?.trim();
const CLIENT_ID = process.env.GRAPH_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET?.trim();
const MAILBOX = (
  process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
  process.env.GRAPH_SENDER_USER?.trim() ||
  ""
).toLowerCase();

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !MAILBOX) {
  console.error(
    "ERROR: Missing Graph credentials (GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, OUTLOOK_SHARED_MAILBOX)",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Date range — today only
// ---------------------------------------------------------------------------
const RANGE_START = new Date("2026-04-21T00:00:00.000Z");
const RANGE_END = new Date("2026-04-22T00:00:00.000Z"); // exclusive

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Graph API helpers
// ---------------------------------------------------------------------------
async function getAccessToken() {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok)
    throw new Error(`Token error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("No access_token in response");
  return json.access_token;
}

async function fetchAllDrafts(token) {
  const enc = encodeURIComponent(MAILBOX);
  let url =
    `https://graph.microsoft.com/v1.0/users/${enc}/mailFolders/Drafts/messages` +
    `?$select=id,subject,toRecipients,createdDateTime&$top=100&$orderby=createdDateTime asc`;
  const messages = [];
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok)
      throw new Error(`GET Drafts error ${res.status}: ${await res.text()}`);
    const page = await res.json();
    if (Array.isArray(page.value)) messages.push(...page.value);
    url = page["@odata.nextLink"] || null;
  }
  return messages;
}

async function deleteOutlookMessage(token, messageId) {
  const enc = encodeURIComponent(MAILBOX);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${enc}/messages/${messageId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok)
    throw new Error(`DELETE error ${res.status}: ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (live)" : "DRY RUN"}`);
  if (!APPLY) {
    console.log("  → Pass --apply to make actual changes.\n");
  }
  console.log(
    `Resetting drafts created between ${RANGE_START.toISOString()} and ${RANGE_END.toISOString()}\n`,
  );

  // Find today's EmailDraft records
  const todayDrafts = await prisma.emailDraft.findMany({
    where: {
      createdAt: { gte: RANGE_START, lt: RANGE_END },
    },
    select: {
      id: true,
      applicationId: true,
      subject: true,
      createdAt: true,
      application: {
        select: {
          id: true,
          currentStage: true,
          opportunityId: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (todayDrafts.length === 0) {
    console.log("No EmailDraft records found for today. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${todayDrafts.length} EmailDraft record(s) from today:`);

  const appIds = [...new Set(todayDrafts.map((d) => d.applicationId))];
  console.log(`  → ${appIds.length} unique application(s) affected\n`);

  // Check for newer drafts (created after today — shouldn't exist, but be safe)
  const newerDraftsByApp = new Map();
  for (const appId of appIds) {
    const newer = await prisma.emailDraft.findFirst({
      where: {
        applicationId: appId,
        createdAt: { gte: RANGE_END },
      },
      select: { id: true },
    });
    newerDraftsByApp.set(appId, !!newer);
  }

  const appsToReset = appIds.filter((id) => !newerDraftsByApp.get(id));
  const appsWithNewerDraft = appIds.filter((id) => newerDraftsByApp.get(id));

  console.log(
    `Applications to reset stage (no newer draft): ${appsToReset.length}`,
  );
  console.log(
    `Applications with a newer draft (stage left alone): ${appsWithNewerDraft.length}\n`,
  );

  for (const draft of todayDrafts) {
    const hasNewer = newerDraftsByApp.get(draft.applicationId);
    console.log(
      `  [${draft.createdAt.toISOString()}] "${draft.subject.slice(0, 60)}…"` +
        `  stage=${draft.application.currentStage}` +
        (hasNewer
          ? "  ← has newer draft, stage PRESERVED"
          : "  ← WILL RESET to SHORTLISTED"),
    );
  }
  console.log();

  if (!APPLY) {
    console.log(
      "Dry run complete. Re-run with --apply to execute the changes.",
    );
    await prisma.$disconnect();
    return;
  }

  // ── LIVE MODE ─────────────────────────────────────────────────────────────

  // Get Graph token + fetch all Outlook Drafts
  console.log("Fetching Graph token...");
  const token = await getAccessToken();
  console.log("✓ Token obtained\n");

  console.log("Fetching Outlook Drafts folder...");
  const allOutlookDrafts = await fetchAllDrafts(token);
  console.log(`  Total Outlook drafts: ${allOutlookDrafts.length}`);

  const oldSubjects = new Set(
    todayDrafts.map((d) => d.subject.trim().toLowerCase()),
  );

  const outlookDraftsToDelete = allOutlookDrafts.filter((msg) => {
    const createdAt = new Date(msg.createdDateTime);
    const subjectMatches = oldSubjects.has(
      (msg.subject || "").trim().toLowerCase(),
    );
    const inRange = createdAt >= RANGE_START && createdAt < RANGE_END;
    return subjectMatches && inRange;
  });

  console.log(
    `  Outlook drafts matched for deletion: ${outlookDraftsToDelete.length}\n`,
  );

  // Delete matched Outlook drafts
  let outlookDeleted = 0;
  let outlookFailed = 0;
  for (const msg of outlookDraftsToDelete) {
    try {
      await deleteOutlookMessage(token, msg.id);
      outlookDeleted++;
      process.stdout.write(
        `\r  Outlook deleted: ${outlookDeleted}/${outlookDraftsToDelete.length}  `,
      );
    } catch (err) {
      outlookFailed++;
      console.error(
        `\n  WARN: Failed to delete Outlook draft "${msg.subject}": ${err.message}`,
      );
    }
  }
  console.log(
    `\n✓ Outlook drafts deleted: ${outlookDeleted} (failed: ${outlookFailed})\n`,
  );

  // Delete DB EmailDraft records
  const oldDraftIds = todayDrafts.map((d) => d.id);
  const deleteResult = await prisma.emailDraft.deleteMany({
    where: { id: { in: oldDraftIds } },
  });
  console.log(`✓ EmailDraft DB records deleted: ${deleteResult.count}\n`);

  // Reset application stages for apps with no newer draft
  let resetCount = 0;
  for (const appId of appsToReset) {
    const app = todayDrafts.find((d) => d.applicationId === appId)?.application;
    if (!app) continue;

    const currentStage = app.currentStage;
    const needsReset =
      currentStage === "SENT_TO_CLIENT" || currentStage === "EMAIL_DRAFTED";

    if (needsReset) {
      await prisma.$transaction([
        prisma.application.update({
          where: { id: appId },
          data: { currentStage: "SHORTLISTED" },
        }),
        prisma.applicationStageHistory.create({
          data: {
            applicationId: appId,
            fromStage: currentStage,
            toStage: "SHORTLISTED",
            changedBy: HISTORY_MARKER,
          },
        }),
      ]);
      resetCount++;
    }
  }
  console.log(`✓ Application stages reset to SHORTLISTED: ${resetCount}\n`);

  console.log("=== Complete ===");
  console.log(`  Outlook drafts deleted       : ${outlookDeleted}`);
  console.log(`  DB EmailDraft records deleted: ${deleteResult.count}`);
  console.log(`  Application stages reset     : ${resetCount}`);
  console.log(
    "\nRun regenerateTodayEmails.js to regenerate with the updated prompt rules.",
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("\nFatal error:", err.message);
  await prisma.$disconnect();
  process.exit(1);
});
