// @ts-check
/**
 * bulkMatchAndDraft.js
 *
 * For every job that has NO applications yet:
 *   1. Scores all active candidates using the same keyword algorithm as the UI.
 *   2. Applies the role-family guard (engineer ≠ architect etc.).
 *   3. Creates a SHORTLISTED application for every pair that scores ≥ SCORE_THRESHOLD.
 *   4. Calls /api/email/generate for each new application.
 *
 * Usage (inside Docker):
 *   docker exec -w /app <container> node /app/bulkMatchAndDraft.js
 *   docker exec -w /app <container> node /app/bulkMatchAndDraft.js --dry-run
 *   docker exec -w /app <container> node /app/bulkMatchAndDraft.js --score 80
 *   docker exec -w /app <container> node /app/bulkMatchAndDraft.js --batch 2 --delay 5000
 */

const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const TENANT_ID = "dotcloudconsulting";
const API_BASE = "http://localhost:3000";
const COOKIES = `tenantId=${TENANT_ID}`;

const DRY_RUN = process.argv.includes("--dry-run");

const SCORE_THRESHOLD = (() => {
  const i = process.argv.indexOf("--score");
  return i !== -1 ? parseInt(process.argv[i + 1], 10) || 75 : 75;
})();
const BATCH_SIZE = (() => {
  const i = process.argv.indexOf("--batch");
  return i !== -1 ? parseInt(process.argv[i + 1], 10) || 1 : 1;
})();
const DELAY_MS = (() => {
  const i = process.argv.indexOf("--delay");
  return i !== -1 ? parseInt(process.argv[i + 1], 10) || 4000 : 4000;
})();

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Scoring helpers (ported from MatchReviewClient.tsx)
// ─────────────────────────────────────────────────────────────────────────────

const TITLE_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "a",
  "an",
  "of",
  "or",
  "in",
  "at",
  "to",
  "senior",
  "junior",
  "mid",
  "lead",
  "principal",
  "staff",
  "head",
]);

const BODY_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "will",
  "are",
  "you",
  "your",
  "our",
  "has",
  "have",
  "had",
  "been",
  "being",
  "can",
  "could",
  "may",
  "might",
  "would",
  "shall",
  "should",
  "about",
  "into",
  "over",
  "after",
  "before",
  "under",
  "between",
  "through",
  "any",
  "all",
  "each",
  "every",
  "not",
  "but",
  "other",
  "than",
  "also",
  "their",
  "them",
  "they",
  "these",
  "those",
  "must",
  "just",
  "more",
  "most",
  "such",
  "able",
  "need",
  "its",
  "per",
  "who",
  "what",
  "how",
  "why",
  "when",
  "where",
  "which",
  "get",
  "got",
  "let",
  "here",
  "there",
  "very",
  "only",
  "some",
  "same",
  "make",
  "made",
  "well",
  "too",
  "own",
  "way",
  "both",
  "then",
  "was",
  "were",
  "one",
  "two",
  "work",
  "working",
  "role",
  "looking",
  "required",
  "experience",
  "ideal",
  "including",
  "using",
  "join",
  "team",
  "company",
  "client",
  "based",
  "strong",
  "good",
  "ensure",
  "provide",
  "opportunity",
  "responsible",
  "knowledge",
  "understanding",
  "please",
  "apply",
  "minimum",
  "preferred",
  "position",
  "day",
  "days",
  "week",
  "new",
  "take",
  "part",
  "year",
  "years",
  "linkedin",
  "post",
  "posts",
  "follow",
  "share",
  "like",
  "comment",
  "hiring",
  "currently",
  "recruiting",
  "see",
  "view",
  "ago",
  "edited",
  "reactions",
  "services",
  "connect",
  "message",
  "feed",
  "3rd",
]);

function significantTokens(text, stops, minLen = 3) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((t) => t.length >= minLen && !stops.has(t)),
  );
}

