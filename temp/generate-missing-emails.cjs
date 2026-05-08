"use strict";
const path = require("path");
const crypto = require("crypto");

process.env.DATABASE_URL =
  "file:" + path.resolve(__dirname, "../prisma/prod.db");
process.env.APP_SESSION_SECRET = "DwNteqv6/xUwLc1LwbWzbHOSD8CWUdFCMHZzQ1oJ59Q=";

const API_BASE = "http://127.0.0.1:3001";

// ─── Session minting ─────────────────────────────────────────────────────────

function signValue(value) {
  return crypto
    .createHmac("sha256", process.env.APP_SESSION_SECRET)
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

// ─── Scoring (ported from MatchReviewClient.tsx) ──────────────────────────────

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
    (text || "")
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((t) => t.length >= minLen && !stops.has(t)),
  );
}

function tokenFrequency(text, stops, minLen = 3) {
  const counts = new Map();
  const tokens = (text || "")
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length >= minLen && !stops.has(t));
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function clampPct(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toTerms(value) {
  return (value || "")
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
}

function splitRequirementChunks(value) {
  return (value || "")
    .split(/[\n;|.]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toCsvPhrases(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 2);
}

function toCsvTerms(value) {
  return new Set(
    (value || "")
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
    (c) => certPattern.test(c),
  );
  return new Set(chunks.flatMap((c) => toTerms(c)));
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
    return { overall: 0 };
  }

  const bodyOnlyTokens = [...bodyTokens].filter((t) => !titleTokenSet.has(t));
  const bodyMatched = bodyOnlyTokens.filter((t) => candidateTokens.has(t));
  const bodyScore = Math.min(bodyMatched.length * 3, 15);

  const candSkillTokens = significantTokens(candidate.skillsCsv, new Set(), 2);

  const effectiveRequirementTokens =
    topRequirementTokens.length > 0
      ? topRequirementTokens
      : [...new Set([...titleTokenSet, ...bodyTokens])].slice(0, 18);

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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const adminUser = await prisma.tenantUser.findFirst({
      where: { tenantId: "dotcloudconsulting", role: "ADMIN", isActive: true },
      select: { id: true, email: true },
    });
    const user =
      adminUser ??
      (await prisma.tenantUser.findFirst({
        where: { tenantId: "dotcloudconsulting", isActive: true },
        select: { id: true, email: true },
      }));
    if (!user) throw new Error("No users in dotcloudconsulting");
    console.log("Using user:", user.email);

    const cookieHeader = `tenantId=dotcloudconsulting; appSession=${mintSession(user.id, "dotcloudconsulting")}`;

    // Load all jobs with an opportunity email
    const jobs = await prisma.job.findMany({
      where: {
        tenantId: "dotcloudconsulting",
        opportunityEmail: { not: null },
      },
      select: {
        id: true,
        title: true,
        rawText: true,
        opportunityEmail: true,
      },
    });
    console.log(`Jobs with opportunity email: ${jobs.length}`);

    // Load all active candidates (or all if none active)
    let candidates = await prisma.candidate.findMany({
      where: { tenantId: "dotcloudconsulting", isActive: true },
      select: {
        id: true,
        fullName: true,
        isActive: true,
        skillsCsv: true,
        certificationsCsv: true,
        suggestedRolesCsv: true,
      },
    });
    if (candidates.length === 0) {
      candidates = await prisma.candidate.findMany({
        where: { tenantId: "dotcloudconsulting" },
        select: {
          id: true,
          fullName: true,
          isActive: true,
          skillsCsv: true,
          certificationsCsv: true,
          suggestedRolesCsv: true,
        },
      });
    }
    // Dedup candidates by id
    const candMap = new Map();
    for (const c of candidates) candMap.set(c.id, c);
    candidates = [...candMap.values()];
    console.log(`Active candidates: ${candidates.length}`);

    // Build pairs: top-5 per job with score >= 75
    const pairs = [];
    for (const job of jobs) {
      const scored = candidates
        .map((c) => ({ candidate: c, score: scoreCandidate(job, c).overall }))
        .filter((m) => m.score >= 75)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      for (const m of scored) {
        pairs.push({ job, candidate: m.candidate, score: m.score });
      }
    }

    // Dedup pairs by jobId::candidateId
    const seen = new Set();
    const dedupedPairs = pairs.filter((p) => {
      const key = `${p.job.id}::${p.candidate.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(
      `\nEligible pairs (score ≥ 75, top 5 per job): ${dedupedPairs.length}`,
    );
    for (const p of dedupedPairs) {
      console.log(`  [${p.score}%] ${p.job.title} → ${p.candidate.fullName}`);
    }

    if (dedupedPairs.length === 0) {
      console.log("\nNothing to generate.");
      return;
    }
    console.log("\nGenerating...\n");

    let done = 0,
      skipped = 0,
      cached = 0,
      failed = 0;

    for (const pair of dedupedPairs) {
      const label = `${pair.job.title} / ${pair.candidate.fullName}`;
      process.stdout.write(
        `  [${done + skipped + cached + failed + 1}/${dedupedPairs.length}] ${label} ... `,
      );
      try {
        const res = await fetch(`${API_BASE}/api/email/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookieHeader },
          body: JSON.stringify({
            jobId: pair.job.id,
            candidateId: pair.candidate.id,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.skipped) {
          console.log("SKIPPED (no opportunity email)");
          skipped++;
        } else if (data.cached || data.deduplicated) {
          console.log(`CACHED "${data.subject ?? "?"}"`);
          cached++;
        } else if (res.ok || res.status === 201) {
          console.log(`OK "${data.subject ?? "?"}"`);
          done++;
        } else {
          console.log(
            `FAIL ${res.status}: ${JSON.stringify(data.error ?? data).slice(0, 160)}`,
          );
          failed++;
        }
      } catch (err) {
        console.log(`ERR: ${err.message}`);
        failed++;
      }
    }

    console.log(
      `\nDone: ${done} new, ${cached} cached, ${skipped} skipped (no email), ${failed} failed`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
