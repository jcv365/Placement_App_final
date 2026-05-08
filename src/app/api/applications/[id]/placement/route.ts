import { handleAuthError, jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import {
  requireAuthenticatedTenantId,
  resolveTenantIdFromRequest,
} from "@/lib/tenant";
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
        placementBillingModel: true,
        placementFeePercent: true,
        annualCtc: true,
        contractValue: true,
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
          application.placementBillingModel !== null &&
          application.signedContractUploadedAt !== null),
    });
  } catch (error) {
    console.error("[PLACEMENT_GET]", error);
    return jsonError("Unable to load placement metadata", 400);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const { id } = await context.params;
    const formData = await request.formData();

    const application = await prisma.application.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        currentStage: true,
        agreedHourlyRate: true,
        agreedRateLockedAt: true,
        placementBillingModel: true,
        placementFeePercent: true,
        annualCtc: true,
        contractValue: true,
        signedContractUploadedAt: true,
      },
    });

    if (!application) {
      return jsonError("Application not found", 404);
    }

    const rawRate = formData.get("agreedHourlyRate");
    const rawBillingModel = formData.get("placementBillingModel");
    const rawFeePercent = formData.get("placementFeePercent");
    const rawAnnualCtc = formData.get("annualCtc");
    const rawContractValue = formData.get("contractValue");
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
    const parsedFeePercent =
      typeof rawFeePercent === "string" && rawFeePercent.trim().length > 0
        ? Number(rawFeePercent)
        : undefined;
    const parsedAnnualCtc =
      typeof rawAnnualCtc === "string" && rawAnnualCtc.trim().length > 0
        ? Number(rawAnnualCtc)
        : undefined;
    const parsedContractValue =
      typeof rawContractValue === "string" && rawContractValue.trim().length > 0
        ? Number(rawContractValue)
        : undefined;

    if (parsedRate !== undefined && (isNaN(parsedRate) || parsedRate < 0)) {
      return jsonError("Agreed hourly rate must be a non-negative number", 400);
    }
    if (
      parsedFeePercent !== undefined &&
      (isNaN(parsedFeePercent) ||
        parsedFeePercent < 0 ||
        parsedFeePercent > 100)
    ) {
      return jsonError("Fee percentage must be between 0 and 100", 400);
    }
    if (
      parsedAnnualCtc !== undefined &&
      (isNaN(parsedAnnualCtc) || parsedAnnualCtc < 0)
    ) {
      return jsonError("Annual CTC must be a non-negative number", 400);
    }
    if (
      parsedContractValue !== undefined &&
      (isNaN(parsedContractValue) || parsedContractValue < 0)
    ) {
      return jsonError("Contract value must be a non-negative number", 400);
    }

    const ratePayload = placementContractUpdateSchema.parse({
      agreedHourlyRate: parsedRate,
      placementBillingModel:
        typeof rawBillingModel === "string" && rawBillingModel.trim().length > 0
          ? rawBillingModel.trim()
          : undefined,
      placementFeePercent: parsedFeePercent,
      annualCtc: parsedAnnualCtc,
      contractValue: parsedContractValue,
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

    const billingModel =
      ratePayload.placementBillingModel ??
      application.placementBillingModel ??
      undefined;

    if (!billingModel) {
      return jsonError("Billing model is required for placements", 400);
    }

    if (
      billingModel === "ONCE_OFF_PLACEMENT_FEE" &&
      application.contractValue == null &&
      ratePayload.contractValue === undefined
    ) {
      return jsonError(
        "Contract value is required for once-off placement fee model",
        400,
      );
    }

    if (
      billingModel === "PERMANENT_PLACEMENT_FEE" &&
      application.annualCtc == null &&
      ratePayload.annualCtc === undefined
    ) {
      return jsonError(
        "Annual CTC is required for permanent placement fee model",
        400,
      );
    }

    if (
      ratePayload.placementFeePercent === undefined &&
      application.placementFeePercent == null
    ) {
      return jsonError("Fee percentage is required for placements", 400);
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
      placementBillingModel: billingModel,
      placementFeePercent:
        ratePayload.placementFeePercent ??
        application.placementFeePercent ??
        undefined,
      annualCtc: ratePayload.annualCtc ?? application.annualCtc ?? undefined,
      contractValue:
        ratePayload.contractValue ?? application.contractValue ?? undefined,
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
        placementBillingModel: true,
        placementFeePercent: true,
        annualCtc: true,
        contractValue: true,
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
          placementBillingModel: updated.placementBillingModel,
          placementFeePercent: updated.placementFeePercent,
          annualCtc: updated.annualCtc,
          contractValue: updated.contractValue,
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
          updated.placementBillingModel !== null &&
          updated.signedContractUploadedAt !== null),
    });
  } catch (error) {
    return (
      handleAuthError(error) ??
      jsonError("Unable to save placement contract data", 400)
    );
  }
}
