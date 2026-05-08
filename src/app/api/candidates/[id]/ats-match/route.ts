import { generateStructuredJson } from "@/lib/aiJson";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { matchCvAgainstAts, type AtsMatchResult } from "@/lib/atsMatcher";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";
import { candidateAtsMatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

type AiSummarySchema = { summary: string };

async function generateAiSummary(
  result: AtsMatchResult,
  jobTitle: string | null,
): Promise<string | null> {
  try {
    const matched = result.matchedKeywords.slice(0, 12).join(", ") || "none";
    const missing = result.missingKeywords.slice(0, 8).join(", ") || "none";
    const response = await generateStructuredJson<AiSummarySchema>({
      systemPrompt:
        "You are an ATS analysis assistant. Respond with valid JSON: { \"summary\": \"<one sentence, max 40 words>\" }. Be specific — mention actual matched/missing terms and the score. Do not use generic phrases like 'the candidate shows' or 'overall'.",
      userPrompt: `Job: ${jobTitle ?? "Unknown role"}\nATS score: ${result.score}/100 (${result.decision})\nMatched terms: ${matched}\nMissing terms: ${missing}\nFlags: ${result.flags.map((f) => f.code).join(", ") || "none"}`,
      maxTokens: 80,
      temperature: 0.3,
    });
    return response?.summary ?? null;
  } catch {
    return null;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id: candidateId } = await context.params;
    const body = candidateAtsMatchSchema.parse(await request.json());

    const candidate = await prisma.candidate.findFirst({
      where: {
        id: candidateId,
        tenantId: scope.tenantId,
        ...getOwnerFilter(scope),
      },
      select: {
        id: true,
        fullName: true,
        rawCV: true,
        email: true,
        phone: true,
        skillsCsv: true,
        certificationsCsv: true,
        suggestedRolesCsv: true,
      },
    });

    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    let jobText = body.jobText?.trim();
    let jobId: string | null = null;
    let jobTitle: string | null = null;

    if (body.jobId) {
      const job = await prisma.job.findFirst({
        where: {
          id: body.jobId,
          tenantId: scope.tenantId,
          ...getOwnerFilter(scope),
        },
        select: {
          id: true,
          title: true,
          rawText: true,
        },
      });

      if (!job) {
        return jsonError("Job not found", 404);
      }

      jobId = job.id;
      jobTitle = job.title;
      jobText = `${job.title}\n${job.rawText}`.trim();
    }

    if (!jobText) {
      return jsonError("Either jobId or jobText is required", 400);
    }

    const result = matchCvAgainstAts({
      cvText: candidate.rawCV,
      jobText,
      candidateEmail: candidate.email,
      candidatePhone: candidate.phone,
      skillsCsv: candidate.skillsCsv,
      certificationsCsv: candidate.certificationsCsv,
      suggestedRolesCsv: candidate.suggestedRolesCsv,
    });

    const wantAiSummary =
      new URL(request.url).searchParams.get("aiSummary") === "true";
    if (wantAiSummary) {
      const aiSummary = await generateAiSummary(result, jobTitle);
      if (aiSummary) result.summary = aiSummary;
    }

    return jsonOk({
      candidate: {
        id: candidate.id,
        fullName: candidate.fullName,
      },
      job: {
        id: jobId,
        title: jobTitle,
      },
      result,
    });
  } catch {
    return jsonError("Unable to run ATS match", 400);
  }
}