function tokenFrequency(text, stops, minLen = 3) {
  const counts = new Map();
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length >= minLen && !stops.has(t));
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function clampPct(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toTerms(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
}

function splitRequirementChunks(value) {
  return value
    .split(/[\n;|.]+/)
    .map((i) => i.trim())
    .filter(Boolean);
}

function toCsvPhrases(value) {
  return value
    .split(",")
    .map((i) => i.trim().toLowerCase())
    .filter((i) => i.length >= 2);
}

function toCsvTerms(value) {
  return new Set(
    value
      .split(",")
      .map((i) => i.trim())
      .filter(Boolean)
      .flatMap((i) => toTerms(i)),
  );
}

function getRequiredCertificationTerms(job) {
  const certPattern =
    /certif|certificate|certified|az-\d{3}|aws\s+certified|gcp\s+certified|cissp|cka|ckad|ccna|comptia|pmp|prince2/i;
  const chunks = splitRequirementChunks(`${job.title}\n${job.rawText}`).filter(
    (chunk) => certPattern.test(chunk),
  );
  return new Set(chunks.flatMap((chunk) => toTerms(chunk)));
}

function scoreCandidate(job, candidate) {
  const rawTitle = job.title.replace(/&amp;/g, "&");
  const bodyText = job.rawText;

  const candidateFullText = [
    candidate.skillsCsv,
    candidate.certificationsCsv,
    candidate.suggestedRolesCsv,
  ].join(", ");
  const candidateTokens = significantTokens(candidateFullText, new Set(), 2);

  const segments = rawTitle.includes(",")
    ? rawTitle
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [rawTitle];

  const candidateRolePhrases = toCsvPhrases(candidate.suggestedRolesCsv);

  let bestTitleScore = 0;
  let bestRoleCoverage = 0;
  let bestTitleTokenRatio = 0;

  for (const segment of segments) {
    const segTokens = significantTokens(segment, TITLE_STOP, 2);
    if (segTokens.size === 0) continue;

    const tokenOverlap = [...segTokens].filter((t) => candidateTokens.has(t));
    const tokenRatio = tokenOverlap.length / segTokens.size;
    bestTitleTokenRatio = Math.max(bestTitleTokenRatio, tokenRatio);

    const segmentRoleCoverage = Math.max(
      0,
      ...candidateRolePhrases.map((role) => {
        const rTokens = significantTokens(role, TITLE_STOP, 2);
        if (rTokens.size === 0) return 0;
        const intersection = [...segTokens].filter((t) =>
          rTokens.has(t),
        ).length;
        const forward = intersection / segTokens.size;
        const reverse = rTokens.size >= 2 ? intersection / rTokens.size : 0;
        return Math.max(forward, reverse);
      }),
    );
    bestRoleCoverage = Math.max(bestRoleCoverage, segmentRoleCoverage);

    let segScore;
    if (segmentRoleCoverage >= 1) {
      segScore = 85;
    } else if (segmentRoleCoverage >= 0.6 && tokenRatio >= 1) {
      segScore = 80;
    } else if (tokenRatio >= 1) {
      segScore = 70;
    } else {
      segScore = tokenRatio * 60;
    }
    bestTitleScore = Math.max(bestTitleScore, segScore);
  }

  const bodyTokens = significantTokens(bodyText, BODY_STOP);
  const titleTokenSet = new Set(
    segments.flatMap((s) => [...significantTokens(s, TITLE_STOP, 2)]),
  );

  const weightedJobSignals = tokenFrequency(
    `${rawTitle}\n${bodyText}`,
    BODY_STOP,
  );
  for (const titleToken of titleTokenSet) {
    weightedJobSignals.set(
      titleToken,
      (weightedJobSignals.get(titleToken) ?? 0) + 3,
    );
  }
  const topRequirementTokens = Array.from(weightedJobSignals.entries())
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .slice(0, 18)
    .map(([token]) => token);

  const requiredCertifications = getRequiredCertificationTerms(job);
  const candidateCertTokens = toCsvTerms(candidate.certificationsCsv);
  const requiredCertOverlap = [...requiredCertifications].filter((t) =>
    candidateCertTokens.has(t),
  ).length;
  if (requiredCertifications.size > 0 && requiredCertOverlap === 0) {
    return { overall: 0, skills: 0, certifications: 0, roles: 0 };
  }

  const bodyOnlyTokens = [...bodyTokens].filter((t) => !titleTokenSet.has(t));
  const bodyMatched = bodyOnlyTokens.filter((t) => candidateTokens.has(t));
  const bodyScore = Math.min(bodyMatched.length * 3, 15);

  const jobAllTokens = new Set([...titleTokenSet, ...bodyTokens]);
  const candSkillTokens = significantTokens(candidate.skillsCsv, new Set(), 2);

  const effectiveRequirementTokens =
    topRequirementTokens.length > 0
      ? topRequirementTokens
      : [...jobAllTokens].slice(0, 18);

  const skills =
    effectiveRequirementTokens.length > 0
      ? clampPct(
          ([...effectiveRequirementTokens].filter((t) => candSkillTokens.has(t))
            .length /
            effectiveRequirementTokens.length) *
            100,
        )
      : 0;

  const roles = clampPct(Math.max(bestRoleCoverage, bestTitleTokenRatio) * 100);

  const certifications =
    requiredCertifications.size > 0
      ? clampPct((requiredCertOverlap / requiredCertifications.size) * 100)
      : 0;

  const titleBodyOverall = Math.min(
    100,
    Math.round(bestTitleScore + bodyScore),
  );
  const certWeight = requiredCertifications.size > 0 ? 0.1 : 0;
  const roleWeight = 0.45;
  const skillWeight = 0.45;
  const denom = roleWeight + skillWeight + certWeight;
  const componentOverall =
    denom > 0
      ? (roles * roleWeight +
          skills * skillWeight +
          certifications * certWeight) /
        denom
      : 0;

  let overall = clampPct(titleBodyOverall * 0.8 + componentOverall * 0.2);
  if (candidate.isActive) overall = clampPct(overall + 3);

  return { overall, skills, certifications, roles };
}

// ─────────────────────────────────────────────────────────────────────────────
// Role guard (ported from roleMatchGuard.ts)
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_FAMILY_WORDS = new Set([
  "architect",
  "developer",
  "engineer",
  "programmer",
  "analyst",
  "administrator",
  "manager",
  "consultant",
  "specialist",
  "officer",
  "designer",
  "scientist",
  "technician",
  "coordinator",
  "director",
  "executive",
  "sre",
  "devops",
  "operator",
  "practitioner",
  "writer",
  "tester",
  "trainer",
  "researcher",
  "steward",
  "evangelist",
  "strategist",
  "coach",
  "owner",
  "master",
  "cto",
  "ciso",
  "cio",
  "vp",
  "president",
]);

const SENIORITY_WORDS = new Set([
  "senior",
  "junior",
  "lead",
  "principal",
  "chief",
  "associate",
  "graduate",
  "staff",
  "mid",
  "entry",
  "intermediate",
  "expert",
  "head",
  "deputy",
  "assistant",
  "founding",
  "group",
  "regional",
  "global",
  "practice",
  "distinguished",
  "emeritus",
  "honorary",
  "advisory",
  "strategic",
  "business",
  "dex",
  "digital",
  "transformation",
]);

const COMPOUND_EXPANSIONS = [
  [/\bfrontend\b/gi, "front end"],
  [/\bfront-end\b/gi, "front end"],
  [/\bbackend\b/gi, "back end"],
  [/\bback-end\b/gi, "back end"],
  [/\bfullstack\b/gi, "full stack"],
  [/\bfull-stack\b/gi, "full stack"],
];

const TITLE_NOISE_PHRASES = [
  /\bmultiple\s+roles?\b/gi,
  /\band\s+above\b/gi,
  /\bor\s+similar\b/gi,
  /\(.*?\)/g,
];

function normaliseGuard(text) {
  let t = text;
  for (const [p, r] of COMPOUND_EXPANSIONS) t = t.replace(p, r);
  return t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTitleNoise(text) {
  let t = text;
  for (const p of TITLE_NOISE_PHRASES) t = t.replace(p, " ");
  return t.replace(/\s+/g, " ").trim();
}

function tokeniseGuard(text) {
  return normaliseGuard(text)
    .split(" ")
    .filter((t) => t.length >= 3);
}

function extractFamilyWords(roleTitle) {
  const family = new Set();
  for (const token of tokeniseGuard(roleTitle)) {
    if (ROLE_FAMILY_WORDS.has(token)) family.add(token);
  }
  return family;
}

function extractSpecialisationTokens(roleTitle) {
  return tokeniseGuard(roleTitle).filter(
    (t) => !SENIORITY_WORDS.has(t) && !ROLE_FAMILY_WORDS.has(t),
  );
}

const SPECIALISATION_COVERAGE_THRESHOLD = 0.75;

function guardRoleMatch(opportunityRole, candidateRole) {
  const cleanedOppRole = stripTitleNoise(opportunityRole);
  const oppFamily = extractFamilyWords(cleanedOppRole);
  const candFamily = extractFamilyWords(candidateRole);

  if (oppFamily.size > 0) {
    const sharedFamily = [...oppFamily].filter((w) => candFamily.has(w));
    if (sharedFamily.length === 0) return false;
  }

  const acronymTokens = new Set(
    (opportunityRole.match(/\b[A-Z]{2,}\b/g) ?? []).map((a) => a.toLowerCase()),
  );
  const oppSpecialisation = extractSpecialisationTokens(opportunityRole).filter(
    (t) => !acronymTokens.has(t),
  );

  if (oppSpecialisation.length > 0) {
    const candTokens = new Set(tokeniseGuard(candidateRole));
    const covered = oppSpecialisation.filter((t) => candTokens.has(t));
    if (
      covered.length / oppSpecialisation.length <
      SPECIALISATION_COVERAGE_THRESHOLD
    ) {
      return false;
    }
  }

  return true;
}

function guardCandidateForOpportunity(
  candidateSuggestedRoles,
  opportunityRole,
) {
  const opportunityAlternatives = opportunityRole
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const candidateRole of candidateSuggestedRoles) {
    for (const oppAlt of opportunityAlternatives) {
      if (guardRoleMatch(oppAlt, candidateRole)) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// opportunityId (ported from opportunity.ts)
// ─────────────────────────────────────────────────────────────────────────────

function normaliseOpportunityPart(value) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function computeOpportunityId(candidateName, roleTitle) {
  const candidate = normaliseOpportunityPart(candidateName);
  const role = normaliseOpportunityPart(roleTitle);
  const hash = crypto
    .createHash("sha256")
    .update([candidate, role].join("|"))
    .digest("hex")
    .slice(0, 24);
  return `opp_${hash}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// API call
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateEmailApi({ applicationId, jobId, candidateId }) {
  const res = await fetch(`${API_BASE}/api/email/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: COOKIES },
    body: JSON.stringify({ applicationId, jobId, candidateId }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, body: json };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(70));
  console.log("BULK MATCH + DRAFT");
  console.log(`  Date            : ${new Date().toISOString()}`);
  console.log(`  Tenant          : ${TENANT_ID}`);
  console.log(`  Score threshold : ${SCORE_THRESHOLD}`);
  console.log(`  Batch size      : ${BATCH_SIZE}`);
  console.log(`  Delay (ms)      : ${DELAY_MS}`);
  console.log(`  Dry run         : ${DRY_RUN}`);
  console.log("=".repeat(70));

  // ── Load data ──────────────────────────────────────────────────────────────
  const [jobs, candidates] = await Promise.all([
    prisma.job.findMany({
      where: {
        tenantId: TENANT_ID,
        opportunityEmail: { not: null },
        NOT: { opportunityEmail: "" },
        applications: { none: {} },
      },
      include: { company: true },
    }),
    prisma.candidate.findMany({
      where: { tenantId: TENANT_ID, isActive: true },
      select: {
        id: true,
        fullName: true,
        email: true,
        skillsCsv: true,
        certificationsCsv: true,
        suggestedRolesCsv: true,
        isActive: true,
      },
    }),
  ]);

  console.log(`\nJobs with no applications : ${jobs.length}`);
  console.log(`Active candidates          : ${candidates.length}\n`);

  if (jobs.length === 0) {
    console.log("Nothing to do — all jobs already have applications.");
    return;
  }

  // ── Score ──────────────────────────────────────────────────────────────────
  const pairs = [];
  for (const job of jobs) {
    for (const candidate of candidates) {
      const score = scoreCandidate(job, candidate);
      if (score.overall < SCORE_THRESHOLD) continue;

      const roles = candidate.suggestedRolesCsv
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      if (!guardCandidateForOpportunity(roles, job.title)) continue;

      pairs.push({ job, candidate, score: score.overall });
    }
  }

  pairs.sort((a, b) => b.score - a.score);

  console.log(
    `Eligible pairs (score ≥ ${SCORE_THRESHOLD} + role guard): ${pairs.length}\n`,
  );

  if (pairs.length === 0) {
    console.log("No matches found above threshold.");
    return;
  }

  for (const { job, candidate, score } of pairs) {
    console.log(
      `  [${score}] "${job.title}" → ${job.opportunityEmail} | ${candidate.fullName}`,
    );
  }
  console.log();

  if (DRY_RUN) {
    console.log(
      "Dry run complete. Re-run without --dry-run to create applications and generate emails.",
    );
    return;
  }

  // ── Create applications ────────────────────────────────────────────────────
  console.log("Creating applications…");
  const created = [];
  const skippedExisting = [];

  for (const { job, candidate, score } of pairs) {
    const opportunityId = `${TENANT_ID}:${computeOpportunityId(candidate.fullName, job.title)}`;
    const c2cPartner =
      process.env.DEFAULT_C2C_PARTNER_NAME ?? "C2C Partner Ltd";

    let app;
    try {
      app = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          tenantId: TENANT_ID,
          opportunityId,
          c2cPartner,
          currentStage: "SHORTLISTED",
          history: {
            create: {
              tenantId: TENANT_ID,
              fromStage: "NEW",
              toStage: "SHORTLISTED",
              changedBy: "bulkMatchAndDraft",
            },
          },
        },
      });
      created.push({ app, job, candidate, score });
      console.log(
        `  ✓ Created [${score}] "${job.title}" | ${candidate.fullName}`,
      );
    } catch (error) {
      if (error?.code === "P2002") {
        // Already exists — look it up so we can still generate an email
        const existing = await prisma.application.findFirst({
          where: { opportunityId, tenantId: TENANT_ID },
          include: { emails: { select: { id: true } } },
        });
        if (existing && existing.emails.length === 0) {
          created.push({ app: existing, job, candidate, score });
          console.log(
            `  ~ Exists  [${score}] "${job.title}" | ${candidate.fullName} (no draft yet)`,
          );
        } else {
          skippedExisting.push({ job, candidate });
          console.log(
            `  · Skip    [${score}] "${job.title}" | ${candidate.fullName} (already has draft)`,
          );
        }
      } else {
        console.error(
          `  ✗ Error   "${job.title}" | ${candidate.fullName}: ${error.message}`,
        );
      }
    }
  }

  console.log(
    `\nApplications to email: ${created.length}, skipped (already drafted): ${skippedExisting.length}\n`,
  );

  if (created.length === 0) {
    console.log("Nothing left to email.");
    return;
  }

  // ── Generate emails in batches ─────────────────────────────────────────────
  console.log("Generating email drafts…\n");
  let succeeded = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < created.length; i += BATCH_SIZE) {
    const batch = created.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ({ app, job, candidate, score }) => {
        const result = await generateEmailApi({
          applicationId: app.id,
          jobId: job.id,
          candidateId: candidate.id,
        });
        return { result, job, candidate, score };
      }),
    );

    for (const { result, job, candidate, score } of results) {
      const tag = `[${score}] "${job.title}" | ${candidate.fullName}`;
      if (result.ok) {
        succeeded++;
        console.log(`  ✓ ${tag}`);
      } else {
        failed++;
        const msg =
          result.body?.error?.message ??
          result.body?.message ??
          (result.body ? JSON.stringify(result.body) : `HTTP ${result.status}`);
        failures.push({ tag, msg });
        console.log(`  ✗ ${tag} — ${msg}`);
      }
    }

    if (i + BATCH_SIZE < created.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`Done.`);
  console.log(`  Applications created/found : ${created.length}`);
  console.log(`  Emails succeeded           : ${succeeded}`);
  console.log(`  Emails failed              : ${failed}`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  ${f.tag} — ${f.msg}`);
  }
  console.log("=".repeat(70));
}

main()
  .catch((e) => {
    console.error("FATAL:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
