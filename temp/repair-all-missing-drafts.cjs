#!/usr/bin/env node
// Repairs ALL missing Outlook drafts across the entire DB history (not just today).
// Fetches subjects from both Drafts + Sent Items so already-sent emails are excluded.
// Run: node temp/repair-all-missing-drafts.cjs [--dry-run]
"use strict";

const path = require("path");
const fs = require("fs");

// Load .env.local manually (no dotenv dependency needed)
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

process.env.DATABASE_URL =
  "file:" + path.resolve(__dirname, "../prisma/prod.db");

const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const MAILBOX =
  process.env.OUTLOOK_SHARED_MAILBOX ||
  process.env.GRAPH_SENDER_USER ||
  "placements@dotcloud.africa";

const DRY_RUN = process.argv.includes("--dry-run");

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

async function fetchAllSubjectsFromFolder(token, folderName) {
  const subjects = new Set();
  let url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/${folderName}/messages` +
    `?$select=subject&$top=999`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Graph error fetching ${folderName} ${res.status}: ${text}`,
      );
    }
    const data = await res.json();
    for (const msg of data.value ?? []) {
      if (msg.subject) subjects.add(msg.subject.trim());
    }
    url = data["@odata.nextLink"] ?? null;
    if (url)
      process.stdout.write(
        `  [${folderName}] paging... ${subjects.size} subjects so far\n`,
      );
  }
  return subjects;
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
    throw new Error(`Draft creation failed ${res.status}: ${text}`);
  }
  return (await res.json()).id;
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
  if (DRY_RUN) console.log("*** DRY RUN — no drafts will be created ***\n");

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    // 1. Fetch ALL DB email drafts (all time)
    console.log("Fetching all DB email drafts...");
    const dbDrafts = await prisma.emailDraft.findMany({
      where: { tenantId: "dotcloudconsulting" },
      select: {
        id: true,
        subject: true,
        htmlBody: true,
        createdAt: true,
        application: {
          select: {
            jobId: true,
            candidateId: true,
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
      orderBy: { createdAt: "desc" },
    });

    // Deduplicate per job+candidate pair — keep the LATEST draft
    const pairMap = new Map();
    for (const d of dbDrafts) {
      const key = `${d.application.jobId}::${d.application.candidateId}`;
      if (!pairMap.has(key)) pairMap.set(key, d); // desc order → first seen is latest
    }
    const dbPairs = [...pairMap.values()];
    console.log(`  Total DB records: ${dbDrafts.length}`);
    console.log(`  Unique job+candidate pairs: ${dbPairs.length}\n`);

    // 2. Fetch all subjects from Outlook (Drafts + Sent Items)
    const token = await getToken();

    console.log("Fetching Outlook Drafts subjects...");
    const draftSubjects = await fetchAllSubjectsFromFolder(token, "drafts");
    console.log(`  Drafts:     ${draftSubjects.size} subjects\n`);

    console.log("Fetching Outlook Sent Items subjects...");
    const sentSubjects = await fetchAllSubjectsFromFolder(token, "sentitems");
    console.log(`  Sent Items: ${sentSubjects.size} subjects\n`);

    const allOutlookSubjects = new Set([...draftSubjects, ...sentSubjects]);
    console.log(
      `  Combined unique subjects in mailbox: ${allOutlookSubjects.size}\n`,
    );

    // 3. Identify missing pairs
    const missing = dbPairs.filter(
      (d) => !allOutlookSubjects.has(d.subject?.trim()),
    );
    const actionable = missing.filter(
      (d) => parseEmails(d.application.job.opportunityEmail).length > 0,
    );
    const noEmail = missing.filter(
      (d) => parseEmails(d.application.job.opportunityEmail).length === 0,
    );

    console.log(`=== SUMMARY ===`);
    console.log(`  DB unique pairs:          ${dbPairs.length}`);
    console.log(
      `  Already in mailbox:       ${dbPairs.length - missing.length}`,
    );
    console.log(`  Missing from mailbox:     ${missing.length}`);
    console.log(`  Will repair (have email): ${actionable.length}`);
    console.log(`  Skipping (no email):      ${noEmail.length}\n`);

    if (noEmail.length > 0) {
      console.log("  Skipping (no opportunity email):");
      for (const d of noEmail) {
        console.log(
          `    - [${d.application.job.title}] ${d.application.candidate.fullName}`,
        );
      }
      console.log();
    }

    if (actionable.length === 0) {
      console.log("Nothing to repair.");
      return;
    }

    if (DRY_RUN) {
      console.log("Would repair:");
      for (const d of actionable) {
        const emails = parseEmails(d.application.job.opportunityEmail);
        console.log(
          `  - [${d.application.job.title}] ${d.application.candidate.fullName} → ${emails.join(", ")}`,
        );
      }
      return;
    }

    // 4. Push missing drafts to Outlook
    console.log(
      `Pushing ${actionable.length} missing draft(s) to Outlook...\n`,
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
        console.log(`FAIL: ${err.message.slice(0, 150)}`);
        failed++;
      }

      // Small delay to respect Graph API rate limits
      if (i < actionable.length - 1) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    console.log(`\n=== Done ===`);
    console.log(`  OK:                 ${ok}`);
    console.log(`  Failed:             ${failed}`);
    console.log(`  Skipped (no email): ${noEmail.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("\nFatal:", e.message);
  process.exit(1);
});
