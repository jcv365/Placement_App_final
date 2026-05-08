#!/usr/bin/env node
// Diagnoses Microsoft Graph access to the shared Outlook mailbox.
// Tests: token acquisition, mailbox access, draft creation, then cleanup.
// Run: node temp/diagnose-graph.cjs

"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });

const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const MAILBOX = process.env.GRAPH_SENDER_USER || "placements@dotcloud.africa";

function check(label, value) {
  if (!value) {
    console.error(`  ✗ ${label}: MISSING`);
    return false;
  }
  console.log(`  ✓ ${label}: ${value.slice(0, 8)}…`);
  return true;
}

async function main() {
  console.log("\n=== Microsoft Graph Diagnostic ===\n");

  console.log("1. Checking env vars:");
  const ok =
    check("GRAPH_TENANT_ID", TENANT_ID) &&
    check("GRAPH_CLIENT_ID", CLIENT_ID) &&
    check("GRAPH_CLIENT_SECRET", CLIENT_SECRET);
  console.log(`   Mailbox target: ${MAILBOX}\n`);

  if (!ok) {
    console.error("Aborting — missing credentials.\n");
    process.exit(1);
  }

  // Step 2: Get app token
  console.log("2. Acquiring app-only access token:");
  const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const tokenPayload = await tokenRes.json();
  if (!tokenRes.ok || !tokenPayload.access_token) {
    console.error(
      `  ✗ Token error ${tokenRes.status}:`,
      JSON.stringify(tokenPayload, null, 2),
    );
    process.exit(1);
  }
  const token = tokenPayload.access_token;
  console.log(`  ✓ Token acquired (expires_in: ${tokenPayload.expires_in}s)\n`);

  // Step 3: Check mailbox exists / is accessible (requires User.Read.All — skipping if not available)
  console.log(
    `3. Checking mailbox listing (User.Read.All not required for drafts — skipping profile lookup):`,
  );
  console.log(`   Target mailbox: ${MAILBOX}`);
  console.log(
    `   (Skipped — User.Read.All Application permission not granted, but Mail.ReadWrite is)\n`,
  );

  // Step 4: Create a test draft
  console.log("4. Creating test draft in Drafts folder:");
  const draftRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        subject: "[DIAGNOSTIC] Test draft — safe to delete",
        body: {
          contentType: "HTML",
          content:
            "<p>This is a test draft created by the Graph diagnostic script. Please delete it.</p>",
        },
        toRecipients: [{ emailAddress: { address: MAILBOX } }],
      }),
    },
  );
  const draftPayload = await draftRes.json();
  if (!draftRes.ok) {
    console.error(
      `  ✗ Draft creation error ${draftRes.status}:`,
      JSON.stringify(draftPayload, null, 2),
    );
    process.exit(1);
  }
  const draftId = draftPayload.id;
  console.log(`  ✓ Draft created! ID: ${draftId}`);
  console.log(`     Subject: ${draftPayload.subject}`);
  console.log(`     WebLink: ${draftPayload.webLink ?? "(none)"}\n`);

  // Step 5: Cleanup
  console.log("5. Deleting test draft:");
  const delRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages/${draftId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (delRes.ok || delRes.status === 204) {
    console.log("  ✓ Test draft deleted\n");
  } else {
    console.warn(
      `  ⚠ Could not delete test draft (${delRes.status}) — delete manually from Outlook\n`,
    );
  }

  console.log("=== All checks passed — Graph is working correctly ===");
  console.log(`Drafts should appear in the Drafts folder of: ${MAILBOX}\n`);
}

main().catch((err) => {
  console.error("\nUnhandled error:", err.message ?? err);
  process.exit(1);
});
