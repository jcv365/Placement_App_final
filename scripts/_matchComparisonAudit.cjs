/**
 * _matchComparisonAudit.cjs
 *
 * Reproduces the FULL client-side scoring from MatchReviewClient.tsx
 * and the server-side deterministic guard from roleMatchGuard.ts,
 * then compares them side-by-side for all contactable jobs × active candidates.
 *
 * Usage: docker exec <container> node scripts/_matchComparisonAudit.cjs
 */

const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

// ─── Stop-word sets (copied from MatchReviewClient.tsx) ──────────────────

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

// ─── Token helpers (from MatchReviewClient.tsx) ──────────────────────────

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
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

function clampPct(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
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
    .map((s) => s.trim())
    .filter(Boolean);
}

function toCsvPhrases(value) {
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2);
}

function toCsvTerms(value) {
  return new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap((s) => toTerms(s)),
  );
}

function getRequiredCertificationTerms(job) {
  const certPattern =
    /certif|certificate|certified|az-\d{3}|aws\s+certified|gcp\s+certified|cissp|cka|ckad|ccna|comptia|pmp|prince2/i;
  const chunks = splitRequirementChunks(`${job.title}\n${job.rawText}`).filter(
    (c) => certPattern.test(c),
  );
  return new Set(chunks.flatMap((c) => toTerms(c)));
}

// ─── Full client-side scoreCandidate (from MatchReviewClient.tsx) ────────

function scoreCandidate(job, candidate) {
  const rawTitle = job.title.replace(/&amp;/g, "&");
  const bodyText = job.rawText;

  const candidateFullText = [
    candidate.skillsCsv,
    candidate.certificationsCsv,
    candidate.suggestedRolesCsv,
  ].join(", ");
  const candidateTokens = significantTokens(candidateFullText, new Set(), 2);

  // Title match
  const segments = rawTitle.includes(",")
    ? rawTitle
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [rawTitle];

  const candidateRolePhrases = toCsvPhrases(candidate.suggestedRolesCsv);

  let bestTitleScore = 0,
    bestRoleCoverage = 0,
    bestTitleTokenRatio = 0;
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
    if (segmentRoleCoverage >= 1) segScore = 85;
    else if (segmentRoleCoverage >= 0.6 && tokenRatio >= 1) segScore = 80;
    else if (tokenRatio >= 1) segScore = 70;
    else segScore = tokenRatio * 60;
    bestTitleScore = Math.max(bestTitleScore, segScore);
  }

  // Body tokens
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
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 18)
    .map(([token]) => token);

  // Certification gate
  const requiredCertifications = getRequiredCertificationTerms(job);
  const candidateCertTokens = toCsvTerms(candidate.certificationsCsv);
  const requiredCertOverlap = [...requiredCertifications].filter((t) =>
    candidateCertTokens.has(t),
  ).length;
  if (requiredCertifications.size > 0 && requiredCertOverlap === 0) {
    return {
      overall: 0,
      skills: 0,
      certifications: 0,
      roles: 0,
      basis: "CERTIFICATIONS",
    };
  }

  // Body bonus
  const bodyOnlyTokens = [...bodyTokens].filter((t) => !titleTokenSet.has(t));
  const bodyMatched = bodyOnlyTokens.filter((t) => candidateTokens.has(t));
  const bodyScore = Math.min(bodyMatched.length * 3, 15);

  // Dimension breakdowns
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

  // Unified overall
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

  const basis = overall > 0 ? "WEIGHTED" : "BASELINE";
  return { overall, skills, certifications, roles, basis };
}

// ─── Deterministic role guard (from roleMatchGuard.ts) ──────────────────

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
]);

const SPECIALISATION_COVERAGE_THRESHOLD = 0.75;

function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokenise(text) {
  return normalise(text)
    .split(" ")
    .filter((t) => t.length >= 3);
}
function extractFamilyWords(role) {
  const f = new Set();
  for (const t of tokenise(role)) if (ROLE_FAMILY_WORDS.has(t)) f.add(t);
  return f;
}
function extractSpecialisationTokens(role) {
  return tokenise(role).filter(
    (t) => !SENIORITY_WORDS.has(t) && !ROLE_FAMILY_WORDS.has(t),
  );
}

function guardRoleMatch(oppRole, candRole) {
  const oppFamily = extractFamilyWords(oppRole);
  const candFamily = extractFamilyWords(candRole);

  if (oppFamily.size > 0) {
    const shared = [...oppFamily].filter((w) => candFamily.has(w));
    if (shared.length === 0) {
      return {
        allowed: false,
        failureType: "family_mismatch",
        reason: `Family mismatch: opp=[${[...oppFamily]}] vs cand=[${[...candFamily]}]`,
      };
    }
  }

  const oppSpec = extractSpecialisationTokens(oppRole);
  if (oppSpec.length > 0) {
    const candTokens = new Set(tokenise(candRole));
    const covered = oppSpec.filter((t) => candTokens.has(t));
    const ratio = covered.length / oppSpec.length;
    if (ratio < SPECIALISATION_COVERAGE_THRESHOLD) {
      const missing = oppSpec.filter((t) => !candTokens.has(t));
      return {
        allowed: false,
        failureType: "specialisation_gap",
        reason: `Spec gap: ${Math.round(ratio * 100)}% coverage, missing=[${missing}]`,
      };
    }
  }

  return { allowed: true, reason: "Compatible" };
}

