import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { docusignWebhookSchema } from "@/lib/validation";

export const runtime = "nodejs";

async function refreshCandidateVetting(candidateId: string, tenantId: string) {
  const agreements = await prisma.candidateAgreement.findMany({
    where: { candidateId, tenantId },
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

  if (ndaComplete && teamingComplete) {
    await prisma.candidate.updateMany({
      where: { id: candidateId, tenantId },
      data: {
        vettingStatus: "PENDING_VETTING",
      },
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = docusignWebhookSchema.parse(await request.json());
    const tenantId = body.tenantId?.trim().toLowerCase();

    const agreement = await prisma.candidateAgreement.findFirst({
      where: {
        envelopeId: body.envelopeId,
        ...(tenantId ? { tenantId } : {}),
      },
      select: { id: true, candidateId: true, tenantId: true },
    });

    if (!agreement) {
      return jsonError("Agreement envelope not found", 404);
    }

    const status = body.status;

    await prisma.candidateAgreement.updateMany({
      where: { id: agreement.id, tenantId: agreement.tenantId },
      data: {
        status,
        externalStatus: body.externalStatus ?? status,
        lastWebhookAt: body.eventTime ? new Date(body.eventTime) : new Date(),
        signedAt: status === "COMPLETED" ? new Date() : undefined,
      },
    });

    if (status === "COMPLETED") {
      await refreshCandidateVetting(agreement.candidateId, agreement.tenantId);
    }

    const updated = await prisma.candidateAgreement.findFirst({
      where: { id: agreement.id, tenantId: agreement.tenantId },
    });

    return jsonOk(updated);
  } catch (error) {
    return jsonError("Unable to process DocuSign webhook", 400, {
      message: (error as Error).message,
    });
  }
}
