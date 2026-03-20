import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { ensureCompanySettings } from "@/lib/financeReports";
import { prisma } from "@/lib/prisma";
import { companyLogoUploadSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { username: actor, tenantId } =
      requireAdminContextFromRequest(request);
    const formData = await request.formData();

    const body = companyLogoUploadSchema.parse({
      companyId: formData.get("companyId"),
    });

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return jsonError("Logo file is required", 400);
    }

    const mimeType = file.type || "image/png";
    if (!mimeType.startsWith("image/")) {
      return jsonError("Only image files are supported", 400);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const logoUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;

    const company = await prisma.company.findFirst({
      where: {
        id: body.companyId,
        tenantId,
      },
      select: { id: true },
    });

    if (!company) {
      return jsonError("Company not found", 404);
    }

    const previous = await ensureCompanySettings(body.companyId, tenantId);

    const settings = await prisma.companySettings.upsert({
      where: { companyId: body.companyId },
      create: {
        companyId: body.companyId,
        logoUrl,
      },
      update: {
        logoUrl,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        actor,
        entityType: "company_settings",
        entityId: settings.id,
        action: "logo_updated",
        beforeJson: { logoUrl: previous.logoUrl },
        afterJson: { logoUrl: settings.logoUrl },
      },
    });

    return jsonOk({
      companyId: body.companyId,
      logoUrl: settings.logoUrl,
    });
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to upload company logo", 400, {
      message: (error as Error).message,
    });
  }
}