function guardCandidateForOpportunity(candidateRoles, oppRole) {
  const failed = [];
  for (const r of candidateRoles) {
    const result = guardRoleMatch(oppRole, r);
    if (result.allowed)
      return { allowed: true, matchedRole: r, reason: result.reason };
    failed.push({
      role: r,
      failureType: result.failureType,
      reason: result.reason,
    });
  }
  return { allowed: false, matchedRole: null, failedRoles: failed };
}

// ─── Main ────────────────────────────────────────────────────────────────

(async () => {
  // 1. Fetch contactable jobs (have opportunityEmail set)
  const rawJobs = await db.job.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      opportunityEmail: { not: null },
      NOT: { opportunityEmail: "" },
    },
    select: {
      id: true,
      title: true,
      rawText: true,
      createdAt: true,
      opportunityEmail: true,
    },
    orderBy: { createdAt: "desc" },
  });
  // The list API truncates rawText to 4000 chars — match that behaviour
  const jobs = rawJobs.map((j) => ({
    ...j,
    rawText: j.rawText.length > 4000 ? j.rawText.slice(0, 4000) : j.rawText,
  }));

  // 2. Fetch active candidates
  const candidates = await db.candidate.findMany({
    where: { tenantId: "dotcloudconsulting", isActive: true },
    select: {
      id: true,
      fullName: true,
      email: true,
      suggestedRolesCsv: true,
      skillsCsv: true,
      certificationsCsv: true,
      isActive: true,
    },
  });

  console.log(`Jobs (contactable): ${jobs.length}`);
  console.log(`Active candidates: ${candidates.length}`);
  console.log("─".repeat(100));

  // 3. Score ALL pairs and find client-side >=75% matches
  const clientMatches = [];
  for (const job of jobs) {
    for (const cand of candidates) {
      const score = scoreCandidate(job, cand);
      if (score.overall >= 75) {
        // Also run the deterministic guard
        const candRoles = cand.suggestedRolesCsv
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const guardResult = guardCandidateForOpportunity(candRoles, job.title);

        clientMatches.push({
          jobTitle: job.title.slice(0, 55),
          candidateName: cand.fullName,
          candidateRoles: cand.suggestedRolesCsv.slice(0, 60),
          clientScore: score.overall,
          roles: score.roles,
          skills: score.skills,
          guardAllowed: guardResult.allowed,
          guardReason: guardResult.allowed
            ? `Matched via "${guardResult.matchedRole}"`
            : guardResult.failedRoles
                ?.map((f) => `${f.role}: ${f.failureType}`)
                .join("; "),
        });
      }
    }
  }

  clientMatches.sort((a, b) => b.clientScore - a.clientScore);

  console.log(
    `\nClient-side matches (score >= 75%): ${clientMatches.length}\n`,
  );

  // 4. Summary stats
  const guardPassed = clientMatches.filter((m) => m.guardAllowed).length;
  const guardBlocked = clientMatches.filter((m) => !m.guardAllowed).length;
  console.log(`  Guard PASSED: ${guardPassed}`);
  console.log(`  Guard BLOCKED: ${guardBlocked}`);
  console.log("─".repeat(100));

  // 5. Show the matches grouped by guard result
  console.log("\n=== GUARD PASSED (would proceed to LLM validation) ===\n");
  for (const m of clientMatches.filter((m) => m.guardAllowed)) {
    console.log(
      `  ${m.clientScore}%  | ${m.jobTitle.padEnd(55)} | ${m.candidateName.padEnd(25)} | Roles: ${m.roles}% Skills: ${m.skills}% | ${m.guardReason}`,
    );
  }

  console.log("\n=== GUARD BLOCKED (deterministic rejection) ===\n");
  const blockedByType = { family_mismatch: 0, specialisation_gap: 0 };
  for (const m of clientMatches.filter((m) => !m.guardAllowed)) {
    const types = m.guardReason.split("; ").map((s) => s.split(": ").pop());
    for (const t of types) {
      if (blockedByType[t] !== undefined) blockedByType[t]++;
    }
  }
  console.log(`  family_mismatch: ${blockedByType.family_mismatch}`);
  console.log(`  specialisation_gap: ${blockedByType.specialisation_gap}`);

  // Show top 20 blocked for detail
  const blocked = clientMatches.filter((m) => !m.guardAllowed);
  console.log(
    `\n  (showing top ${Math.min(30, blocked.length)} blocked by score):\n`,
  );
  for (const m of blocked.slice(0, 30)) {
    console.log(
      `  ${m.clientScore}%  | ${m.jobTitle.padEnd(55)} | ${m.candidateName.padEnd(25)} | Guard: ${m.guardReason}`,
    );
  }

  // 6. TODAY's matches only (what "Regenerate all today" would attempt)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayJobs = jobs.filter((j) => new Date(j.createdAt) >= todayStart);
  const todayMatches = clientMatches.filter((m) =>
    todayJobs.some((j) =>
      j.title.startsWith(m.jobTitle.replace(/\.\.\.$/, "")),
    ),
  );
  console.log(`\n${"─".repeat(100)}`);
  console.log(`TODAY's jobs: ${todayJobs.length}`);
  console.log(
    `TODAY's high-score matches (what bulk regenerate would attempt): ${todayMatches.length}`,
  );
  if (todayMatches.length > 0) {
    const todayPassed = todayMatches.filter((m) => m.guardAllowed).length;
    const todayBlocked = todayMatches.filter((m) => !m.guardAllowed).length;
    console.log(`  Guard PASSED: ${todayPassed}`);
    console.log(`  Guard BLOCKED: ${todayBlocked}`);
  }

  await db["$disconnect"]();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
