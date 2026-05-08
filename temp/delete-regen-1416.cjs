#!/usr/bin/env node
// Removes all Outlook drafts generated at approximately 14:16 SAST (12:13-12:19 UTC)
// on 2026-04-11. These were created by a direct Graph repair run that missed the
// candidate name / greeting rules. After deletion, the corresponding applications
// are identified by matching recipient email to opportunityEmail, their existing
// DB drafts are deleted, and they are re-generated through the proper
// /api/email/generate endpoint which enforces candidate-name validation.
//
// Usage:
//   node temp/delete-regen-1416.cjs          -- dry run (audit only, no changes)
//   node temp/delete-regen-1416.cjs --execute -- delete bad drafts and regenerate
//
"use strict";

const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });

process.env.DATABASE_URL =
  "file:" + path.resolve(__dirname, "../prisma/prod.db");

const DRY_RUN = !process.argv.includes("--execute");
const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const MAILBOX =
  process.env.OUTLOOK_SHARED_MAILBOX ||
  process.env.GRAPH_SENDER_USER ||
  "placements@dotcloud.africa";
const APP_SESSION_SECRET =
  (process.env.APP_SESSION_SECRET || "").trim() ||
  "DwNteqv6/xUwLc1LwbWzbHOSD8CWUdFCMHZzQ1oJ59Q=";
const API_BASE = "http://127.0.0.1:3001";

// SAST is UTC+2, so 14:16 SAST = 12:16 UTC.
// Window: 12:13:00 to 12:19:59 UTC on 2026-04-11.
const TARGET_DATE = "2026-04-11";
const WINDOW_START = new Date(`${TARGET_DATE}T12:13:00.000Z`);
const WINDOW_END = new Date(`${TARGET_DATE}T12:19:59.999Z`);

// ─── helpers ──────────────────────────────────────────────────────────────────

