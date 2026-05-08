"use strict";
/**
 * jdCandidateMatchAgent.cjs
 *
 * Job-description-first matching agent. For each active job (filtered by
 * recency or a text filter), scores all active candidates and prints a ranked
 * shortlist. With --apply it also creates Applications for candidates scoring
 * at or above the threshold.
 *
 * Usage:
 *   node scripts/jdCandidateMatchAgent.cjs                       # dry run, all jobs
 *   node scripts/jdCandidateMatchAgent.cjs --days 7              # jobs added in last 7 days
 *   node scripts/jdCandidateMatchAgent.cjs --job-filter "cloud"  # jobs matching substring
 *   node scripts/jdCandidateMatchAgent.cjs --top 5               # show top 5 candidates per job
 *   node scripts/jdCandidateMatchAgent.cjs --min-score 80        # custom threshold
 *   node scripts/jdCandidateMatchAgent.cjs --apply               # create Applications
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

const jobFilterIdx = process.argv.indexOf("--job-filter");
const JOB_FILTER =
  jobFilterIdx !== -1 && process.argv[jobFilterIdx + 1]
    ? process.argv[jobFilterIdx + 1].trim().toLowerCase()
    : null;

const daysIdx = process.argv.indexOf("--days");
const DAYS =
  daysIdx !== -1 && process.argv[daysIdx + 1]
    ? Number(process.argv[daysIdx + 1])
    : null; // null = no date filter, include all jobs

const topIdx = process.argv.indexOf("--top");
const TOP_N =
  topIdx !== -1 && process.argv[topIdx + 1]
    ? Number(process.argv[topIdx + 1])
    : 10;

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

// ── AI semantic scoring (per job) ────────────────────────────────────────────
// Calls the AI match/score endpoint which batches candidate evaluation against
// a job using the full LLM stack. Results gate application creation so ATS-
// keyword false positives are never auto-applied.

/**
 * Returns a Map<candidateId, { score, rationale }> for candidates the AI
 * considers strong matches for this job. Returns null if AI is unavailable
 * (callers should degrade gracefully).
 */
