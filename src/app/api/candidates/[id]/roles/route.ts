import { jsonError, jsonOk } from "@/lib/apiResponses";
import { inferSuggestedRolesFromSkillsAndCertifications } from "@/lib/candidateProfile";
import { prisma } from "@/lib/prisma";
import { requireAuthenticatedTenantId } from "@/lib/tenant";
import { z } from "zod";

export const runtime = "nodejs";

const rolesBodySchema = z
  .object({
    skillsCsv: z.string().optional(),
    certificationsCsv: z.string().optional(),
  })
  .default({});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const { id } = await context.params;
    const body = rolesBodySchema.parse(await request.json().catch(() => ({})));

    const candidate = await prisma.candidate.findFirst({
      where: { id, tenantId },
    });
    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    const skillsCsv =
      typeof body.skillsCsv === "string" ? body.skillsCsv : candidate.skillsCsv;
    const certificationsCsv =
      typeof body.certificationsCsv === "string"
        ? body.certificationsCsv
        : candidate.certificationsCsv;

    const suggestedRoles = await inferSuggestedRolesFromSkillsAndCertifications(
      {
        skillsCsv,
        certificationsCsv,
      },
    );

    await prisma.candidate.updateMany({
      where: { id: candidate.id, tenantId },
      data: {
        skillsCsv,
        certificationsCsv,
        suggestedRolesCsv: suggestedRoles.join(", "),
      },
    });

    const updatedCandidate = await prisma.candidate.findFirst({
      where: { id: candidate.id, tenantId },
    });

    if (!updatedCandidate) {
      return jsonError("Candidate not found", 404);
    }

    return jsonOk({
      id: updatedCandidate.id,
      suggestedRolesCsv: updatedCandidate.suggestedRolesCsv,
      suggestedRoles,
    });
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    if (error instanceof z.ZodError) {
      return jsonError("Invalid request body", 400);
    }
    console.error("[CANDIDATE_ROLES]", error);
    return jsonError("Unable to regenerate suggested roles", 400, {
      hint: "Ensure LiteLLM is configured and skills/certifications are filled in.",
    });
  }
}
