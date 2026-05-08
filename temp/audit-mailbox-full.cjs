#!/usr/bin/env node
// Counts all emails in both Drafts and Sent Items of the shared mailbox.
// Use this to reconcile against the total number of generated emails in the DB.
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });

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

async function fetchAllFromFolder(token, folderName) {
  let results = [];
  let url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/${folderName}/messages` +
    `?$select=id,subject,createdDateTime,sentDateTime,toRecipients&$top=999&$orderby=createdDateTime desc`;

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
    results = results.concat(data.value ?? []);
    url = data["@odata.nextLink"] ?? null;
    if (url)
      process.stdout.write(
        `  [${folderName}] paging... ${results.length} so far\n`,
      );
  }
  return results;
}

async function main() {
  console.log(`\nMailbox: ${MAILBOX}`);
  console.log(`Checking Drafts + Sent Items (all time)...\n`);

  const token = await getToken();

  console.log("Fetching Drafts folder...");
  const drafts = await fetchAllFromFolder(token, "drafts");
  console.log(`  Total in Drafts:     ${drafts.length}\n`);

  console.log("Fetching Sent Items folder...");
  const sentItems = await fetchAllFromFolder(token, "sentitems");
  console.log(`  Total in Sent Items: ${sentItems.length}\n`);

  const combined = drafts.length + sentItems.length;
  console.log(`========================================`);
  console.log(`  TOTAL (Drafts + Sent): ${combined}`);
  console.log(`========================================\n`);

  // Breakdown by recipient domain for Sent Items
  if (sentItems.length > 0) {
    const domainCounts = {};
    for (const msg of sentItems) {
      for (const r of msg.toRecipients ?? []) {
        const addr = r.emailAddress?.address ?? "";
        const domain = addr.split("@")[1] ?? "unknown";
        domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
      }
    }
    console.log("Sent Items breakdown by recipient domain:");
    for (const [domain, count] of Object.entries(domainCounts).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${domain}: ${count}`);
    }
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
