"use strict";
/**
 * sendDraftEmailsAgent.cjs
 *
 * Cross-references the database with the shared Outlook mailbox Drafts folder
 * to identify, validate, and send placement email drafts.
 *
 * Only sends drafts that:
 *   1. Have a corresponding Application in EMAIL_DRAFTED stage in the DB
 *   2. Have a matching EmailDraft record (subject match) in the DB
 *   3. Have a corresponding open draft in the Outlook Drafts folder
 *
 * After sending in --apply mode, updates the Application stage to SENT_TO_CLIENT
 * and records a history entry.
 *
 * Usage:
 *   node scripts/sendDraftEmailsAgent.cjs               # dry run — lists what would be sent
 *   node scripts/sendDraftEmailsAgent.cjs --apply        # send all matched drafts
 *   node scripts/sendDraftEmailsAgent.cjs --apply --filter "Riaan"  # send matching candidate/role only
 *
 * Required env (in .env.local or shell):
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   Optionally: OUTLOOK_SHARED_MAILBOX, DATABASE_URL
 */

const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

// ── Env loading ───────────────────────────────────────────────────────────────

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(__dirname, "../.env.local"));
loadEnvFile(path.resolve(__dirname, "../.env"));

// ── CLI flags ─────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes("--apply");
const filterFlagIdx = process.argv.indexOf("--filter");
const NAME_FILTER =
  filterFlagIdx !== -1 && process.argv[filterFlagIdx + 1]
    ? process.argv[filterFlagIdx + 1].trim().toLowerCase()
    : null;

// ── Prisma ────────────────────────────────────────────────────────────────────

function createPrismaClient() {
  // Prefer DATABASE_URL from env; fall back to the local SQLite prod.db
  const dbUrl =
    process.env.DATABASE_URL?.trim() ||
    `file:${path.resolve(__dirname, "../prisma/prod.db")}`;
  return new PrismaClient({ datasources: { db: { url: dbUrl } } });
}

// ── Graph helpers ─────────────────────────────────────────────────────────────

function getSharedMailbox() {
  return (
    process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
    process.env.GRAPH_SENDER_USER?.trim() ||
    ""
  );
}

async function getGraphAppAccessToken() {
  const tenantId = process.env.GRAPH_TENANT_ID?.trim();
  const clientId = process.env.GRAPH_CLIENT_ID?.trim();
  const clientSecret = process.env.GRAPH_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Graph credentials not configured. Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET.",
    );
  }
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph token error: ${response.status} ${text}`);
  }
  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("Graph token response did not include an access token");
  }
  return payload.access_token;
}

// Fetches all draft messages in the mailbox, paginating automatically.
// Returns results sorted newest-first (Graph default with $orderby=createdDateTime desc).
async function fetchAllOutlookDrafts(mailbox, accessToken) {
  const drafts = [];
  let url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/Drafts/messages` +
    `?$top=100&$select=id,subject,createdDateTime,toRecipients&$orderby=createdDateTime desc`;

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Graph list drafts error: ${response.status} ${text}`);
    }
    const data = await response.json();
    drafts.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  return drafts;
}

async function sendOutlookDraft(mailbox, messageId, accessToken) {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${messageId}/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph send error: ${response.status} ${text}`);
  }
}

// ── Subject normalisation ─────────────────────────────────────────────────────

