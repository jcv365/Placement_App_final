import { jsonError, jsonOk } from "@/lib/apiResponses";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { getUploadProgress, sanitiseUploadId } from "@/lib/uploadProgress";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const url = new URL(request.url);
    const uploadId = sanitiseUploadId(url.searchParams.get("uploadId"));

    if (!uploadId) {
      return jsonError("uploadId is required", 400);
    }

    const progress = getUploadProgress(uploadId);
    if (!progress || progress.tenantId !== tenantId) {
      return jsonError("Upload progress not found", 404);
    }

    return jsonOk({
      status: progress.status,
      percent: progress.percent,
      message: progress.message,
      updatedAt: progress.updatedAt,
      summary: progress.summary ?? null,
    });
  } catch (error) {
    console.error("[UPLOAD_PROGRESS]", error);
    return jsonError("Failed to load upload progress", 500);
  }
}

export function POST() {
  return NextResponse.json(
    { ok: false, error: { message: "Method not allowed" } },
    { status: 405 },
  );
}
