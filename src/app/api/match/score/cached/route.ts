import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantAccessScope } from "@/lib/tenantAccess";

export const runtime = "nodejs";

const MAX_PER_JOB = 10;

type RawMatchRow = {
  jobId: string;
  candidateId: string;
  aiScore: number | bigint;
  rationale: string;
};

export async function POST(request: Request) {
  const scope = resolveTenantAccessScope(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object" || !("jobIds" in body)) {
    return jsonError("jobIds is required", 400);
  }

  const { jobIds } = body as { jobIds: unknown };
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return jsonOk({ results: [] });
  }

  const validIdSet = new Set(
    (jobIds as unknown[]).filter(
      (id): id is string => typeof id === "string" && id.length <= 100,
    ),
  );

  if (validIdSet.size === 0) {
    return jsonOk({ results: [] });
  }

  try {
    // Fetch all cached matches for this tenant — filter to requested job IDs in
    // memory to avoid Prisma.join / raw IN() parameter list issues with SQLite.
    const allRows = await prisma.$queryRaw<RawMatchRow[]>`
      SELECT "jobId", "candidateId", "aiScore", "rationale"
      FROM   "JobCandidateMatch"
      WHERE  "tenantId" = ${scope.tenantId}
      ORDER  BY "aiScore" DESC
    `;

    const filteredRows = allRows.filter((row) => validIdSet.has(row.jobId));
    if (filteredRows.length === 0) {
      return jsonOk({ results: [] });
    }

    // Resolve candidate details via the typesafe Prisma API
    const candidateIds = [...new Set(filteredRows.map((r) => r.candidateId))];
    const candidates = await prisma.candidate.findMany({
      where: { tenantId: scope.tenantId, id: { in: candidateIds } },
      select: {
        id: true,
        fullName: true,
        email: true,
        skillsCsv: true,
        certificationsCsv: true,
        suggestedRolesCsv: true,
        isActive: true,
      },
    });
    const candidateMap = new Map(candidates.map((c) => [c.id, c]));

    // Group by jobId, capped at MAX_PER_JOB per job (rows already sorted by score)
    const grouped = new Map<string, typeof filteredRows>();
    for (const row of filteredRows) {
      if (!validIdSet.has(row.jobId)) continue;
      const group = grouped.get(row.jobId) ?? [];
      if (group.length < MAX_PER_JOB) {
        group.push(row);
        grouped.set(row.jobId, group);
      }
    }

    const results = Array.from(grouped.entries()).flatMap(([jobId, rows]) => {
      const scoredCandidates = rows.flatMap((row) => {
        const c = candidateMap.get(row.candidateId);
        if (!c) return [];
        return [
          {
            id: c.id,
            fullName: c.fullName,
            email: c.email,
            skillsCsv: c.skillsCsv,
            certificationsCsv: c.certificationsCsv,
            suggestedRolesCsv: c.suggestedRolesCsv,
            isActive: c.isActive,
            aiScore: Number(row.aiScore),
            rationale: row.rationale,
          },
        ];
      });
      if (scoredCandidates.length === 0) return [];
      return [{ jobId, candidates: scoredCandidates }];
    });

    return jsonOk({ results });
  } catch {
    // Non-fatal — if the table doesn't exist yet, return empty
    return jsonOk({ results: [] });
  }
}