// Strips reply/forward prefixes and lowercases for robust matching.
function normaliseSubject(subject) {
  return (subject ?? "")
    .replace(/^(re|fw|fwd)\s*:\s*/i, "")
    .trim()
    .toLowerCase();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const mailbox = getSharedMailbox();

  console.log("=".repeat(64));
  console.log("  Send Draft Emails Agent");
  console.log("=".repeat(64));
  console.log(
    `Mode    : ${APPLY ? "APPLY (will send emails + update stages)" : "DRY RUN (no emails sent)"}`,
  );
  console.log(`Mailbox : ${mailbox}`);
  if (NAME_FILTER) console.log(`Filter  : "${NAME_FILTER}"`);
  console.log();

  // ── 1. Query DB for EMAIL_DRAFTED applications ───────────────────────────
  console.log("Querying DB for EMAIL_DRAFTED applications...");
  const prisma = createPrismaClient();

  let dbApps;
  try {
    dbApps = await prisma.application.findMany({
      where: { currentStage: "EMAIL_DRAFTED" },
      select: {
        id: true,
        tenantId: true,
        currentStage: true,
        candidate: {
          select: { fullName: true, email: true },
        },
        job: {
          select: {
            title: true,
            company: { select: { name: true } },
          },
        },
        emails: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { subject: true, createdAt: true },
        },
      },
    });
  } finally {
    await prisma.$disconnect().catch(() => {});
  }

  const appsWithDrafts = dbApps.filter((app) => app.emails.length > 0);

  console.log(`Applications in EMAIL_DRAFTED : ${dbApps.length}`);
  console.log(`With email draft in DB        : ${appsWithDrafts.length}`);

  if (appsWithDrafts.length === 0) {
    console.log(
      "\nNothing to process — no EMAIL_DRAFTED applications with a generated draft.",
    );
    return;
  }
  console.log();

  // ── 2. Fetch all Outlook drafts ──────────────────────────────────────────
  console.log("Acquiring Graph access token...");
  const accessToken = await getGraphAppAccessToken();
  console.log("Token acquired.");
  console.log("Fetching Outlook Drafts folder...");
  const outlookDrafts = await fetchAllOutlookDrafts(mailbox, accessToken);
  console.log(`Drafts in Outlook             : ${outlookDrafts.length}`);
  console.log();

  // Index Outlook drafts by normalised subject — results are newest-first from Graph.
  // Only the first entry (most recent draft) is used when sending.
  const outlookBySubject = new Map();
  for (const draft of outlookDrafts) {
    const norm = normaliseSubject(draft.subject);
    if (!outlookBySubject.has(norm)) {
      outlookBySubject.set(norm, []);
    }
    outlookBySubject.get(norm).push(draft);
  }

  // ── 3. Match DB applications to Outlook drafts ───────────────────────────
  const matched = [];
  const missingInOutlook = [];

  for (const app of appsWithDrafts) {
    const candidateName = app.candidate.fullName;
    const jobTitle = app.job.title;
    const company = app.job.company?.name ?? "Unknown";
    const dbSubject = app.emails[0].subject;

    // Apply name filter if provided
    if (
      NAME_FILTER &&
      !candidateName.toLowerCase().includes(NAME_FILTER) &&
      !jobTitle.toLowerCase().includes(NAME_FILTER) &&
      !company.toLowerCase().includes(NAME_FILTER)
    ) {
      continue;
    }

    const outlookMatches = outlookBySubject.get(normaliseSubject(dbSubject));
    if (outlookMatches && outlookMatches.length > 0) {
      matched.push({
        app,
        candidateName,
        jobTitle,
        company,
        dbSubject,
        outlookDraft: outlookMatches[0], // most recent
      });
    } else {
      missingInOutlook.push({ candidateName, jobTitle, company, dbSubject });
    }
  }

  // ── 4. Report ─────────────────────────────────────────────────────────────
  console.log(`Matched (ready to send)       : ${matched.length}`);
  console.log(`No Outlook draft found        : ${missingInOutlook.length}`);
  console.log();

  if (missingInOutlook.length > 0) {
    console.log(
      "Warning — these EMAIL_DRAFTED applications have no matching draft in Outlook:",
    );
    for (const u of missingInOutlook) {
      console.log(`  • ${u.candidateName}  →  ${u.jobTitle} @ ${u.company}`);
      console.log(`    Subject: "${u.dbSubject}"`);
    }
    console.log(
      "  (Run the repair-drafts tool to recreate missing Outlook drafts.)",
    );
    console.log();
  }

  if (matched.length === 0) {
    console.log("No matched drafts — nothing to send.");
    return;
  }

  console.log("Drafts queued:");
  console.log("-".repeat(64));
  for (let i = 0; i < matched.length; i++) {
    const m = matched[i];
    const to =
      (m.outlookDraft.toRecipients ?? [])
        .map((r) => r.emailAddress?.address)
        .filter(Boolean)
        .join(", ") || "(no recipients)";
    console.log(`[${i + 1}/${matched.length}] ${m.candidateName}`);
    console.log(`  Role    : ${m.jobTitle} @ ${m.company}`);
    console.log(`  Subject : ${m.dbSubject}`);
    console.log(`  To      : ${to}`);
    console.log(`  Created : ${m.outlookDraft.createdDateTime}`);
    if (!APPLY) console.log(`  Status  : (dry run — not sent)`);
    console.log();
  }

  if (!APPLY) {
    console.log("=".repeat(64));
    console.log(
      "DRY RUN complete. Re-run with --apply to send these drafts and update application stages.",
    );
    console.log("=".repeat(64));
    return;
  }

  // ── 5. Send drafts and update application stages ──────────────────────────
  console.log("Sending drafts...");
  console.log("-".repeat(64));

  const prisma2 = createPrismaClient();
  let sent = 0;
  let failed = 0;

  try {
    for (let i = 0; i < matched.length; i++) {
      const m = matched[i];
      const label = `[${i + 1}/${matched.length}] ${m.candidateName}`;
      process.stdout.write(`${label} → `);

      try {
        // Send the Outlook draft via Graph API
        await sendOutlookDraft(mailbox, m.outlookDraft.id, accessToken);

        // Update Application stage to SENT_TO_CLIENT and record history
        await prisma2.application.update({
          where: { id: m.app.id },
          data: {
            currentStage: "SENT_TO_CLIENT",
            history: {
              create: {
                tenantId: m.app.tenantId,
                fromStage: "EMAIL_DRAFTED",
                toStage: "SENT_TO_CLIENT",
                changedBy: "sendDraftEmailsAgent",
              },
            },
          },
        });

        console.log("Sent ✓  (stage → SENT_TO_CLIENT)");
        sent++;
      } catch (err) {
        console.error(`FAILED — ${err.message}`);
        failed++;
      }

      // Throttle to respect Graph API rate limits
      if (i < matched.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  } finally {
    await prisma2.$disconnect().catch(() => {});
  }

  console.log();
  console.log("=".repeat(64));
  console.log(`Sent    : ${sent}`);
  if (failed > 0) console.log(`Failed  : ${failed}`);
  console.log("=".repeat(64));
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
