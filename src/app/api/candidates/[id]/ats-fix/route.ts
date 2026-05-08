import { jsonError, jsonOk } from "@/lib/apiResponses";
import { matchCvAgainstAts } from "@/lib/atsMatcher";
import {
    inferCandidateProfileFromCv,
    inferSuggestedRolesFromSkillsAndCertifications,
} from "@/lib/candidateProfile";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";
import { candidateAtsFixSchema } from "@/lib/validation";

export const runtime = "nodejs";

function parseCsvTerms(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function dedupeTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(cleaned);
  }

  return output;
}

function buildJobText(title: string | null, rawText: string | null): string {
  return [title ?? "", rawText ?? ""].filter(Boolean).join("\n").trim();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id: candidateId } = await context.params;
    const body = candidateAtsFixSchema.parse(await request.json());
    const bodyExt = body as Record<string, unknown>;
    const modelOverride = (bodyExt.model ?? bodyExt.aiProvider) as
      | string
      | undefined;
    const previewOnly = body.previewOnly ?? false;

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
      jobText = buildJobText(job.title, job.rawText);
    }

    if (!jobText) {
      return jsonError("Either jobId or jobText is required", 400);
    }

    const before = matchCvAgainstAts({
      cvText: candidate.rawCV,
      jobText,
      candidateEmail: candidate.email,
      candidatePhone: candidate.phone,
      skillsCsv: candidate.skillsCsv,
      certificationsCsv: candidate.certificationsCsv,
      suggestedRolesCsv: candidate.suggestedRolesCsv,
    });

    const atsGapHint = before.missingKeywords.slice(0, 12).join(", ");
    const aiInferenceText = [
      "Candidate CV:",
      candidate.rawCV,
      "",
      "Target job context for ATS optimisation:",
      jobText,
      "",
      `Current ATS keyword gaps to strengthen where genuinely relevant: ${atsGapHint}`,
    ]
      .filter(Boolean)
      .join("\n");

    const inferred = await inferCandidateProfileFromCv({
      cvText: aiInferenceText,
      fastMode: true,
      model: modelOverride,
    });

    const mergedSkills = dedupeTerms([
      ...parseCsvTerms(candidate.skillsCsv),
      ...inferred.skills,
    ]).slice(0, 40);

    const mergedCertifications = dedupeTerms([
      ...parseCsvTerms(candidate.certificationsCsv),
      ...inferred.certifications,
    ]).slice(0, 30);

    let mergedRoles = dedupeTerms([
      ...parseCsvTerms(candidate.suggestedRolesCsv),
      ...inferred.suggestedRoles,
    ]).slice(0, 20);

    if (!previewOnly && mergedRoles.length === 0 && mergedSkills.length > 0) {
      try {
        const inferredRoles =
          await inferSuggestedRolesFromSkillsAndCertifications({
            skillsCsv: mergedSkills.join(", "),
            certificationsCsv: mergedCertifications.join(", "),
            fastMode: true,
          });
        mergedRoles = dedupeTerms(inferredRoles).slice(0, 20);
      } catch {
        // Keep role regeneration best effort.
      }
    }

    const proposed = {
      id: candidate.id,
      fullName: candidate.fullName,
      email: inferred.email ?? candidate.email ?? null,
      phone: inferred.phone ?? candidate.phone ?? null,
      skillsCsv: mergedSkills.join(", "),
      certificationsCsv: mergedCertifications.join(", "),
      suggestedRolesCsv: mergedRoles.join(", "),
      rawCV: candidate.rawCV,
    };

    const updated = previewOnly
      ? proposed
      : await prisma.candidate.update({
          where: { id: candidate.id },
          data: {
            email: proposed.email,
            phone: proposed.phone,
            skillsCsv: proposed.skillsCsv,
            certificationsCsv: proposed.certificationsCsv,
            suggestedRolesCsv: proposed.suggestedRolesCsv,
          },
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            skillsCsv: true,
            certificationsCsv: true,
            suggestedRolesCsv: true,
            rawCV: true,
          },
        });

    const after = matchCvAgainstAts({
      cvText: updated.rawCV,
      jobText,
      candidateEmail: updated.email,
      candidatePhone: updated.phone,
      skillsCsv: updated.skillsCsv,
      certificationsCsv: updated.certificationsCsv,
      suggestedRolesCsv: updated.suggestedRolesCsv,
    });

    return jsonOk({
      candidate: {
        id: updated.id,
        fullName: updated.fullName,
        email: updated.email,
        phone: updated.phone,
        skillsCsv: updated.skillsCsv,
        certificationsCsv: updated.certificationsCsv,
        suggestedRolesCsv: updated.suggestedRolesCsv,
      },
      job: {
        id: jobId,
        title: jobTitle,
      },
      previewOnly,
      proposed: {
        email: proposed.email,
        phone: proposed.phone,
        skillsCsv: proposed.skillsCsv,
        certificationsCsv: proposed.certificationsCsv,
        suggestedRolesCsv: proposed.suggestedRolesCsv,
      },
      ai: {
        used: true,
      },
      before,
      after,
      summary: {
        scoreDelta: after.score - before.score,
        decisionChanged: before.decision !== after.decision,
      },
    });
  } catch {
    return jsonError("Unable to run AI ATS fix", 400, {
      hint: "Ensure LiteLLM is configured to run AI fixes.",
    });
  }
}
