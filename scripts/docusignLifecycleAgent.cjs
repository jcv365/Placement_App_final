"use strict";
/**
 * docusignLifecycleAgent.cjs
 *
 * Polls DocuSign for all pending (SENT) candidate agreements and updates their
 * status in the database when DocuSign reports completion, decline, or void.
 *
 * Safe to run repeatedly — only records that have changed in DocuSign are
 * written. Dry-run mode (default) reports what would change without writing.
 *
 * Usage:
 *   node scripts/docusignLifecycleAgent.cjs                     # dry run
 *   node scripts/docusignLifecycleAgent.cjs --apply             # write status updates to DB
 *   node scripts/docusignLifecycleAgent.cjs --filter "riaan"    # candidate name substring
 *
 * Required env (in .env.local or shell):
 *   DOCUSIGN_BASE_URI, DOCUSIGN_ACCOUNT_ID, DOCUSIGN_ACCESS_TOKEN
 *   APP_SESSION_SECRET
 *   Optionally: API_BASE, DOCKER_CONTAINER, TARGET_TENANT_ID
 *
 * Note: DOCUSIGN_ACCESS_TOKEN is a short-lived bearer token. When it expires,
 * re-generate it via the DocuSign consent flow and update the env.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
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

const filterIdx = process.argv.indexOf("--filter");
const CANDIDATE_FILTER =
  filterIdx !== -1 && process.argv[filterIdx + 1]
    ? process.argv[filterIdx + 1].trim().toLowerCase()
    : null;

// ── Config ───────────────────────────────────────────────────────────────────

const CONTAINER = resolveAppContainer();
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3001";
const SESSION_SECRET =
  process.env.APP_SESSION_SECRET ?? "local-app-session-secret";
const TENANT_ID = process.env.TARGET_TENANT_ID ?? "default";

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
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = signValue(b64);
  return `${b64}.${sig}`;
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

// ── DB update via docker exec ────────────────────────────────────────────────

/**
 * Updates a CandidateAgreement record directly in the database via docker exec.
 * Uses Prisma's $executeRawUnsafe with positional parameters to avoid injection.
 */
function updateAgreementStatusViaDocker(agreementId, updates) {
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setClauses = keys.map((col, i) => `"${col}" = $${i + 1}`).join(", ");
  const idParamIdx = keys.length + 1;
  const sqlLiteral = `'UPDATE "CandidateAgreement" SET ${setClauses} WHERE "id" = $${idParamIdx}'`;
  const valueArgs = [...values, agreementId]
    .map((v) => JSON.stringify(v))
    .join(", ");

  const script = [
    "const { PrismaClient } = require('@prisma/client');",
    "const p = new PrismaClient();",
    `p.$executeRawUnsafe(${sqlLiteral}, ${valueArgs})`,
    ".then(() => { console.log('updated'); process.exit(0); })",
    ".catch(e => { console.error('ERROR:' + e.message); process.exit(1); });",
  ].join(" ");

  const result = execSync(
    `docker exec ${CONTAINER} node -e "${script.replace(/"/g, '\\"')}"`,
    { encoding: "utf8", timeout: 15000 },
  ).trim();
  if (result.includes("ERROR:")) {
    throw new Error(result.replace("ERROR:", "").trim());
  }
}

// ── API helpers ──────────────────────────────────────────────────────────────

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

