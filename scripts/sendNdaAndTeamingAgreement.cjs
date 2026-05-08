"use strict";
/**
 * sendNdaAndTeamingAgreement.cjs
 *
 * Sends the NDA and Teaming Agreement PDFs to every active candidate
 * with a valid email address. Creates Outlook drafts in the shared mailbox —
 * review and send manually, or run with --send to send immediately.
 *
 * Documents are read from:
 *   data/Documents/<NDA_DOCUMENT_FILENAME>
 *   data/Documents/<TEAMING_DOCUMENT_FILENAME>
 *
 * Usage:
 *   node scripts/sendNdaAndTeamingAgreement.cjs                    # dry run
 *   node scripts/sendNdaAndTeamingAgreement.cjs --apply            # create Outlook drafts
 *   node scripts/sendNdaAndTeamingAgreement.cjs --apply --filter "Andre"   # single candidate
 *
 * Required env (in .env.local or shell):
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   APP_SESSION_SECRET
 *   Optionally: OUTLOOK_SHARED_MAILBOX, GRAPH_SENDER_USER, API_BASE, DOCKER_CONTAINER
 */

const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { execSync } = require("child_process");
const { resolveAppContainer } = require("./_agentUtils");

// ── Env loading ──────────────────────────────────────────────────────────────

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

// ── CLI flags ────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes("--apply");
const TENANT_ID = process.env.TARGET_TENANT_ID ?? "default";
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3001";
const CONTAINER = resolveAppContainer();

const filterFlagIdx = process.argv.indexOf("--filter");
const NAME_FILTER =
  filterFlagIdx !== -1 && process.argv[filterFlagIdx + 1]
    ? process.argv[filterFlagIdx + 1].trim().toLowerCase()
    : null;

// ── Document paths ───────────────────────────────────────────────────────────

const DOCS_DIR = path.resolve(__dirname, "../data/Documents");
const NDA_PATH = path.join(
  DOCS_DIR,
  process.env.NDA_DOCUMENT_FILENAME?.trim() || "NDA.pdf",
);
const TEAMING_PATH = path.join(
  DOCS_DIR,
  process.env.TEAMING_DOCUMENT_FILENAME?.trim() || "Teaming_Agreement.pdf",
);

// ── Session minting ──────────────────────────────────────────────────────────

const SESSION_SECRET =
  process.env.APP_SESSION_SECRET ?? "local-app-session-secret";

function signValue(value) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
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

// ── Admin user lookup ────────────────────────────────────────────────────────

function getAdminUserViaDocker() {
  const script = [
    "const { PrismaClient } = require('@prisma/client');",
    "const p = new PrismaClient();",
    `p.tenantUser.findFirst({ where: { tenantId: '${TENANT_ID}', role: 'ADMIN', isActive: true }, select: { id: true, email: true } })`,
    ".then(u => { console.log(JSON.stringify(u)); process.exit(0); })",
    ".catch(e => { console.error(e.message); process.exit(1); });",
  ].join(" ");

  const result = execSync(
    `docker exec ${CONTAINER} node -e "${script.replace(/"/g, '\\"')}"`,
    { encoding: "utf8", timeout: 15000 },
  ).trim();
  return JSON.parse(result);
}

// ── Fetch candidates from app API ────────────────────────────────────────────

async function fetchAllCandidates(cookieHeader) {
  const PAGE_SIZE = 200;
  let page = 1;
  const all = [];

  while (true) {
    const url = `${API_BASE}/api/candidates?slim=true&page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: { Cookie: cookieHeader } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GET /api/candidates failed: ${res.status} ${body.slice(0, 200)}`,
      );
    }
    const envelope = await res.json();
    const payload = envelope?.data ?? envelope;
    if (Array.isArray(payload)) {
      all.push(...payload);
      break;
    }
    const items = Array.isArray(payload?.items) ? payload.items : [];
    all.push(...items);
    const total =
      typeof payload?.total === "number" ? payload.total : items.length;
    if (all.length >= total) break;
    page++;
  }

  return all;
}

// ── Graph helpers ────────────────────────────────────────────────────────────