function b64url(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function signVal(encoded) {
  return crypto
    .createHmac("sha256", APP_SESSION_SECRET)
    .update(encoded)
    .digest("base64url");
}
function mintSession(userId, tenantId) {
  const encoded = b64url({
    uid: userId,
    tid: tenantId,
    role: "ADMIN",
    exp: Date.now() + 86400_000,
  });
  return `${encoded}.${signVal(encoded)}`;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function normaliseEmail(e) {
  return (e || "").trim().toLowerCase();
}

// ─── Graph helpers ────────────────────────────────────────────────────────────

async function getToken() {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.access_token)
    throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function fetchOutlookDraftsInWindow(token) {
  const filter =
    `isDraft eq true` +
    ` and createdDateTime ge ${WINDOW_START.toISOString()}` +
    ` and createdDateTime le ${WINDOW_END.toISOString()}`;
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/drafts/messages` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$select=id,subject,createdDateTime,toRecipients&$top=500&$orderby=createdDateTime asc`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.value ?? [];
}

async function deleteOutlookDraft(token, messageId) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages/${messageId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Graph DELETE error ${res.status}: ${text}`);
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    console.log(`\n========================================================`);
    console.log(`  Delete + Regen: 14:16 SAST batch`);
    console.log(
      `  Window: ${WINDOW_START.toISOString()} - ${WINDOW_END.toISOString()}`,
    );
    console.log(
      `  Mode:   ${DRY_RUN ? "DRY RUN (pass --execute to apply)" : "LIVE EXECUTE"}`,
    );
    console.log(`  Mailbox: ${MAILBOX}`);
    console.log(`========================================================\n`);

    // Step 1: Fetch bad Outlook drafts
    console.log("Fetching bad Outlook drafts in window...");
    const token = await getToken();
    const outlookDrafts = await fetchOutlookDraftsInWindow(token);
    console.log(`Found ${outlookDrafts.length} Outlook draft(s) to remove.\n`);

    if (outlookDrafts.length === 0) {
      console.log("Nothing to delete in that time window. Exiting.\n");
      return;
    }

    // Collect unique recipient emails from the bad drafts
    const badRecipientEmails = new Set();
    for (const d of outlookDrafts) {
      for (const r of d.toRecipients ?? []) {
        const addr = normaliseEmail(r.emailAddress?.address);
        if (addr) badRecipientEmails.add(addr);
      }
    }
    console.log(
      `Unique recipient addresses from bad drafts: ${badRecipientEmails.size}`,
    );
    for (const e of [...badRecipientEmails].sort()) console.log(`  ${e}`);

    // Step 2: Find DB applications matching those recipients via job.opportunityEmail
    const todayStart = new Date(`${TARGET_DATE}T00:00:00.000Z`);

    const allTodayDrafts = await prisma.emailDraft.findMany({
      where: {
        tenantId: "dotcloudconsulting",
        createdAt: { gte: todayStart },
      },
      select: {
        id: true,
        subject: true,
        createdAt: true,
        applicationId: true,
        application: {
          select: {
            id: true,
            jobId: true,
            candidateId: true,
            currentStage: true,
            job: {
              select: {
                id: true,
                title: true,
                opportunityEmail: true,
              },
            },
            candidate: { select: { fullName: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    console.log(`\nTotal DB drafts today: ${allTodayDrafts.length}`);

    // Match DB drafts whose job.opportunityEmail is in the bad-recipients set
    const matchedDbDrafts = allTodayDrafts.filter((d) =>
      badRecipientEmails.has(
        normaliseEmail(d.application?.job?.opportunityEmail),
      ),
    );
    console.log(
      `DB drafts matching bad recipient emails: ${matchedDbDrafts.length}`,
    );

    // Dedupe to one draft per application (take latest)
    const appMap = new Map();
    for (const d of matchedDbDrafts) {
      const existing = appMap.get(d.applicationId);
      if (!existing || d.createdAt > existing.createdAt) {
        appMap.set(d.applicationId, d);
      }
    }
    const uniqueMatchedDrafts = [...appMap.values()];
    console.log(`Unique matched applications: ${uniqueMatchedDrafts.length}\n`);

    for (const d of uniqueMatchedDrafts) {
      const name = d.application?.candidate?.fullName ?? "(unknown)";
      const job = d.application?.job?.title ?? "(unknown job)";
      const to = d.application?.job?.opportunityEmail ?? "(no recipient)";
      const stage = d.application?.currentStage ?? "?";
      console.log(
        `  [${d.createdAt.toISOString().slice(11, 19)} UTC] ${stage}  ${job} / ${name}  -> ${to}`,
      );
    }

    if (DRY_RUN) {
      console.log(
        `\n[DRY RUN] No changes made. Re-run with --execute to apply.\n`,
      );
      return;
    }

    // Step 3: Delete all Outlook orphan drafts from the bad window
    console.log(
      `\nDeleting ${outlookDrafts.length} Outlook orphan draft(s)...`,
    );
    let outlookDeleted = 0;
    for (const d of outlookDrafts) {
      await deleteOutlookDraft(token, d.id);
      outlookDeleted += 1;
      if (outlookDeleted % 20 === 0) {
        console.log(`  ... deleted ${outlookDeleted}/${outlookDrafts.length}`);
      }
    }
    console.log(`  Done: ${outlookDeleted} Outlook draft(s) deleted.`);

    // Step 4: Delete ALL today's DB drafts for those matched applications
    const allDraftIdsForMatchedApps = allTodayDrafts
      .filter((d) => appMap.has(d.applicationId))
      .map((d) => d.id);

    if (allDraftIdsForMatchedApps.length > 0) {
      await prisma.emailDraft.deleteMany({
        where: { id: { in: allDraftIdsForMatchedApps } },
      });
      console.log(
        `\nDeleted ${allDraftIdsForMatchedApps.length} DB draft record(s) for ${uniqueMatchedDrafts.length} application(s).`,
      );
    } else {
      console.log(
        `\nNo DB draft records found for those applications (Outlook-only orphans - OK).`,
      );
    }

    // Step 5: Reset application stages to NEW
    let resetCount = 0;
    for (const d of uniqueMatchedDrafts) {
      const app = d.application;
      if (!app) continue;
      if (app.currentStage === "EMAIL_DRAFTED") {
        await prisma.application.update({
          where: { id: app.id },
          data: {
            currentStage: "NEW",
            history: {
              create: {
                tenantId: "dotcloudconsulting",
                fromStage: "EMAIL_DRAFTED",
                toStage: "NEW",
                changedBy: "delete-regen-1416: bad 14:16 SAST drafts removed",
              },
            },
          },
        });
        resetCount += 1;
      }
    }
    console.log(`Reset ${resetCount} application stage(s) to NEW.\n`);

    // Step 6: Regenerate via the proper API endpoint
    const adminUser = await prisma.tenantUser.findFirst({
      where: { tenantId: "dotcloudconsulting", role: "ADMIN", isActive: true },
      select: { id: true, email: true },
    });
    if (!adminUser)
      throw new Error("No active admin user found for dotcloudconsulting");
    console.log(`Regenerating as: ${adminUser.email}`);

    const cookieHeader = `tenantId=dotcloudconsulting; appSession=${mintSession(adminUser.id, "dotcloudconsulting")}`;
    const appsToRegen = uniqueMatchedDrafts
      .map((d) => d.application)
      .filter(Boolean);

    let success = 0;
    let failed = 0;
    let skippedOutlook = 0;
    const failSamples = [];

    console.log(`\nRegenerating ${appsToRegen.length} email(s)...\n`);

    for (let i = 0; i < appsToRegen.length; i += 1) {
      const app = appsToRegen[i];
      const label = `${app.job?.title ?? "?"} / ${app.candidate?.fullName ?? "?"}`;
      process.stdout.write(`  [${i + 1}/${appsToRegen.length}] ${label} ... `);

      let ok = false;
      let lastMsg = "";

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          const res = await fetch(`${API_BASE}/api/email/generate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader,
            },
            body: JSON.stringify({
              applicationId: app.id,
              jobId: app.jobId,
              candidateId: app.candidateId,
              aiProvider: "auto",
            }),
          });

          const txt = await res.text();
          let payload;
          try {
            payload = JSON.parse(txt);
          } catch {
            payload = { raw: txt };
          }

          if (res.ok) {
            ok = true;
            const olStatus = payload?.data?.outlookDraft?.status;
            const subject = payload?.data?.subject ?? "?";
            if (olStatus === "skipped") skippedOutlook += 1;
            console.log(`OK "${subject}" [outlook: ${olStatus ?? "?"}]`);
            success += 1;
            break;
          }

          const msg = String(
            payload?.error?.message ||
              payload?.error?.details?.message ||
              payload?.raw ||
              `HTTP ${res.status}`,
          );
          lastMsg = msg;

          if (
            /rate.?limit|429|No deployments available|temporarily unavailable/i.test(
              msg,
            )
          ) {
            await sleep(1200 * attempt);
            continue;
          }
          break;
        } catch (err) {
          lastMsg = String(err?.message || err);
          await sleep(600 * attempt);
        }
      }

      if (!ok) {
        console.log(`FAIL: ${lastMsg.slice(0, 160)}`);
        failed += 1;
        if (failSamples.length < 10)
          failSamples.push({ app: label, error: lastMsg });
      }

      await sleep(300);
    }

    console.log(`\n========================================================`);
    console.log(`  Outlook orphans deleted : ${outlookDeleted}`);
    console.log(
      `  DB drafts deleted       : ${allDraftIdsForMatchedApps.length}`,
    );
    console.log(`  Applications reset      : ${resetCount}`);
    console.log(`  Regenerated OK          : ${success}`);
    console.log(`  Regeneration failed     : ${failed}`);
    if (skippedOutlook > 0)
      console.log(`  Outlook skipped         : ${skippedOutlook}`);
    if (failSamples.length > 0) {
      console.log(`\n  Failures:`);
      for (const f of failSamples)
        console.log(`    ${f.app}: ${f.error.slice(0, 120)}`);
    }
    console.log(`========================================================\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
