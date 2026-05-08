"use strict";
/**
 * processNdaReplies.cjs
 *
 * Inbox agent: checks the shared Outlook mailbox for replies to the NDA &
 * Teaming Agreement email. When a candidate replies with PDF attachments,
 * saves the signed documents into:
 *   data/Documents/<candidateId>/
 *
 * Usage:
 *   node scripts/processNdaReplies.cjs                          # dry run
 *   node scripts/processNdaReplies.cjs --apply                  # save files + mark as read
 *   node scripts/processNdaReplies.cjs --since 2026-04-13       # custom date (default: last 7 days)
 *   node scripts/processNdaReplies.cjs --apply --filter "andre" # single sender
 *
 * Required env (in .env.local or shell):
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   APP_SESSION_SECRET
 *   Optionally: OUTLOOK_SHARED_MAILBOX, API_BASE, DOCKER_CONTAINER
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { resolveAppContainer, dockerExecScript } = require("./_agentUtils");

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

const sinceIdx = process.argv.indexOf("--since");
const SINCE_DATE =
  sinceIdx !== -1 && process.argv[sinceIdx + 1]
    ? process.argv[sinceIdx + 1].trim()
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const filterIdx = process.argv.indexOf("--filter");
const SENDER_FILTER =
  filterIdx !== -1 && process.argv[filterIdx + 1]
    ? process.argv[filterIdx + 1].trim().toLowerCase()
    : null;

const CONTAINER = resolveAppContainer();
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3001";
const SESSION_SECRET =
  process.env.APP_SESSION_SECRET ?? "local-app-session-secret";
const TENANT_ID = process.env.TARGET_TENANT_ID ?? "dotcloudconsulting";

// Documents output root — per-candidate cv folder
const CV_DIR = path.resolve(__dirname, "../cv");

// Subject keyword that identifies relevant replies
const NDA_SUBJECT_KEYWORD = "NDA & Teaming Agreement";

// ── Session minting ──────────────────────────────────────────────────────────

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
  ].join("\n");

  return JSON.parse(dockerExecScript(CONTAINER, script));
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

async function fetchInboxMessages(mailbox, accessToken) {
  const messages = [];
  // Do NOT filter by isRead — already-read emails are commonly missed otherwise.
  // hasAttachments is kept to avoid fetching thousands of bodyless messages.
  const filterClause = `receivedDateTime ge ${SINCE_DATE}T00:00:00Z and hasAttachments eq true`;
  let url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/Inbox/messages` +
    `?$filter=${encodeURIComponent(filterClause)}` +
    `&$select=id,subject,from,receivedDateTime,isRead,hasAttachments` +
    `&$top=50` +
    `&$orderby=receivedDateTime desc`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Graph inbox fetch error: ${res.status} ${msg}`);
    }
    const data = await res.json();
    messages.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  return messages;
}

async function fetchMessageAttachments(mailbox, messageId, accessToken) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Graph attachments fetch error: ${res.status} ${msg}`);
  }
  const data = await res.json();
  return data.value ?? [];
}

async function markAsRead(mailbox, messageId, accessToken) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isRead: true }),
    },
  );
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Graph markAsRead error: ${res.status} ${msg}`);
  }
}

// ── File saving ──────────────────────────────────────────────────────────────

function nameToSlug(name) {
  return (name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Saves a base64-encoded attachment to cv/<candidate-slug>/documents/<filename>.
 * Appends a timestamp suffix to avoid overwriting previously returned copies.
 */