async function fetchAgreementsForCandidate(candidateId, cookieHeader) {
  const res = await fetch(
    `${API_BASE}/api/candidates/${encodeURIComponent(candidateId)}/agreements`,
    { headers: { Cookie: cookieHeader } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GET /api/candidates/${candidateId}/agreements failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  return res.json();
}

// ── DocuSign helpers ─────────────────────────────────────────────────────────

function getDocuSignConfig() {
  const baseUri = process.env.DOCUSIGN_BASE_URI?.trim();
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID?.trim();
  const accessToken = process.env.DOCUSIGN_ACCESS_TOKEN?.trim();

  if (!baseUri || !accountId || !accessToken) {
    throw new Error(
      "DocuSign is not configured. Set DOCUSIGN_BASE_URI, DOCUSIGN_ACCOUNT_ID, and DOCUSIGN_ACCESS_TOKEN.",
    );
  }

  return { baseUri, accountId, accessToken };
}

/**
 * Fetches the current status of a DocuSign envelope.
 * Returns the envelope object or null if not found / access denied.
 *
 * DocuSign envelope statuses: created | sent | delivered | signed |
 *   completed | declined | voided
 */
async function getEnvelopeStatus(envelopeId, config) {
  const url =
    `${config.baseUri}/restapi/v2.1/accounts/${encodeURIComponent(config.accountId)}` +
    `/envelopes/${encodeURIComponent(envelopeId)}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      Accept: "application/json",
    },
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `DocuSign GET /envelopes/${envelopeId} failed: ${res.status} ${body.slice(0, 300)}`,
    );
  }

  return res.json();
}

/**
 * Maps a DocuSign envelope status to our AgreementStatus enum.
 * Returns null if the status represents no actionable change from SENT.
 */
function mapDocuSignStatus(dsStatus) {
  switch (dsStatus?.toLowerCase()) {
    case "completed":
    case "signed":
      return "COMPLETED";
    case "declined":
      return "DECLINED";
    case "voided":
      return "VOIDED";
    default:
      return null; // No change from SENT (created, sent, delivered)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("DocuSign Lifecycle Agent");
  console.log("=".repeat(60));
  console.log(
    `Mode             : ${APPLY ? "APPLY (will write status updates to DB)" : "DRY RUN"}`,
  );
  if (CANDIDATE_FILTER) console.log(`Candidate filter : "${CANDIDATE_FILTER}"`);
  console.log();

  // 1. Validate DocuSign config upfront.
  const docuConfig = getDocuSignConfig();
  console.log(`DocuSign base URI: ${docuConfig.baseUri}`);
  console.log(`Account ID       : ${docuConfig.accountId}\n`);

  // 2. Mint admin session.
  console.log("Looking up admin user via Docker...");
  const adminUser = getAdminUserViaDocker();
  if (!adminUser?.id) throw new Error("No active admin user found for tenant.");
  console.log(`Admin user: ${adminUser.email} (${adminUser.id})\n`);

  const token = mintSession(adminUser.id, TENANT_ID);
  const cookieHeader = `tenantId=${TENANT_ID}; appSession=${token}`;

  // 3. Fetch all candidates.
  console.log("Fetching candidates...");
  const allCandidates = await fetchAllCandidates(cookieHeader);
  const targetCandidates = allCandidates.filter(
    (c) =>
      !CANDIDATE_FILTER ||
      c.fullName?.toLowerCase().includes(CANDIDATE_FILTER) ||
      c.email?.toLowerCase().includes(CANDIDATE_FILTER),
  );
  console.log(
    `Candidates: ${allCandidates.length} total, ${targetCandidates.length} matching filter\n`,
  );

  if (targetCandidates.length === 0) {
    console.log("No candidates to process.");
    return;
  }

  // 4. Collect all SENT agreements with envelopeIds.
  console.log("Fetching pending agreements...");
  const pendingAgreements = [];

  for (const candidate of targetCandidates) {
    try {
      const agreements = await fetchAgreementsForCandidate(
        candidate.id,
        cookieHeader,
      );
      for (const agreement of agreements) {
        if (agreement.status === "SENT" && agreement.envelopeId) {
          pendingAgreements.push({ candidate, agreement });
        }
      }
    } catch (err) {
      console.error(
        `  ✗  Failed to fetch agreements for ${candidate.fullName}: ${err.message}`,
      );
    }
  }

  if (pendingAgreements.length === 0) {
    console.log("No pending (SENT) agreements with envelope IDs found.");
    return;
  }

  console.log(`Found ${pendingAgreements.length} pending agreement(s)\n`);
  console.log("-".repeat(60));

  // 5. Check each envelope in DocuSign.
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const { candidate, agreement } of pendingAgreements) {
    const label = `${candidate.fullName} (${agreement.type})`;
    console.log(`  Checking: ${label}`);
    console.log(`    Envelope: ${agreement.envelopeId}`);

    let envelope;
    try {
      envelope = await getEnvelopeStatus(agreement.envelopeId, docuConfig);
    } catch (err) {
      errors++;
      console.error(`    ✗  DocuSign error: ${err.message}`);
      continue;
    }

    if (!envelope) {
      errors++;
      console.log(
        `    ✗  Envelope not found in DocuSign (may have been purged)`,
      );
      continue;
    }

    const dsStatus = envelope.status;
    const newStatus = mapDocuSignStatus(dsStatus);

    console.log(`    DocuSign status: ${dsStatus}`);

    if (!newStatus) {
      unchanged++;
      console.log(`    No change (still in-progress)\n`);
      continue;
    }

    console.log(`    → New status: ${newStatus}`);

    if (!APPLY) {
      console.log(`    [dry-run] would update DB\n`);
      continue;
    }

    try {
      const dbUpdates = {
        status: newStatus,
        externalStatus: `docusign:${dsStatus.toLowerCase()}`,
      };

      // Record completion timestamp when the envelope is signed/completed.
      if (newStatus === "COMPLETED") {
        const completedAt =
          envelope.completedDateTime ||
          envelope.statusChangedDateTime ||
          new Date().toISOString();
        dbUpdates.signedAt = completedAt;
      }

      updateAgreementStatusViaDocker(agreement.id, dbUpdates);
      updated++;
      console.log(`    ✓  DB updated\n`);
    } catch (err) {
      errors++;
      console.error(`    ✗  DB update failed: ${err.message}\n`);
    }
  }

  // 6. Summary.
  console.log("=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`Agreements checked  : ${pendingAgreements.length}`);
  console.log(`Unchanged           : ${unchanged}`);
  if (APPLY) {
    console.log(`Updated in DB       : ${updated}`);
    console.log(`Errors              : ${errors}`);
  } else {
    if (updated + unchanged + errors < pendingAgreements.length) {
      // dry-run counted would-update items separately
    }
    console.log();
    console.log("This was a dry run. Add --apply to write status updates.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
