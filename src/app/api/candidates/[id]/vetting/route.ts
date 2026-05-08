import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { requireAuthenticatedTenantId } from "@/lib/tenant";
import { candidateVettingUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const { id } = await context.params;
    const body = candidateVettingUpdateSchema.parse(await request.json());

    const existingCandidate = await prisma.candidate.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!existingCandidate) {
      return jsonError("Candidate not found", 404);
    }

    if (body.status === "VETTED") {
      const agreements = await prisma.candidateAgreement.findMany({
        where: { candidateId: id, tenantId },
        select: { type: true, status: true },
      });

      const ndaComplete = agreements.some(
        (agreement: { type: string; status: string }) =>
          agreement.type === "NDA" && agreement.status === "COMPLETED",
      );
      const teamingComplete = agreements.some(
        (agreement: { type: string; status: string }) =>
          agreement.type === "TEAMING_AGREEMENT" &&
          agreement.status === "COMPLETED",
      );

      if (!ndaComplete || !teamingComplete) {
        return jsonError(
          "Candidate cannot be marked vetted before NDA and teaming agreement are completed",
          400,
        );
      }
    }

    await prisma.candidate.updateMany({
      where: { id: existingCandidate.id, tenantId },
      data: {
        vettingStatus: body.status,
        vettedAt: body.status === "VETTED" ? new Date() : null,
        vettingNotes:
          body.notes === undefined
            ? undefined
            : body.notes.trim()
              ? body.notes.trim()
              : null,
      },
    });

    const candidate = await prisma.candidate.findFirst({
      where: { id: existingCandidate.id, tenantId },
    });

    return jsonOk(candidate);
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[CANDIDATE_VETTING_UPDATE]", error);
    return jsonError("Unable to update candidate vetting", 400);
  }
}
