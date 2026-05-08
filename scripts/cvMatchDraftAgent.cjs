"use strict";
/**
 * cvMatchDraftAgent.cjs
 *
 * Cross-matches all active candidates against all active jobs using the ATS
 * scoring algorithm. For each candidate × job pair scoring at or above the
 * threshold, ensures an Application exists (idempotent) and generates an
 * Outlook email draft (skipped if the application is already at EMAIL_DRAFTED
 * stage or beyond, avoiding duplicate drafts).
 *
 * Usage:
 *   node scripts/cvMatchDraftAgent.cjs                          # dry run
 *   node scripts/cvMatchDraftAgent.cjs --apply                  # create applications + generate drafts
 *   node scripts/cvMatchDraftAgent.cjs --apply --min-score 80   # lower threshold
 *   node scripts/cvMatchDraftAgent.cjs --candidate-filter "riaan" # single candidate (substring match)
 *   node scripts/cvMatchDraftAgent.cjs --job-filter "devops"    # jobs matching substring
 *   node scripts/cvMatchDraftAgent.cjs --apply --candidate-filter "riaan" --job-filter "cloud"
 *
 * Required env (in .env.local or shell):
 *   APP_SESSION_SECRET
 *   Optionally: API_BASE, DOCKER_CONTAINER, TARGET_TENANT_ID
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

const candidateFilterIdx = process.argv.indexOf("--candidate-filter");
const CANDIDATE_FILTER =
  candidateFilterIdx !== -1 && process.argv[candidateFilterIdx + 1]
    ? process.argv[candidateFilterIdx + 1].trim().toLowerCase()
    : null;

const jobFilterIdx = process.argv.indexOf("--job-filter");
const JOB_FILTER =
  jobFilterIdx !== -1 && process.argv[jobFilterIdx + 1]
    ? process.argv[jobFilterIdx + 1].trim().toLowerCase()
    : null;

const minScoreIdx = process.argv.indexOf("--min-score");
const MIN_SCORE =
  minScoreIdx !== -1 && process.argv[minScoreIdx + 1]
    ? Number(process.argv[minScoreIdx + 1])
    : 85;

// ── Config ───────────────────────────────────────────────────────────────────

const CONTAINER = resolveAppContainer();
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3001";
const SESSION_SECRET =
  process.env.APP_SESSION_SECRET ?? "local-app-session-secret";
const TENANT_ID = process.env.TARGET_TENANT_ID ?? "default";

// Stages where email generation has already been done or the application is closed.
const SKIP_STAGES = new Set([
  "EMAIL_DRAFTED",
  "SENT_TO_CLIENT",
  "INTERVIEW_1",
  "INTERVIEW_2",
  "OFFER",
  "PLACED",
  "REJECTED",
  "ON_HOLD",
]);

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

// ── API helpers ──────────────────────────────────────────────────────────────

async function fetchAllCandidates(cookieHeader) {
  const PAGE_SIZE = 200;
  let page = 1;
  const all = [];

  while (true) {
    // Do NOT use slim=true — we need rawCV for ATS matching.
    // rawCV is stripped from the list response; scoring is delegated to the ats-match API.
    const url = `${API_BASE}/api/candidates?page=${page}&pageSize=${PAGE_SIZE}`;
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

async function fetchAllJobs(cookieHeader) {
  const PAGE_SIZE = 100;
  let page = 1;
  const all = [];

  while (true) {
    const url = `${API_BASE}/api/jobs?page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: { Cookie: cookieHeader } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GET /api/jobs failed: ${res.status} ${body.slice(0, 200)}`,
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

async function createApplication(jobId, candidateId, cookieHeader) {
  const res = await fetch(`${API_BASE}/api/applications`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobId, candidateId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `POST /api/applications failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  return res.json();
}

async function generateEmailDraft(
  jobId,
  candidateId,
  applicationId,
  cookieHeader,
) {
  const res = await fetch(`${API_BASE}/api/email/generate`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobId, candidateId, applicationId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `POST /api/email/generate failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  return res.json();
}

// ── Server-side ATS scoring ──────────────────────────────────────────────────
// Delegates to POST /api/candidates/:id/ats-match so rawCV is read from DB
// (the list endpoint strips rawCV from responses for payload efficiency).

async function atsMatchViaApi(candidateId, jobId, cookieHeader) {
  const res = await fetch(
    `${API_BASE}/api/candidates/${candidateId}/ats-match`,
    {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `POST /api/candidates/${candidateId}/ats-match failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  const envelope = await res.json();
  // Returns { candidate, job, result } where result may be null if CV too short.
  return (envelope?.data ?? envelope)?.result ?? null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("CV → Match → Draft Agent");
  console.log("=".repeat(60));
  console.log(
    `Mode             : ${APPLY ? "APPLY (will write to DB + generate drafts)" : "DRY RUN"}`,
  );
  console.log(`ATS threshold    : ${MIN_SCORE}`);
  if (CANDIDATE_FILTER) console.log(`Candidate filter : "${CANDIDATE_FILTER}"`);
  if (JOB_FILTER) console.log(`Job filter       : "${JOB_FILTER}"`);
  console.log();

  // 1. Mint session as admin user.
  console.log("Looking up admin user via Docker...");
  const adminUser = getAdminUserViaDocker();
  if (!adminUser?.id) throw new Error("No active admin user found for tenant.");
  console.log(`Admin user: ${adminUser.email} (${adminUser.id})\n`);

  const token = mintSession(adminUser.id, TENANT_ID);
  const cookieHeader = `tenantId=${TENANT_ID}; appSession=${token}`;

  // 2. Fetch candidates (full profile with rawCV).
  console.log("Fetching candidates...");
  const allCandidates = await fetchAllCandidates(cookieHeader);
  const activeCandidates = allCandidates
    .filter((c) => c.isActive)
    .filter(
      (c) =>
        !CANDIDATE_FILTER ||
        c.fullName?.toLowerCase().includes(CANDIDATE_FILTER) ||
        c.email?.toLowerCase().includes(CANDIDATE_FILTER),
    );
  console.log(
    `Candidates: ${allCandidates.length} total, ${activeCandidates.length} active` +
      (CANDIDATE_FILTER ? ` matching "${CANDIDATE_FILTER}"` : "") +
      "\n",
  );

  // 3. Fetch jobs.
  console.log("Fetching jobs...");
  const allJobs = await fetchAllJobs(cookieHeader);
  const activeJobs = allJobs
    .filter((j) => j.rawText?.trim())
    .filter(
      (j) =>
        !JOB_FILTER ||
        j.title?.toLowerCase().includes(JOB_FILTER) ||
        j.company?.name?.toLowerCase().includes(JOB_FILTER),
    );
  console.log(
    `Jobs: ${allJobs.length} total, ${activeJobs.length} with job text` +
      (JOB_FILTER ? ` matching "${JOB_FILTER}"` : "") +
      "\n",
  );

  if (activeCandidates.length === 0 || activeJobs.length === 0) {
    console.log("Nothing to process.");
    return;
  }

  // 4. Cross-product ATS scoring.
  const pairs = activeCandidates.length * activeJobs.length;
  console.log(`Scoring ${pairs} candidate × job pair(s)...`);
  console.log("-".repeat(60));

  let aboveThreshold = 0;
  let belowThreshold = 0;
  let skippedNoText = 0;
  let generated = 0;
  let skippedAlreadyDrafted = 0;
  let skippedNoEmail = 0;
  let errors = 0;

  for (const candidate of activeCandidates) {
    for (const job of activeJobs) {
      const match = await atsMatchViaApi(candidate.id, job.id, cookieHeader);

      if (!match) {
        skippedNoText++;
        continue;
      }

      if (match.score < MIN_SCORE) {
        belowThreshold++;
        if (match.score >= MIN_SCORE - 10) {
          // Log pairs that are close to threshold for manual review.
          console.log(
            `  ⚠  ${candidate.fullName} → ${job.title}: score ${match.score} (below threshold, missing: ${match.missingKeywords.slice(0, 3).join(", ")})`,
          );
        }
        continue;
      }

      aboveThreshold++;
      const tag = `${candidate.fullName} → ${job.title}`;
      console.log(`  ✓  ${tag}: score ${match.score}`);

      if (!APPLY) {
        console.log(
          `       [dry-run] would create application and generate draft`,
        );
        if (match.missingKeywords.length > 0) {
          console.log(
            `       Missing: ${match.missingKeywords.slice(0, 4).join(", ")}`,
          );
        }
        continue;
      }

      try {
        // Create or retrieve existing application (idempotent).
        const application = await createApplication(
          job.id,
          candidate.id,
          cookieHeader,
        );

        if (SKIP_STAGES.has(application.currentStage)) {
          skippedAlreadyDrafted++;
          console.log(
            `       Skipped (application stage: ${application.currentStage})`,
          );
          continue;
        }

        // Generate email draft.
        const result = await generateEmailDraft(
          job.id,
          candidate.id,
          application.id,
          cookieHeader,
        );

        if (result?.skipped) {
          skippedNoEmail++;
          console.log(
            `       Skipped (${result.reason ?? "no opportunity email on job"})`,
          );
        } else {
          generated++;
          const outlookStatus = result?.outlookDraft?.status ?? "unknown";
          console.log(`       Draft generated (Outlook: ${outlookStatus})`);
        }
      } catch (err) {
        errors++;
        console.error(`  ✗  ${tag}: ${err.message}`);
      }
    }
  }

  // 5. Summary.
  console.log();
  console.log("=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`Pairs scored     : ${pairs}`);
  console.log(`Below threshold  : ${belowThreshold}`);
  console.log(`No text to score : ${skippedNoText}`);
  console.log(`Above threshold  : ${aboveThreshold}`);
  if (APPLY) {
    console.log(`Drafts generated : ${generated}`);
    console.log(`Already drafted  : ${skippedAlreadyDrafted}`);
    console.log(`Skipped (no email): ${skippedNoEmail}`);
    console.log(`Errors           : ${errors}`);
  }
  if (!APPLY) {
    console.log();
    console.log("This was a dry run. Add --apply to generate drafts.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
