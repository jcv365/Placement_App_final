import { generateStructuredJson } from "@/lib/aiJson";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";

export const runtime = "nodejs";

const MAX_RECOMMENDATIONS = 20;
const MAX_JOBS_TO_SCORE = 300;
// Keyword pre-filter: score all jobs with existing logic, pass top N to AI.
const KEYWORD_PRE_FILTER_TOP_N = 40;
const AI_BATCH_SIZE = 10;
const AI_CONFIDENCE_THRESHOLD = 30; // low floor — AI then ranks/sorts

type CandidateProfile = {
  id: string;
  fullName: string;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
};

function parseCsvTerms(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 2);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/* ------------------------------------------------------------------ */
/*  Keyword pre-filter (fast, no AI tokens) — narrows 300 → top 40   */
/* ------------------------------------------------------------------ */

const TITLE_STOP = new Set([
  "the", "and", "for", "with", "a", "an", "of", "or", "in", "at", "to",
  "senior", "junior", "mid", "lead", "principal", "staff", "head",
]);

const BODY_STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "will", "are", "you",
  "your", "our", "has", "have", "had", "been", "being", "can", "could", "may",
  "might", "would", "shall", "should", "about", "into", "over", "after",
  "before", "under", "between", "through", "any", "all", "each", "every",
  "not", "but", "other", "than", "also", "their", "them", "they", "these",
  "those", "must", "just", "more", "most", "such", "able", "need", "its",
  "per", "who", "what", "how", "why", "when", "where", "which", "get", "got",
  "let", "here", "there", "very", "only", "some", "same", "make", "made",
  "well", "too", "own", "way", "both", "then", "was", "were", "one", "two",
  "work", "working", "role", "looking", "required", "experience", "ideal",
  "including", "using", "join", "team", "company", "client", "based", "strong",
  "good", "ensure", "provide", "opportunity", "responsible", "knowledge",
  "understanding", "please", "apply", "minimum", "preferred", "position",
  "day", "days", "week", "new", "take", "part", "year", "years",
  "linkedin", "post", "posts", "follow", "share", "like", "comment",
  "hiring", "currently", "recruiting", "see", "view", "ago", "edited",
  "reactions", "services", "connect", "message", "feed", "3rd",
]);

function significantTokens(
  text: string,
  stops: Set<string>,
  minLen = 3,
): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((t) => t.length >= minLen && !stops.has(t)),
  );
}

function buildCandidateProfile(candidate: CandidateProfile) {
  const fullText = [
    candidate.skillsCsv,
    candidate.certificationsCsv,
    candidate.suggestedRolesCsv,
  ].join(", ");
  return {
    skills: parseCsvTerms(candidate.skillsCsv),
    certifications: parseCsvTerms(candidate.certificationsCsv),
    roles: parseCsvTerms(candidate.suggestedRolesCsv),
    tokens: significantTokens(fullText, new Set(), 2),
  };
}

type JobRow = {
  id: string;
  title: string;
  rawText: string;
  createdAt: Date;
  opportunityEmail: string | null;
  opportunityUrl: string | null;
  company: { name: string } | null;
};

