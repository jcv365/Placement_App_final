"use strict";
/**
 * generateCandidateRoleConfirmationDrafts.cjs
 *
 * One-off script: creates Outlook drafts in the shared mailbox addressed to
 * every active candidate with suggested roles set, asking them to confirm they
 * are happy with those roles being applied for on their behalf.
 *
 * Approach:
 *   - Reads Graph credentials from .env.local (host) or the environment.
 *   - Mints an admin session and calls GET /api/candidates (app API on port 3001)
 *     to avoid direct SQLite conflict with the running Docker container.
 *   - Creates Outlook drafts directly via Microsoft Graph API.
 *
 * Usage:
 *   node scripts/generateCandidateRoleConfirmationDrafts.cjs           # dry run
 *   node scripts/generateCandidateRoleConfirmationDrafts.cjs --apply   # create Outlook drafts
 *
 * Required env (in .env.local or shell):
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   APP_SESSION_SECRET
 *   Optionally: OUTLOOK_SHARED_MAILBOX, GRAPH_SENDER_USER, API_BASE
 */

const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

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
const filterFlagIdx = process.argv.indexOf("--filter");
const NAME_FILTER =
  filterFlagIdx !== -1 && process.argv[filterFlagIdx + 1]
    ? process.argv[filterFlagIdx + 1].trim().toLowerCase()
    : null;

// ── Session minting ─────────────────────────────────────────────────────────

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

// ── Graph helpers ────────────────────────────────────────────────────────────

function getGraphTenantId() {
  return process.env.GRAPH_TENANT_ID?.trim() || null;
}
function getGraphClientId() {
  return process.env.GRAPH_CLIENT_ID?.trim() || null;
}
function getGraphClientSecret() {
  const s = process.env.GRAPH_CLIENT_SECRET?.trim();
  return s && s.length > 0 ? s : null;
}
function getSharedMailbox() {
  return (
    process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
    process.env.GRAPH_SENDER_USER?.trim() ||
    ""
  );
}

function isGraphConfigured() {
  return Boolean(
    getGraphTenantId() && getGraphClientId() && getGraphClientSecret(),
  );
}

async function getGraphAppAccessToken() {
  const tenantId = getGraphTenantId();
  const clientId = getGraphClientId();
  const clientSecret = getGraphClientSecret();
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
    const message = await response.text();
    throw new Error(`Graph token error: ${response.status} ${message}`);
  }
  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("Graph token response did not include an access token");
  }
  return payload.access_token;
}

async function createOutlookDraftForMailbox(mailbox, subject, htmlBody, to) {
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
        toRecipients: to.map((address) => ({
          emailAddress: { address },
        })),
      }),
    },
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Microsoft Graph error: ${response.status} ${message}`);
  }
}

// ── Email content ────────────────────────────────────────────────────────────

function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function parseSuggestedRoles(csv) {
  if (!csv || !csv.trim()) return [];
  return csv
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildConfirmationEmailHtml(
  candidateName,
  suggestedRoles,
  senderName,
  senderEmail,
) {
  const firstName = candidateName.trim().split(/\s+/)[0] ?? candidateName;
  const brandName = process.env.PLATFORM_PARTNER_NAME?.trim() || senderName;
  const rolesHtml = suggestedRoles
    .map((role) => `<li style="margin:4px 0;">${escapeHtml(role)}</li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;max-width:640px;margin:0 auto;padding:20px;">

  <p>Good day ${escapeHtml(firstName)},</p>

  <p>
    Thank you for joining ${escapeHtml(brandName)}'s active bench of specialist engineers. We
    are a professional services company that deploys our engineers directly to clients
    across Europe and the United Kingdom for contracting engagements, and we take direct
    accountability for the quality and fit of every engineer we represent.
  </p>

  <p>
    In order for us to put you forward effectively, we would kindly ask that you take a
    moment to confirm the following:
  </p>

  <p><strong>1. Roles you are comfortable being considered for</strong></p>

  <p>
    Based on your profile and experience, we have identified the following roles as
    potential fits for you. Please could you review this list and let us know which
    ones you are happy for us to actively pursue on your behalf — and feel free to
    suggest any additional roles you feel we may have missed:
  </p>

  <ul style="padding-left:20px;margin:12px 0;">
    ${rolesHtml}
  </ul>

  <p><strong>2. Your hourly rate</strong></p>

  <p>
    Could you please confirm your expected hourly rate for contract engagements in Europe
    and the UK? Please note that all engagements we facilitate are fully remote. If your
    rate varies depending on the role or region, please do let us know — that level of
    detail is very helpful when we are negotiating on your behalf.
  </p>

  <p>
    Please reply to this email at your earliest convenience with your confirmation and
    any updates. Should you wish to discuss anything further, or if your circumstances
    have changed since we last spoke, please do not hesitate to reach out — we are
    always happy to assist.
  </p>

  <p>We look forward to hearing from you.</p>

  <p>
    Kind regards,<br />
    <strong>${escapeHtml(senderName)}</strong><br />
    <a href="mailto:${escapeHtml(senderEmail)}">${escapeHtml(senderEmail)}</a>
  </p>

