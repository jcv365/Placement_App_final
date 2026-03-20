import { jsonError, jsonOk } from "@/lib/apiResponses";
import { sendAgreementForSignature } from "@/lib/docusign";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { candidateAgreementSendSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const { id } = await context.params;

    const agreements = await prisma.candidateAgreement.findMany({
      where: { candidateId: id, tenantId },
      orderBy: { createdAt: "desc" },
    });

    return jsonOk(agreements);
  } catch (error) {
    return jsonError("Unable to load candidate agreements", 400, {
      message: (error as Error).message,
    });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const { id } = await context.params;
    const body = candidateAgreementSendSchema.parse(await request.json());

    const candidate = await prisma.candidate.findFirst({
      where: { id, tenantId },
    });

    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    if (!candidate.email?.trim()) {
      return jsonError("Candidate email is required to send agreement", 400);
    }

    const sendResult = await sendAgreementForSignature({
      agreementType: body.type,
      candidateName: body.recipientName?.trim() || candidate.fullName,
      candidateEmail: body.recipientEmail?.trim() || candidate.email,
      candidateId: candidate.id,
    });

    const agreement = await prisma.candidateAgreement.upsert({
      where: {
        tenantId_candidateId_type: {
          tenantId,
          candidateId: candidate.id,
          type: body.type,
        },
      },
      update: {
        tenantId,
        status: "SENT",
        envelopeId: sendResult.envelopeId,
        sentAt: new Date(),
        externalStatus: `sent_via_${sendResult.provider}`,
      },
      create: {
        tenantId,
        candidateId: candidate.id,
        type: body.type,
        status: "SENT",
        envelopeId: sendResult.envelopeId,
        sentAt: new Date(),
        externalStatus: `sent_via_${sendResult.provider}`,
      },
    });

    return jsonOk(agreement, { status: 201 });
  } catch (error) {
    return jsonError("Unable to send agreement", 400, {
      message: (error as Error).message,
    });
  }
}
