#!/usr/bin/env node
// Repairs missing Outlook drafts: finds DB email drafts from today that are
// absent from the shared Outlook mailbox and pushes them directly via Graph API.
// This is a best-effort repair — CV attachments are skipped (body only).
// Run: node temp/repair-missing-outlook-drafts.cjs
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });

process.env.DATABASE_URL =
  "file:" + path.resolve(__dirname, "../prisma/prod.db");

const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const MAILBOX =
  process.env.OUTLOOK_SHARED_MAILBOX ||
  process.env.GRAPH_SENDER_USER ||
  "placements@dotcloud.africa";

// Optional: filter to a specific candidate name (pass as CLI arg, or leave empty for all missing)
const CANDIDATE_FILTER = process.argv[2] ?? "";

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

async function fetchTodayOutlookSubjects(token) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const filter = `isDraft eq true and createdDateTime ge ${todayStart.toISOString()}`;
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/drafts/messages` +
    `?$filter=${encodeURIComponent(filter)}&$select=id,subject&$top=500`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return new Set((data.value ?? []).map((d) => d.subject?.trim()));
}

async function createOutlookDraft(token, { subject, htmlBody, toEmails }) {
  const body = {
    subject,
    body: { contentType: "HTML", content: htmlBody },
    toRecipients: toEmails.map((addr) => ({
      emailAddress: { address: addr },
    })),
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph draft creation failed ${res.status}: ${text}`);
  }
  const created = await res.json();
  return created.id;
}

function parseEmails(raw) {
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@") && s.includes("."));
}

async function main() {
  console.log(`\nMailbox: ${MAILBOX}`);
  if (CANDIDATE_FILTER) {
    console.log(`Candidate filter: "${CANDIDATE_FILTER}"`);
  }

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // 1. Fetch today's DB email drafts with job opportunity email info
    console.log("\nFetching today's DB email drafts...");
    const dbDrafts = await prisma.emailDraft.findMany({
      where: { createdAt: { gte: todayStart }, tenantId: "dotcloudconsulting" },
      select: {
        id: true,
        subject: true,
        htmlBody: true,
        application: {
          select: {
            job: {
              select: {
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

    // Deduplicate per job+candidate pair — keep the latest draft
    const pairMap = new Map();
    for (const d of dbDrafts) {
      const key = `${d.application.job.title}::${d.application.candidate.fullName}`;
      pairMap.set(key, d);
    }
    const dbPairs = [...pairMap.values()];
    console.log(`  ${dbPairs.length} unique DB pairs today.`);

    // 2. Get today's Outlook draft subjects
    console.log("\nFetching today's Outlook draft subjects...");
    const token = await getToken();
    const outlookSubjects = await fetchTodayOutlookSubjects(token);
    console.log(`  ${outlookSubjects.size} Outlook drafts found today.`);

    // 3. Find missing ones
    let missing = dbPairs.filter(
      (d) => !outlookSubjects.has(d.subject?.trim()),
    );

    if (CANDIDATE_FILTER) {
      missing = missing.filter((d) =>
        d.application.candidate.fullName
          .toLowerCase()
          .includes(CANDIDATE_FILTER.toLowerCase()),
      );
    }

    // Further filter to only those with a valid opportunity email
    const actionable = missing.filter((d) => {
      const emails = parseEmails(d.application.job.opportunityEmail);
      return emails.length > 0;
    });
    const noEmail = missing.filter((d) => {
      const emails = parseEmails(d.application.job.opportunityEmail);
      return emails.length === 0;
    });

    console.log(`\n=== MISSING from Outlook: ${missing.length} total ===`);
    console.log(
      `  ${actionable.length} have a valid opportunity email → will repair`,
    );
    console.log(`  ${noEmail.length} have no opportunity email → skipping`);

    if (noEmail.length > 0) {
      console.log("\n  Skipping (no opportunity email):");
      for (const d of noEmail) {
        console.log(
          `    - [${d.application.job.title}] ${d.application.candidate.fullName}`,
        );
      }
    }

    if (actionable.length === 0) {
      console.log("\nNothing to repair.");
      return;
    }

    // 4. Push missing drafts to Outlook
    console.log(
      `\nPushing ${actionable.length} missing draft(s) to Outlook...\n`,
    );
    let ok = 0;
    let failed = 0;

    for (let i = 0; i < actionable.length; i++) {
      const d = actionable[i];
      const toEmails = parseEmails(d.application.job.opportunityEmail);
      const label = `[${i + 1}/${actionable.length}] [${d.application.job.title}] ${d.application.candidate.fullName}`;
      process.stdout.write(`  ${label} → `);

      try {
        await createOutlookDraft(token, {
          subject: d.subject,
          htmlBody: d.htmlBody,
          toEmails,
        });
        console.log(`OK (to: ${toEmails.join(", ")})`);
        ok++;
      } catch (err) {
        console.log(`FAIL: ${err.message.slice(0, 120)}`);
        failed++;
      }

      // Small delay to avoid hitting Graph rate limits
      if (i < actionable.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    console.log(`\n=== Done ===`);
    console.log(`  OK:     ${ok}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Skipped (no email): ${noEmail.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("\nFatal:", e.message);
  process.exit(1);
});
