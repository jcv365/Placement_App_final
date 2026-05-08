import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { docusignWebhookSchema } from "@/lib/validation";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";

function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.DOCUSIGN_HMAC_SECRET;
  if (!secret) return true; // HMAC not configured — skip verification
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  try {
    return timingSafeEqual(
      Buffer.from(signatureHeader, "base64"),
      Buffer.from(expected, "base64"),
    );
  } catch {
    return false;
  }
}

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
    const rawBody = await request.text();
    const signature = request.headers.get("x-docusign-signature-1");

    if (!verifyHmacSignature(rawBody, signature)) {
      console.error("[DOCUSIGN_WEBHOOK] HMAC signature verification failed");
      return jsonError("Invalid signature", 401);
    }

    const body = docusignWebhookSchema.parse(JSON.parse(rawBody));
    const tenantId = body.tenantId?.trim().toLowerCase();

    if (!tenantId) {
      return jsonError("tenantId is required", 400);
    }

    const agreement = await prisma.candidateAgreement.findFirst({
      where: {
        envelopeId: body.envelopeId,
        tenantId,
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
    console.error("[DOCUSIGN_WEBHOOK]", error);
    return jsonError("Unable to process DocuSign webhook", 400);
  }
}
