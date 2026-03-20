import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { placementContractUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

const MAX_CONTRACT_BYTES = 10 * 1024 * 1024;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const { id } = await context.params;
    const application = await prisma.application.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        currentStage: true,
        placedAt: true,
        agreedHourlyRate: true,
        agreedRateLockedAt: true,
        signedContractFileName: true,
        signedContractMimeType: true,
        signedContractUploadedAt: true,
      },
    });

    if (!application) {
      return jsonError("Application not found", 404);
    }

    return jsonOk({
      ...application,
      placementRequirementsComplete:
        application.currentStage !== "PLACED" ||
        (application.agreedHourlyRate !== null &&
          application.signedContractUploadedAt !== null),
    });
  } catch (error) {
    return jsonError("Unable to load placement metadata", 400, {
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
    const formData = await request.formData();

    const application = await prisma.application.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        currentStage: true,
        agreedHourlyRate: true,
        agreedRateLockedAt: true,
        signedContractUploadedAt: true,
      },
    });

    if (!application) {
      return jsonError("Application not found", 404);
    }

    const rawRate = formData.get("agreedHourlyRate");
    const file = formData.get("file");
    const actorValue = formData.get("actor");
    const actor =
      typeof actorValue === "string" && actorValue.trim().length > 0
        ? actorValue.trim()
        : "application_board";

    const parsedRate =
      typeof rawRate === "string" && rawRate.trim().length > 0
        ? Number(rawRate)
        : undefined;

    const ratePayload = placementContractUpdateSchema.parse({
      agreedHourlyRate: parsedRate,
    });

    if (
      application.agreedHourlyRate !== null &&
      ratePayload.agreedHourlyRate !== undefined &&
      Number(application.agreedHourlyRate.toFixed(4)) !==
        Number(ratePayload.agreedHourlyRate.toFixed(4))
    ) {
      return jsonError(
        "Agreed hourly rate is locked and cannot be changed",
        400,
      );
    }

    const uploadedFile = file instanceof File ? file : null;
    let signedContractData: Uint8Array<ArrayBuffer> | undefined;

    if (uploadedFile) {
      const bytes = await uploadedFile.arrayBuffer();
      if (bytes.byteLength > MAX_CONTRACT_BYTES) {
        return jsonError("Signed contract file exceeds 10MB limit", 400);
      }

      signedContractData = new Uint8Array(bytes);
    }

    if (!uploadedFile && application.signedContractUploadedAt === null) {
      return jsonError("Signed contract upload is required", 400);
    }

    if (
      application.agreedHourlyRate === null &&
      ratePayload.agreedHourlyRate === undefined
    ) {
      return jsonError("Agreed hourly rate is required", 400);
    }

    const now = new Date();
    const updateData = {
      agreedHourlyRate:
        application.agreedHourlyRate ??
        ratePayload.agreedHourlyRate ??
        undefined,
      agreedRateLockedAt:
        application.agreedRateLockedAt ??
        (ratePayload.agreedHourlyRate !== undefined ? now : undefined),
      signedContractFileName: uploadedFile ? uploadedFile.name : undefined,
      signedContractMimeType: uploadedFile
        ? uploadedFile.type || "application/octet-stream"
        : undefined,
      signedContractData,
      signedContractUploadedAt: uploadedFile
        ? now
        : (application.signedContractUploadedAt ?? undefined),
      placedAt: application.currentStage === "PLACED" ? now : undefined,
    };

    const updated = await prisma.application.update({
      where: { id: application.id, tenantId },
      data: updateData,
      select: {
        id: true,
        currentStage: true,
        placedAt: true,
        agreedHourlyRate: true,
        agreedRateLockedAt: true,
        signedContractFileName: true,
        signedContractMimeType: true,
        signedContractUploadedAt: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        actor,
        entityType: "application",
        entityId: application.id,
        action: "placement_contract_set",
        afterJson: {
          agreedHourlyRate: updated.agreedHourlyRate,
          signedContractFileName: updated.signedContractFileName,
          signedContractUploadedAt:
            updated.signedContractUploadedAt?.toISOString() ?? null,
        },
      },
    });

    return jsonOk({
      ...updated,
      placementRequirementsComplete:
        updated.currentStage !== "PLACED" ||
        (updated.agreedHourlyRate !== null &&
          updated.signedContractUploadedAt !== null),
    });
  } catch (error) {
    return jsonError("Unable to save placement contract data", 400, {
      message: (error as Error).message,
    });
  }
}
