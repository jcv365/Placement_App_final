#!/usr/bin/env node
// Generates missing email drafts by calling the app's /api/email/generate endpoint.
// Cross-references DB applications with Outlook Drafts + Sent Items to skip already-done.
"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Load .env.local
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
  "file:/app/db/prod.db?connection_limit=1&busy_timeout=15000";

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const MAILBOX =
  process.env.OUTLOOK_SHARED_MAILBOX ||
  process.env.GRAPH_SENDER_USER ||
  "placements@dotcloud.africa";
const APP_BASE = "http://localhost:3000";
const DRY_RUN = process.argv.includes("--dry-run");

// ─── Session minting ─────────────────────────────────────
const APP_SESSION_SECRET =
  process.env.APP_SESSION_SECRET ||
  "DwNteqv6/xUwLc1LwbWzbHOSD8CWUdFCMHZzQ1oJ59Q=";

function signValue(value) {
  return crypto
    .createHmac("sha256", APP_SESSION_SECRET)
    .update(value)
    .digest("base64url");
}

function mintSession(userId, tenantId) {
  const payload = {
    uid: userId,
    tid: tenantId,
    role: "ADMIN",
    exp: Date.now() + 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${signValue(encoded)}`;
}

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
  }
  return subjects;
}

async function main() {
  console.log(`Mailbox: ${MAILBOX}`);
  if (DRY_RUN) console.log("*** DRY RUN — no emails will be generated ***\n");

  // 1. Fetch all applications that are SHORTLISTED or NEW (no email yet)
  console.log("Fetching applications missing email drafts...");
  const apps = await prisma.application.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      currentStage: { in: ["SHORTLISTED", "NEW"] },
    },
    select: {
      id: true,
      currentStage: true,
      jobId: true,
      candidateId: true,
      job: {
        select: { id: true, title: true, opportunityEmail: true },
      },
      candidate: { select: { id: true, fullName: true } },
      emails: { select: { id: true, subject: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const missing = apps.filter((a) => a.emails.length === 0);
  console.log(`  Total active applications: ${apps.length}`);
  console.log(`  Missing DB email records:  ${missing.length}\n`);

  if (missing.length === 0) {
    console.log("Nothing to generate.");
    await prisma.$disconnect();
    return;
  }

  // 2. Fetch Outlook subjects to cross-reference
  console.log("Fetching Outlook Drafts and Sent Items subjects...");
  const token = await getToken();
  const draftSubjects = await fetchAllSubjectsFromFolder(token, "drafts");
  const sentSubjects = await fetchAllSubjectsFromFolder(token, "sentitems");
  const allOutlookSubjects = new Set([...draftSubjects, ...sentSubjects]);
  console.log(
    `  Drafts: ${draftSubjects.size} | Sent: ${sentSubjects.size} | Combined: ${allOutlookSubjects.size}\n`,
  );

  // 3. Filter to truly missing (not in Outlook at all)
  const trulyMissing = missing.filter((a) => {
    const subject = `${a.candidate.fullName} | ${a.job.title}`;
    return !allOutlookSubjects.has(subject);
  });

  console.log(
    `Truly missing (not in Drafts or Sent Items): ${trulyMissing.length}\n`,
  );

  if (trulyMissing.length === 0) {
    console.log(
      "All missing DB records already exist in Outlook. Nothing to generate.",
    );
    await prisma.$disconnect();
    return;
  }

  // 4. Generate emails via API
  let success = 0;
  let failed = 0;

  // Mint admin session for API auth
  const sessionCookie = mintSession(
    "cmmutgwan0003v69wp9wutd49",
    "dotcloudconsulting",
  );

  for (const app of trulyMissing) {
    const label = `${app.candidate.fullName} → ${app.job.title}`;
    const email = app.job.opportunityEmail || "";

    if (!email.trim()) {
      console.log(`  SKIP (no email): ${label}`);
      failed++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  WOULD GENERATE: ${label} | to: ${email}`);
      success++;
      continue;
    }

    try {
      const res = await fetch(`${APP_BASE}/api/email/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": "dotcloudconsulting",
          cookie: `appSession=${sessionCookie}`,
        },
        body: JSON.stringify({
          jobId: app.jobId,
          candidateId: app.candidateId,
          applicationId: app.id,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (res.ok) {
        console.log(`  OK: ${label}`);
        success++;
      } else {
        const errText = await res.text().catch(() => "unknown");
        console.log(
          `  FAIL (${res.status}): ${label} — ${errText.slice(0, 200)}`,
        );
        failed++;
      }
    } catch (err) {
      console.log(`  ERROR: ${label} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Generated: ${success}`);
  console.log(`  Failed:    ${failed}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal:", err.message);
  await prisma.$disconnect();
  process.exit(1);
});