function keywordPreScore(
  job: JobRow,
  profile: ReturnType<typeof buildCandidateProfile>,
): number {
  const rawTitle = job.title.replace(/&amp;/g, "&");
  const segments = rawTitle.includes(",")
    ? rawTitle.split(",").map((s) => s.trim()).filter(Boolean)
    : [rawTitle];

  let bestTitleScore = 0;
  for (const segment of segments) {
    const segTokens = significantTokens(segment, TITLE_STOP, 2);
    if (segTokens.size === 0) continue;
    const tokenRatio =
      [...segTokens].filter((t) => profile.tokens.has(t)).length /
      segTokens.size;
    const bestRoleCoverage = Math.max(
      0,
      ...profile.roles.map((role) => {
        const rTokens = significantTokens(role, TITLE_STOP, 2);
        return (
          [...segTokens].filter((t) => rTokens.has(t)).length / segTokens.size
        );
      }),
    );
    const segScore =
      bestRoleCoverage >= 1 ? 85
        : bestRoleCoverage >= 0.6 && tokenRatio >= 1 ? 80
        : tokenRatio >= 1 ? 70
        : tokenRatio * 60;
    bestTitleScore = Math.max(bestTitleScore, segScore);
  }

  const bodyTokens = significantTokens(job.rawText, BODY_STOP);
  const titleTokenSet = new Set(
    segments.flatMap((s) => [...significantTokens(s, TITLE_STOP, 2)]),
  );
  const bodyOnlyTokens = [...bodyTokens].filter((t) => !titleTokenSet.has(t));
  const bodyMatched = bodyOnlyTokens.filter((t) => profile.tokens.has(t));
  const bodyScore = Math.min(bodyMatched.length * 3, 15);

  return clampScore(bestTitleScore + bodyScore);
}

/* ------------------------------------------------------------------ */
/*  AI semantic ranking — batches pre-filtered jobs through the LLM   */
/* ------------------------------------------------------------------ */

type AiJobRankItem = {
  jobId: string;
  confidence: number;
  rationale: string;
};

type AiJobRankResponse = {
  rankings?: AiJobRankItem[];
};