function saveAttachment(candidateName, filename, contentBase64) {
  const slug = nameToSlug(candidateName);
  const candidateDocsDir = path.join(CV_DIR, slug, "documents");
  fs.mkdirSync(candidateDocsDir, { recursive: true });

  // Sanitise filename and add date prefix to avoid collisions
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const datePart = new Date().toISOString().slice(0, 10);
  const destName = `${datePart}_${safe}`;
  const destPath = path.join(candidateDocsDir, destName);

  fs.writeFileSync(destPath, Buffer.from(contentBase64, "base64"));
  return destPath;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the subject looks like an NDA / Teaming Agreement reply.
 * Used as a fallback — known-candidate senders are always included regardless.
 */
function isNdaReply(subject) {
  if (!subject) return false;
  const s = subject.toLowerCase();
  return (
    s.includes("nda") ||
    s.includes("teaming agreement") ||
    s.includes("action required") ||
    s.includes("non-disclosure") ||
    s.includes("signed") ||
    s.includes("agreement")
  );
}

/**
 * Accepts PDF, Word, and generic binary attachments.
 * Some email clients send PDFs as application/octet-stream or with a .docx wrapper.
 */
function isDocumentAttachment(attachment) {
  const name = (attachment.name ?? "").toLowerCase();
  const ct = (attachment.contentType ?? "").toLowerCase();
  return (
    name.endsWith(".pdf") ||
    name.endsWith(".doc") ||
    name.endsWith(".docx") ||
    ct === "application/pdf" ||
    ct === "application/msword" ||
    ct ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ct === "application/octet-stream"
  );
}

/**
 * Marks a CandidateAgreement record as COMPLETED via docker exec.
 * Returns the number of rows updated (0 = no matching record found).
 */
function markAgreementCompletedViaDocker(candidateId, agreementType) {
  const sql = `'UPDATE "CandidateAgreement" SET "status" = $1, "signedAt" = datetime("now"), "updatedAt" = datetime("now") WHERE "candidateId" = $2 AND "type" = $3'`;
  const script = [
    "const { PrismaClient } = require('@prisma/client');",
    "const p = new PrismaClient();",
    `p.$executeRawUnsafe(${sql}, 'COMPLETED', ${JSON.stringify(candidateId)}, ${JSON.stringify(agreementType)})`,
    ".then(n => { console.log('rows:' + n); process.exit(0); })",
    ".catch(e => { console.error('ERROR:' + e.message); process.exit(1); });",
  ].join("\n");
  const result = dockerExecScript(CONTAINER, script);
  if (result.includes("ERROR:"))
    throw new Error(result.replace("ERROR:", "").trim());
  return parseInt(result.replace("rows:", ""), 10);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("NDA & Teaming Agreement Reply Processor");
  console.log("=".repeat(60));
  console.log(
    `Mode      : ${APPLY ? "APPLY (will save files + mark as read)" : "DRY RUN (no changes)"}`,
  );
  console.log(`Tenant    : ${TENANT_ID}`);
  console.log(`Mailbox   : ${getSharedMailbox()}`);
  console.log(`Since     : ${SINCE_DATE}`);
  console.log(`Output    : ${CV_DIR}/<name>/documents/`);
  console.log();

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

  // Fetch candidates (build email → candidate map)
  console.log("Fetching candidates from app API...");
  const candidates = await fetchAllCandidates(cookieHeader);
  const emailToCandidate = new Map();
  for (const c of candidates) {
    if (c.email) emailToCandidate.set(c.email.trim().toLowerCase(), c);
  }
  console.log(`Loaded    : ${candidates.length} candidate(s)`);
  console.log();

  // Fetch inbox
  const mailbox = getSharedMailbox();
  console.log(
    `Fetching inbox messages with attachments since ${SINCE_DATE} (read + unread)...`,
  );
  const accessToken = await getGraphAppAccessToken();
  const messages = await fetchInboxMessages(mailbox, accessToken);
  console.log(`Found     : ${messages.length} message(s) with attachments`);
  console.log();

  // Accept any message where:
  //   (a) the subject looks like an NDA/Teaming reply, OR
  //   (b) the sender is a known candidate (regardless of subject)
  // This catches candidates who replied with a changed subject or a fresh email.
  const ndaReplies = messages.filter((m) => {
    const senderEmail = (m.from?.emailAddress?.address ?? "").toLowerCase();
    return isNdaReply(m.subject) || emailToCandidate.has(senderEmail);
  });
  console.log(
    `NDA replies: ${ndaReplies.length} message(s) match (NDA subject or known candidate sender)`,
  );

  if (SENDER_FILTER) {
    console.log(`Sender filter: "${SENDER_FILTER}"`);
  }

  const toProcess = SENDER_FILTER
    ? ndaReplies.filter(
        (m) =>
          (m.from?.emailAddress?.address ?? "")
            .toLowerCase()
            .includes(SENDER_FILTER) ||
          (m.from?.emailAddress?.name ?? "")
            .toLowerCase()
            .includes(SENDER_FILTER),
      )
    : ndaReplies;

  if (toProcess.length === 0) {
    console.log("\nNo matching replies to process.");
    return;
  }

  console.log();

  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const message = toProcess[i];
    const senderEmail = (
      message.from?.emailAddress?.address ?? ""
    ).toLowerCase();
    const senderName = message.from?.emailAddress?.name ?? senderEmail;
    const prefix = `[${i + 1}/${toProcess.length}]`;

    console.log(`${prefix} From: ${senderName} <${senderEmail}>`);
    console.log(`  Subject : ${message.subject}`);
    console.log(`  Received: ${message.receivedDateTime}`);

    const candidate = emailToCandidate.get(senderEmail);
    if (!candidate) {
      console.log(
        `  Match   : No candidate found for ${senderEmail} — skipping`,
      );
      skipped++;
      console.log();
      continue;
    }

    console.log(`  Match   : ${candidate.fullName} (${candidate.id})`);

    // Fetch attachments
    let attachments;
    try {
      attachments = await fetchMessageAttachments(
        mailbox,
        message.id,
        accessToken,
      );
    } catch (err) {
      console.error(`  Error   : Could not fetch attachments — ${err.message}`);
      failed++;
      console.log();
      continue;
    }

    const pdfAttachments = attachments.filter(isDocumentAttachment);
    console.log(
      `  Docs    : ${pdfAttachments.length} document attachment(s) found` +
        (attachments.length > pdfAttachments.length
          ? ` (${attachments.length - pdfAttachments.length} other attachment(s) ignored)`
          : ""),
    );

    if (pdfAttachments.length === 0) {
      console.log(`  Skipped : No document attachments in this reply`);
      skipped++;
      console.log();
      continue;
    }

    if (APPLY) {
      try {
        for (const att of pdfAttachments) {
          const savedPath = saveAttachment(
            candidate.fullName,
            att.name ?? "attachment.pdf",
            att.contentBytes,
          );
          console.log(
            `  Saved   : ${path.relative(path.resolve(__dirname, ".."), savedPath)}`,
          );
        }

        // Update agreement status in DB — mark both NDA and Teaming as COMPLETED
        // since the NDA email sends both documents in a single message.
        for (const agreementType of ["NDA", "TEAMING_AGREEMENT"]) {
          try {
            const rows = markAgreementCompletedViaDocker(
              candidate.id,
              agreementType,
            );
            if (rows > 0) {
              console.log(`  DB      : ${agreementType} → COMPLETED`);
            } else {
              console.log(
                `  DB      : ${agreementType} — no existing record (send via platform first)`,
              );
            }
          } catch (dbErr) {
            console.warn(
              `  DB warn : ${agreementType} update failed — ${dbErr.message}`,
            );
          }
        }

        await markAsRead(mailbox, message.id, accessToken);
        console.log(`  Email   : Marked as read`);
        saved++;
      } catch (err) {
        console.error(`  Error   : ${err.message}`);
        failed++;
      }
    } else {
      for (const att of pdfAttachments) {
        const slug = nameToSlug(candidate.fullName);
        const destName = `${new Date().toISOString().slice(0, 10)}_${att.name ?? "attachment.pdf"}`;
        console.log(`  Would save: cv/${slug}/documents/${destName}`);
      }
      console.log(`  Would mark: NDA + TEAMING_AGREEMENT → COMPLETED in DB`);
    }

    console.log();
  }

  console.log("=".repeat(60));
  if (APPLY) {
    console.log(
      `Done. Processed: ${saved}, Skipped: ${skipped}, Failed: ${failed}`,
    );
  } else {
    console.log(`Dry run complete. ${toProcess.length} reply/replies found.`);
    console.log(
      "Re-run with --apply to save documents and mark emails as read.",
    );
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