function getSharedMailbox() {
  return (
    process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
    process.env.GRAPH_SENDER_USER?.trim() ||
    ""
  );
}

function isGraphConfigured() {
  return Boolean(
    process.env.GRAPH_TENANT_ID?.trim() &&
    process.env.GRAPH_CLIENT_ID?.trim() &&
    process.env.GRAPH_CLIENT_SECRET?.trim(),
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
    const msg = await response.text();
    throw new Error(`Graph token error: ${response.status} ${msg}`);
  }
  const data = await response.json();
  if (!data.access_token)
    throw new Error("No access_token in Graph token response");
  return data.access_token;
}

async function createOutlookDraftWithAttachments(
  mailbox,
  subject,
  htmlBody,
  to,
  attachments,
) {
  const accessToken = await getGraphAppAccessToken();
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        subject,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
        attachments: attachments.map((a) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.filename,
          contentType: "application/pdf",
          contentBytes: a.contentBase64,
        })),
      }),
    },
  );
  if (!response.ok) {
    const msg = await response.text();
    throw new Error(`Microsoft Graph error: ${response.status} ${msg}`);
  }
}

// ── Email content ────────────────────────────────────────────────────────────

function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildNdaEmailHtml(candidateName, senderName, senderEmail) {
  const firstName = candidateName.trim().split(/\s+/)[0] ?? candidateName;
  const brandName = process.env.PLATFORM_PARTNER_NAME?.trim() || senderName;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;max-width:640px;margin:0 auto;padding:20px;">

  <p>Good day ${escapeHtml(firstName)},</p>

  <p>
    Thank you for joining ${escapeHtml(brandName)}'s specialist engineering bench. We are a
    professional services company that deploys vetted engineers to clients across Europe
    and the United Kingdom for contracting engagements, and we are pleased to have you
    as part of our team.
  </p>

  <p>
    To formalise your engagement with us and enable us to present you to our clients
    as part of our engineering bench, we require you to review, sign, and return the
    following two documents:
  </p>

  <ol style="padding-left:20px;margin:12px 0;">
    <li style="margin:8px 0;">
      <strong>Non-Disclosure Agreement (NDA)</strong> — Protects both parties and ensures
      that any confidential information shared during the engagement process remains
      strictly private.
    </li>
    <li style="margin:8px 0;">
      <strong>Teaming Agreement</strong> — Formalises your engagement with ${escapeHtml(brandName)}
      as a professional services partner, setting out the terms under which
      we will deploy you to our clients as part of our engineering bench.
    </li>
  </ol>

  <p>
    Please print, sign, and scan each document, then <strong>reply to this email</strong>
    with the signed copies attached. Alternatively, you are welcome to use a digital
    signature tool such as DocuSign or Adobe Sign.
  </p>

  <p>
    Should you have any questions about the contents of either document, please do not
    hesitate to reach out — we are happy to clarify anything before you sign.
  </p>

  <p>We look forward to receiving your completed documents.</p>

  <p>
    Kind regards,<br />
    <strong>${escapeHtml(senderName)}</strong><br />
    <a href="mailto:${escapeHtml(senderEmail)}">${escapeHtml(senderEmail)}</a>
  </p>

</body>
</html>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("NDA & Teaming Agreement Draft Sender");
  console.log("=".repeat(60));
  console.log(
    `Mode      : ${APPLY ? "APPLY (will create Outlook drafts)" : "DRY RUN (no changes)"}`,
  );
  console.log(`Tenant    : ${TENANT_ID}`);
  console.log(`API       : ${API_BASE}`);
  console.log(`Mailbox   : ${getSharedMailbox()}`);
  console.log(`Container : ${CONTAINER}`);
  console.log();

  // Verify document files exist
  if (!fs.existsSync(NDA_PATH)) {
    console.error(`ERROR: NDA document not found at:\n  ${NDA_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(TEAMING_PATH)) {
    console.error(`ERROR: Teaming Agreement not found at:\n  ${TEAMING_PATH}`);
    process.exit(1);
  }
  console.log(`NDA       : ${path.basename(NDA_PATH)}`);
  console.log(`Teaming   : ${path.basename(TEAMING_PATH)}`);
  console.log();

  if (APPLY && !isGraphConfigured()) {
    console.error(
      "ERROR: Graph credentials are not configured.\n" +
        "Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET in .env.local or the shell.",
    );
    process.exit(1);
  }

  // Read document bytes upfront
  const ndaBase64 = fs.readFileSync(NDA_PATH).toString("base64");
  const teamingBase64 = fs.readFileSync(TEAMING_PATH).toString("base64");
  const attachments = [
    { filename: path.basename(NDA_PATH), contentBase64: ndaBase64 },
    { filename: path.basename(TEAMING_PATH), contentBase64: teamingBase64 },
  ];

  // Mint admin session
  console.log("Looking up admin user via docker exec...");
  const adminUser = getAdminUserViaDocker();
  if (!adminUser?.id) {
    throw new Error(`No active admin user found for tenant ${TENANT_ID}`);
  }
  console.log(`Session   : minted for ${adminUser.email}`);
  const sessionToken = mintSession(adminUser.id, TENANT_ID);
  const cookieHeader = `tenantId=${TENANT_ID}; appSession=${sessionToken}`;
  console.log();

  // Fetch candidates
  console.log("Fetching candidates from app API...");
  const candidates = await fetchAllCandidates(cookieHeader);
  console.log(`Found     : ${candidates.length} total candidate(s)`);

  const eligible = candidates.filter(
    (c) => c.isActive !== false && isValidEmail(c.email),
  );
  const noEmail = candidates.filter(
    (c) => c.isActive !== false && !isValidEmail(c.email),
  );

  console.log(`Eligible  : ${eligible.length} candidate(s) with valid email`);

  if (noEmail.length > 0) {
    console.log(`\nSkipped (no valid email) — ${noEmail.length} candidate(s):`);
    for (const c of noEmail) {
      console.log(`  - ${c.fullName} (email: ${c.email ?? "null"})`);
    }
  }

  const toProcess = NAME_FILTER
    ? eligible.filter((c) =>
        (c.fullName ?? "").toLowerCase().includes(NAME_FILTER),
      )
    : eligible;

  if (NAME_FILTER) {
    console.log(
      `\nName filter "${NAME_FILTER}" applied — ${toProcess.length} candidate(s) matched.`,
    );
  }

  if (toProcess.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  console.log();
  const mailbox = getSharedMailbox();
  const senderName =
    process.env.SENDER_DISPLAY_NAME?.trim() ||
    process.env.PLATFORM_PARTNER_NAME?.trim() ||
    "";
  const brandName = process.env.PLATFORM_PARTNER_NAME?.trim() || senderName;
  const subject = `${brandName} — NDA & Teaming Agreement: Action Required`;

  let drafted = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const candidate = toProcess[i];
    const email = candidate.email;
    const prefix = `[${i + 1}/${toProcess.length}]`;

    console.log(`${prefix} ${candidate.fullName} <${email}>`);

    if (APPLY) {
      try {
        const htmlBody = buildNdaEmailHtml(
          candidate.fullName,
          senderName,
          mailbox,
        );
        await createOutlookDraftWithAttachments(
          mailbox,
          subject,
          htmlBody,
          [email],
          attachments,
        );
        console.log(`  Status  : Draft created in ${mailbox}`);
        drafted++;
      } catch (err) {
        console.error(`  Status  : FAILED — ${err.message}`);
        failed++;
      }
    } else {
      console.log(`  Status  : (dry run — not created)`);
    }

    console.log();
  }

  console.log("=".repeat(60));
  if (APPLY) {
    console.log(
      `Done. Drafted: ${drafted}, Failed: ${failed}, Skipped (no email): ${noEmail.length}`,
    );
    if (drafted > 0) {
      console.log(
        "Review and send the drafts from the shared Outlook mailbox.",
      );
    }
  } else {
    console.log(
      `Dry run complete. ${toProcess.length} candidate(s) would receive the documents.`,
    );
    console.log("Re-run with --apply to create Outlook drafts.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
