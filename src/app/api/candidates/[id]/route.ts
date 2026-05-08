import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";
import { candidateUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id } = await context.params;
    const body = await request.json();
    const parsed = candidateUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(
        "Invalid candidate update payload",
        400,
        parsed.error.issues,
      );
    }

    const candidate = await prisma.candidate.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        ...getOwnerFilter(scope),
      },
      select: { id: true },
    });

    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    if (parsed.data.status === "PLACED") {
      return jsonError(
        "Placed status is assigned automatically from placed opportunities",
        400,
      );
    }

    await prisma.candidate.updateMany({
      where: { id: candidate.id, tenantId: scope.tenantId },
      data: {
        fullName: parsed.data.fullName,
        email: parsed.data.email.trim() ? parsed.data.email : null,
        phone: parsed.data.phone.trim() ? parsed.data.phone : null,
        skillsCsv: parsed.data.skillsCsv,
        certificationsCsv: parsed.data.certificationsCsv,
        suggestedRolesCsv: parsed.data.suggestedRolesCsv,
        preferredRolesCsv: parsed.data.preferredRolesCsv ?? "",
        selfReportedHourlyRate: parsed.data.selfReportedHourlyRate ?? undefined,
        isActive: parsed.data.status === "ACTIVE",
      },
    });

    const updatedCandidate = await prisma.candidate.findFirst({
      where: { id: candidate.id, tenantId: scope.tenantId },
    });

    return jsonOk(updatedCandidate);
  } catch (error) {
    console.error("[CANDIDATE_PATCH]", error);
    return jsonError("Unable to update candidate", 400);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id } = await context.params;

    const result = await prisma.candidate.deleteMany({
      where: {
        id,
        tenantId: scope.tenantId,
        ...getOwnerFilter(scope),
      },
    });

    if (result.count === 0) {
      return jsonError("Candidate not found or could not be deleted", 404);
    }

    return jsonOk({ deleted: true });
  } catch (error) {
    console.error("[CANDIDATE_DELETE]", error);
    return jsonError("Unable to delete candidate", 400);
  }
}
