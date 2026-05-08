#!/usr/bin/env node
// Lists all email drafts from today in the shared Outlook mailbox,
// compares against today's DB pairs, and reports what's missing.
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

async function fetchAllDrafts(token) {
  // Fetch the last 500 messages from the Drafts folder (isDraft=true), filter by today
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const filter = `isDraft eq true and createdDateTime ge ${todayStart.toISOString()}`;
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/drafts/messages` +
    `?$filter=${encodeURIComponent(filter)}&$select=id,subject,createdDateTime,toRecipients&$top=500&$orderby=createdDateTime desc`;

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

async function main() {
  console.log(`\nMailbox: ${MAILBOX}`);
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  console.log(`Today from: ${todayStart.toISOString()}\n`);

  // 1. Fetch from Outlook
  console.log("Fetching drafts from Outlook...");
  const token = await getToken();
  const outlookDrafts = await fetchAllDrafts(token);
  console.log(`  Found ${outlookDrafts.length} draft(s) in Outlook today.\n`);

  for (const d of outlookDrafts) {
    const to =
      d.toRecipients?.map((r) => r.emailAddress?.address).join(", ") ||
      "(no recipient)";
    console.log(`  [${d.createdDateTime}] ${d.subject}`);
    console.log(`    To: ${to}`);
  }

  // 2. Fetch DB pairs
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const dbDrafts = await prisma.emailDraft.findMany({
      where: { createdAt: { gte: todayStart }, tenantId: "dotcloudconsulting" },
      select: {
        id: true,
        subject: true,
        createdAt: true,
        application: {
          select: {
            jobId: true,
            candidateId: true,
            job: { select: { title: true } },
            candidate: { select: { fullName: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Deduplicate by job+candidate — keep the LATEST draft per pair
    const pairMap = new Map();
    for (const d of dbDrafts) {
      const key = `${d.application.jobId}::${d.application.candidateId}`;
      pairMap.set(key, d); // later entries overwrite earlier ones (ordered asc → last wins)
    }
    const dbPairs = [...pairMap.values()];
    console.log(`\n  Found ${dbPairs.length} unique DB pair(s) today.\n`);

    // 3. Match Outlook subjects to DB subjects
    const outlookSubjects = new Set(
      outlookDrafts.map((d) => d.subject?.trim()),
    );
    const missing = dbPairs.filter(
      (d) => !outlookSubjects.has(d.subject?.trim()),
    );
    const matched = dbPairs.filter((d) =>
      outlookSubjects.has(d.subject?.trim()),
    );

    console.log(`=== MATCHED in Outlook (${matched.length}) ===`);
    for (const d of matched) {
      console.log(
        `  ✓ [${d.application.job.title}] ${d.application.candidate.fullName} — "${d.subject}"`,
      );
    }

    console.log(`\n=== MISSING from Outlook (${missing.length}) ===`);
    if (missing.length === 0) {
      console.log("  All DB drafts are present in the Outlook mailbox.");
    } else {
      for (const d of missing) {
        console.log(
          `  ✗ [${d.application.job.title}] ${d.application.candidate.fullName} — "${d.subject}"`,
        );
      }
    }

    // 4. Outlook drafts with no DB match (orphans)
    const dbSubjects = new Set(dbPairs.map((d) => d.subject?.trim()));
    const orphans = outlookDrafts.filter(
      (d) => !dbSubjects.has(d.subject?.trim()),
    );
    if (orphans.length > 0) {
      console.log(
        `\n=== OUTLOOK DRAFTS WITH NO DB MATCH (${orphans.length}) ===`,
      );
      for (const d of orphans) {
        console.log(`  ? [${d.createdDateTime}] "${d.subject}"`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
