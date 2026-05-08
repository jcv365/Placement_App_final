import { generateStructuredJson } from "@/lib/aiJson";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import {
    buildRoleMatchGuardPromptRules,
    guardCandidateForOpportunity,
} from "@/lib/roleMatchGuard";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const MAX_CV_SNIPPET = 900;
const BATCH_SIZE = 12;
const AI_CONFIDENCE_THRESHOLD = 60;
const MAX_RESULTS = 10;

type CachedMatchRow = {
  candidateId: string;
  aiScore: number | bigint;
  rationale: string;
  fullName: string;
  email: string | null;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
  isActive: number | boolean;
};

type CandidateRow = {
  id: string;
  fullName: string;
  email: string | null;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
  preferredRolesCsv: string;
  rawCV: string | null;
};

type AiMatchItem = {
  candidateId: string;
  match: boolean;
  confidence?: number;
  rationale?: string;
};

type AiMatchResponse = {
  matches?: AiMatchItem[];
};

export type AiScoredCandidate = {
  id: string;
  fullName: string;
  email: string | null;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
  isActive: boolean;
  aiScore: number;
  rationale: string;
};

function splitBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function buildCandidateSummary(candidate: CandidateRow, idx: number): string {
  const cv = (candidate.rawCV ?? "").slice(0, MAX_CV_SNIPPET);
  return [
    `Candidate ${idx + 1}`,
    `candidateId: ${candidate.id}`,
    `name: ${candidate.fullName}`,
    `skills: ${candidate.skillsCsv}`,
    `certifications: ${candidate.certificationsCsv}`,
    `roles: ${candidate.suggestedRolesCsv}`,
    `cv: ${cv}`,
  ].join("\n");
}