</body>
</html>`;
}

// ── Fetch all candidates from app API ────────────────────────────────────────

async function fetchAllCandidates(cookieHeader) {
  const PAGE_SIZE = 200;
  let page = 1;
  const all = [];

  while (true) {
    const url = `${API_BASE}/api/candidates?slim=true&page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: { Cookie: cookieHeader },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GET /api/candidates failed: ${res.status} ${body.slice(0, 200)}`,
      );
    }

    const envelope = await res.json();
    // API wraps responses: { ok: true, data: { items, total, page, pageSize } }
    // or { ok: true, data: [...] } for unpaginated results.
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

// ── Admin user lookup via docker exec (avoids Windows SQLite lock) ───────────

const { execSync } = require("child_process");
const { resolveAppContainer } = require("./_agentUtils");

const DOCKER_CONTAINER = resolveAppContainer();

function getAdminUserViaDocker() {
  const script = [
    "const { PrismaClient } = require('@prisma/client');",
    "const p = new PrismaClient();",
    `p.tenantUser.findFirst({ where: { tenantId: '${TENANT_ID}', role: 'ADMIN', isActive: true }, select: { id: true, email: true } })`,
    ".then(u => { console.log(JSON.stringify(u)); process.exit(0); })",
    ".catch(e => { console.error(e.message); process.exit(1); });",
  ].join(" ");

  try {
    const result = execSync(
      `docker exec ${DOCKER_CONTAINER} node -e "${script.replace(/"/g, '\\"')}"`,
      { encoding: "utf8", timeout: 15000 },
    ).trim();
    return JSON.parse(result);
  } catch (err) {
    throw new Error(
      `Failed to look up admin user via docker exec: ${err.message}`,
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("Candidate Role Confirmation Draft Generator");
  console.log("=".repeat(60));
  console.log(
    `Mode      : ${APPLY ? "APPLY (will create Outlook drafts)" : "DRY RUN (no changes)"}`,
  );
  console.log(`Tenant    : ${TENANT_ID}`);
  console.log(`API       : ${API_BASE}`);
  console.log(`Mailbox   : ${getSharedMailbox()}`);
  console.log(`Container : ${DOCKER_CONTAINER}`);
  console.log();

  if (APPLY && !isGraphConfigured()) {
    console.error(
      "ERROR: Graph credentials are not configured.\n" +
        "Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET in .env.local or the shell.",
    );
    process.exit(1);
  }

  // Find admin user for session minting via docker exec (avoids SQLite lock)
  let cookieHeader;
  {
    console.log("Looking up admin user via docker exec...");
    const adminUser = getAdminUserViaDocker();
    if (!adminUser?.id) {
      throw new Error(`No active admin user found for tenant ${TENANT_ID}`);
    }
    console.log(`Session   : minted for ${adminUser.email}`);
    const sessionToken = mintSession(adminUser.id, TENANT_ID);
    cookieHeader = `tenantId=${TENANT_ID}; appSession=${sessionToken}`;
    console.log();
  }

  // Fetch candidates via app API
  console.log("Fetching candidates from app API...");
  const candidates = await fetchAllCandidates(cookieHeader);
  console.log(`Found   : ${candidates.length} total candidate(s)`);

  // Filter: active, has suggestedRoles, has valid email
  const eligible = candidates.filter(
    (c) =>
      c.isActive !== false &&
      parseSuggestedRoles(c.suggestedRolesCsv).length > 0 &&
      isValidEmail(c.email),
  );
  const noEmail = candidates.filter(
    (c) =>
      c.isActive !== false &&
      parseSuggestedRoles(c.suggestedRolesCsv).length > 0 &&
      !isValidEmail(c.email),
  );

  console.log(
    `Eligible: ${eligible.length} candidate(s) with suggested roles and valid email`,
  );

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

  let drafted = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const candidate = toProcess[i];
    const roles = parseSuggestedRoles(candidate.suggestedRolesCsv);
    const email = candidate.email;
    const subject = `Contracting Opportunities in Europe & UK — Role Confirmation and Rate`;
    const htmlBody = buildConfirmationEmailHtml(
      candidate.fullName,
      roles,
      senderName,
      mailbox,
    );

    const prefix = `[${i + 1}/${toProcess.length}]`;
    console.log(`${prefix} ${candidate.fullName} <${email}>`);
    console.log(`  Roles   : ${roles.join(", ")}`);

    if (APPLY) {
      try {
        await createOutlookDraftForMailbox(mailbox, subject, htmlBody, [email]);
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
    if (drafted > 0 && failed === 0) {
      console.log(
        "All drafts created. Review and send them from the shared Outlook mailbox.",
      );
    }
  } else {
    console.log(
      `Dry run complete — ${toProcess.length} draft(s) would be created.`,
    );
    console.log("Run with --apply to create the Outlook drafts.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
