import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/jpeg",
  "image/png",
]);

/** Upload a criminal record check document */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id } = await context.params;

    const candidate = await prisma.candidate.findFirst({
      where: { id, tenantId: scope.tenantId, ...getOwnerFilter(scope) },
      select: { id: true },
    });

    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return jsonError("A file must be provided", 400);
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError(
        `File exceeds maximum size of ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
        400,
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return jsonError("Only PDF, Word, JPEG or PNG files are accepted", 400);
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        criminalRecordFileName: file.name,
        criminalRecordMimeType: file.type,
        criminalRecordFileData: bytes,
        criminalRecordUploadedAt: new Date(),
      },
    });

    return jsonOk({ uploaded: true, fileName: file.name });
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[CRIMINAL_RECORD_UPLOAD]", error);
    return jsonError("Unable to upload criminal record check", 500);
  }
}

/** Download the stored criminal record check document */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id } = await context.params;

    const candidate = await prisma.candidate.findFirst({
      where: { id, tenantId: scope.tenantId, ...getOwnerFilter(scope) },
      select: {
        criminalRecordFileName: true,
        criminalRecordMimeType: true,
        criminalRecordFileData: true,
      },
    });

    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    if (!candidate.criminalRecordFileData) {
      return jsonError("No criminal record check on file", 404);
    }

    const fileName =
      candidate.criminalRecordFileName ?? "criminal-record-check";
    const mimeType =
      candidate.criminalRecordMimeType ?? "application/octet-stream";

    return new Response(candidate.criminalRecordFileData, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[CRIMINAL_RECORD_DOWNLOAD]", error);
    return jsonError("Unable to download criminal record check", 500);
  }
}

/** Remove the criminal record check document */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id } = await context.params;

    const candidate = await prisma.candidate.findFirst({
      where: { id, tenantId: scope.tenantId, ...getOwnerFilter(scope) },
      select: { id: true },
    });

    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    await prisma.candidate.updateMany({
      where: { id: candidate.id, tenantId: scope.tenantId },
      data: {
        criminalRecordFileName: null,
        criminalRecordMimeType: null,
        criminalRecordFileData: null,
        criminalRecordUploadedAt: null,
      },
    });

    return jsonOk({ deleted: true });
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[CRIMINAL_RECORD_DELETE]", error);
    return jsonError("Unable to delete criminal record check", 500);
  }
}
