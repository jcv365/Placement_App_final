import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { ensureCompanySettings } from "@/lib/financeReports";
import { prisma } from "@/lib/prisma";
import { companyLogoUploadSchema } from "@/lib/validation";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Verifies the first few bytes of the file match known image signatures.
 * Returns the detected MIME type or null if not a recognised image.
 */
function detectImageMime(header: Uint8Array): string | null {
  if (
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47
  ) {
    return "image/png";
  }
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    header[0] === 0x47 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x38 &&
    (header[4] === 0x37 || header[4] === 0x39)
  ) {
    return "image/gif";
  }
  if (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

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

    if (file.size > MAX_LOGO_BYTES) {
      return jsonError("Logo file must be under 5 MB", 400);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const detectedMime = detectImageMime(
      new Uint8Array(
        bytes.buffer,
        bytes.byteOffset,
        Math.min(bytes.length, 12),
      ),
    );

    if (!detectedMime) {
      return jsonError(
        "Only PNG, JPEG, GIF, and WebP images are supported. SVG and other formats are not allowed.",
        400,
      );
    }

    const logoUrl = `data:${detectedMime};base64,${bytes.toString("base64")}`;

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

    return jsonError("Unable to upload company logo", 400);
  }
}