async function aiRankJobs(
  candidate: CandidateProfile,
  jobs: JobRow[],
): Promise<Map<string, { confidence: number; rationale: string }>> {
  const results = new Map<string, { confidence: number; rationale: string }>();

  const candidateSummary = [
    `Candidate: ${candidate.fullName}`,
    `Skills: ${candidate.skillsCsv || "not specified"}`,
    `Certifications: ${candidate.certificationsCsv || "not specified"}`,
    `Suggested roles: ${candidate.suggestedRolesCsv || "not specified"}`,
  ].join("\n");

  const systemPrompt = [
    "You are an expert technical recruitment consultant ranking job opportunities for a candidate.",
    "Return strict JSON only with key 'rankings' as an array.",
    "Each item must include: jobId (string), confidence (0-100 integer — how well the candidate fits), rationale (one concise sentence citing specific evidence).",
    "confidence ≥ 80: candidate's background explicitly covers the role domain and seniority.",
    "confidence 50-79: meaningful overlap but some gaps.",
    "confidence < 50: limited relevance — still include, just rate accurately.",
    "Do NOT assume skills or experience not documented in the candidate profile.",
    "Include ALL jobs supplied — do not omit any.",
  ].join("\n");

  // Process in batches
  for (let i = 0; i < jobs.length; i += AI_BATCH_SIZE) {
    const batch = jobs.slice(i, i + AI_BATCH_SIZE);
    const jobListText = batch
      .map(
        (j) =>
          `jobId: ${j.id}\ntitle: ${j.title}\ndescription: ${j.rawText.slice(0, 600)}`,
      )
      .join("\n\n---\n\n");

    const userPrompt = [
      `CANDIDATE PROFILE:\n${candidateSummary}`,
      ``,
      `JOBS TO RANK:\n${jobListText}`,
      ``,
      `Rate each job for this candidate and return:`,
      `{"rankings":[{"jobId":"","confidence":0,"rationale":""}]}`,
    ].join("\n");

    try {
      const result = await generateStructuredJson<AiJobRankResponse>({
        systemPrompt,
        userPrompt,
        maxTokens: 1000,
        temperature: 0,
      });

      for (const item of result.rankings ?? []) {
        if (typeof item.jobId !== "string") continue;
        const confidence = Math.max(
          0,
          Math.min(100, Math.round(Number(item.confidence ?? 0))),
        );
        results.set(item.jobId, {
          confidence,
          rationale:
            typeof item.rationale === "string" && item.rationale.trim()
              ? item.rationale.trim()
              : "AI assessed candidate fit.",
        });
      }
    } catch {
      // Continue on batch failure — un-scored jobs are excluded from results
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  GET handler                                                        */
/* ------------------------------------------------------------------ */

export async function GET(request: Request) {
  const scope = resolveTenantAccessScope(request);
  const { searchParams } = new URL(request.url);
  const candidateId = searchParams.get("candidateId")?.trim();

  if (!candidateId) {
    return jsonError("candidateId is required", 400);
  }

  const [candidate, jobs, applications] = await Promise.all([
    prisma.candidate.findFirst({
      where: {
        id: candidateId,
        tenantId: scope.tenantId,
        ...getOwnerFilter(scope),
      },
      select: {
        id: true,
        fullName: true,
        skillsCsv: true,
        certificationsCsv: true,
        suggestedRolesCsv: true,
      },
    }),
    prisma.job.findMany({
      where: {
        tenantId: scope.tenantId,
        ...getOwnerFilter(scope),
      },
      select: {
        id: true,
        title: true,
        rawText: true,
        createdAt: true,
        opportunityEmail: true,
        opportunityUrl: true,
        company: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_JOBS_TO_SCORE,
    }),
    prisma.application.findMany({
      where: { tenantId: scope.tenantId, candidateId },
      select: { jobId: true },
    }),
  ]);

  if (!candidate) {
    return jsonError("Candidate not found", 404);
  }

  const candidateProfile = buildCandidateProfile(candidate);
  const appliedJobIds = new Set(applications.map((a) => a.jobId));

  // Step 1: fast keyword pre-filter — narrows 300 jobs to top 40 candidates
  const unappliedJobs = jobs.filter((j) => !appliedJobIds.has(j.id));
  const keywordScored = unappliedJobs
    .map((job) => ({ job, score: keywordPreScore(job, candidateProfile) }))
    .filter((item) => item.score >= 10)
    .sort((a, b) => b.score - a.score)
    .slice(0, KEYWORD_PRE_FILTER_TOP_N);

  if (keywordScored.length === 0) {
    return jsonOk({
      candidate: { id: candidate.id, fullName: candidate.fullName },
      summary: {
        scoredJobs: jobs.length,
        excludedAppliedJobs: appliedJobIds.size,
        recommendations: 0,
      },
      recommendations: [],
    });
  }

  // Step 2: AI semantic ranking of the pre-filtered jobs
  const aiRankings = await aiRankJobs(
    candidate,
    keywordScored.map((i) => i.job),
  );

  // Step 3: Build final recommendations from AI results
  const recommendations = keywordScored
    .map(({ job }) => {
      const ai = aiRankings.get(job.id);
      const confidence = ai?.confidence ?? 0;
      const rationale = ai?.rationale ?? "Keyword match — AI scoring unavailable.";

      // Build supplementary match evidence for display
      const jobText = `${job.title}\n${job.rawText}`.toLowerCase();
      const skillMatches = candidateProfile.skills.filter((t) =>
        jobText.includes(t),
      );
      const roleMatches = candidateProfile.roles.filter((t) =>
        jobText.includes(t),
      );

      return {
        jobId: job.id,
        title: job.title,
        companyName: job.company?.name ?? "Unknown company",
        createdAt: job.createdAt,
        opportunityEmail: job.opportunityEmail,
        opportunityUrl: job.opportunityUrl,
        rawText:
          job.rawText.length > 4000 ? job.rawText.slice(0, 4000) : job.rawText,
        score: confidence,
        reasons: [rationale],
        matchedSkills: skillMatches.slice(0, 6),
        matchedRoles: roleMatches.slice(0, 4),
        aiRanked: aiRankings.has(job.id),
      };
    })
    .filter((item) => item.score >= AI_CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECOMMENDATIONS);

  return jsonOk({
    candidate: { id: candidate.id, fullName: candidate.fullName },
    summary: {
      scoredJobs: jobs.length,
      excludedAppliedJobs: appliedJobIds.size,
      recommendations: recommendations.length,
    },
    recommendations,
  });
}