async function fetchAiScoredCandidates(jobId, cookieHeader) {
  try {
    const res = await fetch(
      `${API_BASE}/api/match/score?jobId=${encodeURIComponent(jobId)}`,
      { headers: { Cookie: cookieHeader } },
    );
    if (!res.ok) {
      console.warn(
        `  ⚠ AI scoring unavailable (HTTP ${res.status}) — ATS-only filter in effect`,
      );
      return null;
    }
    const envelope = await res.json();
    const data = envelope?.data ?? envelope;
    if (!Array.isArray(data?.candidates)) {
      console.warn(
        `  ⚠ AI scoring returned unexpected shape — ATS-only filter in effect`,
      );
      return null;
    }
    return new Map(
      data.candidates.map((c) => [
        c.id,
        { score: c.aiScore, rationale: c.rationale },
      ]),
    );
  } catch (err) {
    console.warn(
      `  ⚠ AI scoring failed: ${err.message} — ATS-only filter in effect`,
    );
    return null;
  }
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
  const cutoffDate = DAYS
    ? new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000)
    : null;

  console.log("=".repeat(60));
  console.log("JD → Candidate Match Agent");
  console.log("=".repeat(60));
  console.log(
    `Mode             : ${APPLY ? "APPLY (will create Applications)" : "DRY RUN (report only)"}`,
  );
  console.log(`ATS threshold    : ${MIN_SCORE}`);
  console.log(`Top N per job    : ${TOP_N}`);
  if (DAYS)
    console.log(
      `Jobs since       : ${cutoffDate.toISOString().slice(0, 10)} (last ${DAYS} days)`,
    );
  if (JOB_FILTER) console.log(`Job filter       : "${JOB_FILTER}"`);
  console.log();

  // 1. Admin session.
  console.log("Looking up admin user via Docker...");
  const adminUser = getAdminUserViaDocker();
  if (!adminUser?.id) throw new Error("No active admin user found for tenant.");
  console.log(`Admin user: ${adminUser.email} (${adminUser.id})\n`);

  const token = mintSession(adminUser.id, TENANT_ID);
  const cookieHeader = `tenantId=${TENANT_ID}; appSession=${token}`;

  // 2. Fetch candidates (full profile).
  console.log("Fetching candidates...");
  const allCandidates = await fetchAllCandidates(cookieHeader);
  const activeCandidates = allCandidates.filter((c) => c.isActive);
  console.log(
    `Candidates: ${allCandidates.length} total, ${activeCandidates.length} active\n`,
  );

  // 3. Fetch jobs.
  console.log("Fetching jobs...");
  const allJobs = await fetchAllJobs(cookieHeader);
  const targetJobs = allJobs
    .filter((j) => j.rawText?.trim())
    .filter((j) => !cutoffDate || new Date(j.createdAt) >= cutoffDate)
    .filter(
      (j) =>
        !JOB_FILTER ||
        j.title?.toLowerCase().includes(JOB_FILTER) ||
        j.company?.name?.toLowerCase().includes(JOB_FILTER),
    );
  console.log(
    `Jobs: ${allJobs.length} total, ${targetJobs.length} matching criteria\n`,
  );

  if (targetJobs.length === 0) {
    console.log("No jobs to process.");
    return;
  }
  if (activeCandidates.length === 0) {
    console.log("No active candidates with CVs to match.");
    return;
  }

  // 4. For each job, score all candidates and produce ranked shortlist.
  let totalApplicationsCreated = 0;
  let totalErrors = 0;

  for (const job of targetJobs) {
    const companyName = job.company?.name ?? "Unknown Company";
    const addedDate = new Date(job.createdAt).toISOString().slice(0, 10);
    const hasEmail = Boolean(job.opportunityEmail?.trim());

    console.log("─".repeat(60));
    console.log(`Job: ${job.title}`);
    console.log(`     ${companyName} | Added: ${addedDate}`);
    console.log(
      `     Opportunity email: ${hasEmail ? "✓ set" : "✗ not set (email generation will be skipped)"}`,
    );
    console.log();
    // ── AI semantic gate (fetched once per job before ATS loop) ───────────────
    // The AI endpoint batches all candidates against the JD semantically.
    // In APPLY mode, only candidates appearing in BOTH the ATS pass AND the AI
    // shortlist will receive an Application record. If AI is unavailable we
    // fall back to ATS-only and log a warning.
    let aiScoredMap = null;
    if (APPLY) {
      console.log("  Fetching AI-scored candidates...");
      aiScoredMap = await fetchAiScoredCandidates(job.id, cookieHeader);
      if (aiScoredMap !== null) {
        console.log(
          `  AI validated  : ${aiScoredMap.size} candidate(s) passed semantic match`,
        );
      }
      console.log();
    }
    // Score all candidates for this job via the ats-match API.
    const scored = [];
    for (const candidate of activeCandidates) {
      let match;
      try {
        match = await atsMatchViaApi(candidate.id, job.id, cookieHeader);
      } catch (err) {
        console.error(`  ✗  ${candidate.fullName}: ${err.message}`);
        continue;
      }
      if (!match) continue;
      scored.push({
        candidate,
        score: match.score,
        missing: match.missingKeywords,
      });
    }

    // Sort descending by score.
    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      console.log("  No candidates could be scored.");
      console.log();
      continue;
    }

    // Display top N candidates.
    const display = scored.slice(0, TOP_N);
    const aboveThreshold = display.filter((s) => s.score >= MIN_SCORE);
    const belowThreshold = display.filter((s) => s.score < MIN_SCORE);

    if (aboveThreshold.length > 0) {
      console.log(`  Candidates at or above threshold (${MIN_SCORE}):`);
      for (const { candidate, score, missing } of aboveThreshold) {
        const missingStr =
          missing.length > 0
            ? `  missing: ${missing.slice(0, 3).join(", ")}`
            : "";
        console.log(
          `    ✓ [${String(score).padStart(3)}] ${candidate.fullName}${missingStr}`,
        );

        if (APPLY) {
          // ── AI semantic gate ───────────────────────────────────────────────
          // If AI scored this job, only create an Application when the
          // candidate appears in the AI shortlist. Print the AI confidence /
          // rationale so the console log shows WHY the decision was made.
          if (aiScoredMap !== null) {
            const aiResult = aiScoredMap.get(candidate.id);
            if (!aiResult) {
              console.log(
                `          ✗ Skipped: did not pass AI semantic validation`,
              );
              continue;
            }
            console.log(
              `          AI confidence: ${aiResult.score}% — ${aiResult.rationale}`,
            );
          }

          try {
            await createApplication(job.id, candidate.id, cookieHeader);
            totalApplicationsCreated++;
            console.log(`          Application created`);
          } catch (err) {
            totalErrors++;
            console.error(`          ✗ Error: ${err.message}`);
          }
        }
      }
    }

    if (belowThreshold.length > 0) {
      console.log(`  Other top candidates (below threshold):`);
      for (const { candidate, score, missing } of belowThreshold) {
        const missingStr =
          missing.length > 0
            ? `  missing: ${missing.slice(0, 3).join(", ")}`
            : "";
        console.log(
          `    ⚠ [${String(score).padStart(3)}] ${candidate.fullName}${missingStr}`,
        );
      }
    }

    const notShown = Math.max(0, scored.length - TOP_N);
    if (notShown > 0) {
      console.log(`  ... and ${notShown} more candidates not shown`);
    }
    console.log();
  }

  // 5. Summary.
  console.log("=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`Jobs processed   : ${targetJobs.length}`);
  console.log(`Candidates scored: ${activeCandidates.length}`);
  if (APPLY) {
    console.log(`Applications created: ${totalApplicationsCreated}`);
    console.log(`Errors           : ${totalErrors}`);
  }
  if (!APPLY) {
    console.log();
    console.log("This was a dry run. Add --apply to create Applications.");
    console.log("Note: email generation is handled by cvMatchDraftAgent.cjs.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