export async function GET(request: Request) {
  const scope = resolveTenantAccessScope(request);
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  const forceRefresh = searchParams.get("force") === "true";

  if (!jobId || typeof jobId !== "string" || jobId.length > 100) {
    return jsonError("jobId is required", 400);
  }

  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      tenantId: scope.tenantId,
      ...getOwnerFilter(scope),
    },
    select: {
      id: true,
      title: true,
      rawText: true,
      company: { select: { name: true } },
    },
  });

  if (!job) {
    return jsonError("Job not found", 404);
  }

  // --- Cache check: return stored results if available and not forced ---
  if (!forceRefresh) {
    try {
      const cached = await prisma.$queryRaw<CachedMatchRow[]>`
        SELECT m."candidateId", m."aiScore", m."rationale",
               c."fullName", c."email", c."skillsCsv", c."certificationsCsv",
               c."suggestedRolesCsv", c."isActive"
        FROM   "JobCandidateMatch" m
        JOIN   "Candidate" c ON c."id" = m."candidateId" AND c."tenantId" = ${scope.tenantId}
        WHERE  m."tenantId" = ${scope.tenantId}
          AND  m."jobId"    = ${jobId}
        ORDER  BY m."aiScore" DESC
        LIMIT  ${MAX_RESULTS}
      `;
      if (cached.length > 0) {
        const scored: AiScoredCandidate[] = cached.map((row) => ({
          id: row.candidateId,
          fullName: row.fullName,
          email: row.email,
          skillsCsv: row.skillsCsv,
          certificationsCsv: row.certificationsCsv,
          suggestedRolesCsv: row.suggestedRolesCsv,
          isActive: Boolean(row.isActive),
          aiScore: Number(row.aiScore),
          rationale: row.rationale,
        }));
        return jsonOk({ candidates: scored, cached: true });
      }
    } catch {
      // Cache table may not exist yet (pre-migration); fall through to AI scoring.
    }
  }

  const [candidates, existingApps] = await Promise.all([
    prisma.candidate.findMany({
      where: {
        tenantId: scope.tenantId,
        isActive: true,
        ...getOwnerFilter(scope),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        skillsCsv: true,
        certificationsCsv: true,
        suggestedRolesCsv: true,
        preferredRolesCsv: true,
        rawCV: true,
      },
    }),
    prisma.application.findMany({
      where: { tenantId: scope.tenantId, jobId },
      select: { candidateId: true },
    }),
  ]);

  const appliedIds = new Set(existingApps.map((a) => a.candidateId));

  // Deterministic role pre-filter — prevents cross-family (engineer ≠ architect)
  // mismatches from consuming AI tokens and producing noisy results.
  const eligible = candidates.filter((c) => {
    if (appliedIds.has(c.id)) return false;
    const rolesCsv = c.preferredRolesCsv?.trim() || c.suggestedRolesCsv;
    const roles = rolesCsv
      .split(/[;,\n|]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    if (roles.length === 0) return false;
    return guardCandidateForOpportunity(roles, job.title).allowed;
  });

  if (eligible.length === 0) {
    return jsonOk({ candidates: [] });
  }

  const systemPrompt = [
    "You are an expert technical recruitment consultant evaluating candidate-job fit.",
    "Return strict JSON only with key 'matches' as an array.",
    "Each item must include: candidateId (string), match (boolean), confidence (0-100 integer), rationale (concise factual string citing specific CV evidence).",
    "Base assessment solely on supplied evidence. Do not infer experience or qualifications not explicitly documented in the CV.",
    "",
    buildRoleMatchGuardPromptRules(),
  ].join("\n");

  const batches = splitBatches(eligible, BATCH_SIZE);
  const aiResults = new Map<
    string,
    { confidence: number; rationale: string }
  >();

  for (const batch of batches) {
    const candidateListText = batch
      .map((c, i) => buildCandidateSummary(c, i))
      .join("\n\n---\n\n");

    const userPrompt = [
      `OPPORTUNITY ROLE: ${job.title}`,
      `COMPANY: ${job.company?.name ?? "Unknown"}`,
      `FULL JOB DESCRIPTION:\n${job.rawText.slice(0, 2500)}`,
      "",
      `CANDIDATES:\n${candidateListText}`,
      "",
      "EVALUATION RULES:",
      "- Evaluate ALL listed candidates and include each exactly once.",
      "- match=true only when the candidate's documented role history genuinely aligns with the opportunity role.",
      "- Do NOT match across role families (engineer ≠ architect; developer ≠ analyst).",
      "- Do NOT match when a key domain specialisation is absent from the candidate's background.",
      "- confidence ≥ 80 only when the CV explicitly documents the specific role, named technology, or domain.",
      "- rationale: cite specific CV evidence (e.g. '3 years as Azure Solutions Architect at Acme Corp').",
      'Return JSON: {"matches":[{"candidateId":"","match":false,"confidence":0,"rationale":""}]}',
    ].join("\n");

    try {
      const result = await generateStructuredJson<AiMatchResponse>({
        systemPrompt,
        userPrompt,
        maxTokens: 1500,
        temperature: 0,
      });

      for (const item of result.matches ?? []) {
        if (typeof item.candidateId !== "string") continue;
        const confidence = Number(item.confidence ?? 0);
        if (!Number.isFinite(confidence)) continue;
        const clamped = Math.max(0, Math.min(100, confidence));
        if (item.match && clamped >= AI_CONFIDENCE_THRESHOLD) {
          const candidate = batch.find((c) => c.id === item.candidateId);
          if (!candidate) continue;
          aiResults.set(item.candidateId, {
            confidence: clamped,
            rationale:
              typeof item.rationale === "string" && item.rationale.trim()
                ? item.rationale.trim()
                : "AI confirmed match.",
          });
        }
      }
    } catch {
      // Continue with remaining batches on error
    }
  }

  const candidateMap = new Map<string, CandidateRow>(
    candidates.map((c) => [c.id, c]),
  );

  const scored: AiScoredCandidate[] = Array.from(aiResults.entries())
    .sort((a, b) => b[1].confidence - a[1].confidence)
    .slice(0, MAX_RESULTS)
    .map(([id, result]) => {
      const c = candidateMap.get(id)!;
      return {
        id: c.id,
        fullName: c.fullName,
        email: c.email,
        skillsCsv: c.skillsCsv,
        certificationsCsv: c.certificationsCsv,
        suggestedRolesCsv: c.suggestedRolesCsv,
        isActive: true,
        aiScore: result.confidence,
        rationale: result.rationale,
      };
    });

  // --- Persist results to cache so future requests skip AI ---
  if (scored.length > 0) {
    try {
      await Promise.all(
        scored.map((s) => {
          const id = randomUUID();
          const score = s.aiScore;
          const rationale = s.rationale;
          const candidateId = s.id;
          return prisma.$executeRaw`
            INSERT OR REPLACE INTO "JobCandidateMatch"
              ("id", "tenantId", "jobId", "candidateId", "aiScore", "rationale", "createdAt")
            VALUES
              (${id}, ${scope.tenantId}, ${jobId}, ${candidateId}, ${score}, ${rationale}, CURRENT_TIMESTAMP)
          `;
        }),
      );
    } catch {
      // Non-fatal — cache write failure should not break the response.
    }
  }

  return jsonOk({ candidates: scored });
}
