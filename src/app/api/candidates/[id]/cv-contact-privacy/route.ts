import { jsonError, jsonOk } from "@/lib/apiResponses";
import { redactCvContactDetails } from "@/lib/cvRedaction";
import { readTextFromFile } from "@/lib/documentText";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";
import { z } from "zod";

export const runtime = "nodejs";

type PrivacyMode = "FULL" | "REDACTED";

const privacyBodySchema = z
  .object({
    mode: z.enum(["FULL", "REDACTED"]).optional(),
  })
  .default({});

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id } = await context.params;

    const body = privacyBodySchema.parse(
      await request.json().catch(() => ({})),
    );

    const mode: PrivacyMode = body.mode === "FULL" ? "FULL" : "REDACTED";

    const candidate = await prisma.candidate.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        ...getOwnerFilter(scope),
      },
      select: {
        id: true,
        rawCV: true,
        cvFileData: true,
        cvFileName: true,
        cvMimeType: true,
        email: true,
        phone: true,
      },
    });

    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    let nextRawCv = candidate.rawCV;

    if (mode === "REDACTED") {
      nextRawCv = redactCvContactDetails({
        cvText: candidate.rawCV,
        email: candidate.email,
        phone: candidate.phone,
      });
    }

    if (mode === "FULL") {
      if (!candidate.cvFileData) {
        return jsonError(
          "Original CV file is unavailable, so full CV text cannot be restored.",
          400,
        );
      }

      const restoredText = await readTextFromFile({
        fileName: candidate.cvFileName ?? undefined,
        mimeType: candidate.cvMimeType ?? undefined,
        bytes: toArrayBuffer(candidate.cvFileData),
      });

      if (!restoredText) {
        return jsonError(
          "Could not restore full CV text from stored file.",
          400,
        );
      }

      nextRawCv = restoredText;
    }

    const updated = await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        rawCV: nextRawCv,
        cvStorageMode: mode,
      },
      select: {
        id: true,
      },
    });

    return jsonOk({
      id: updated.id,
      cvStorageMode: mode satisfies PrivacyMode,
      modeApplied: mode satisfies PrivacyMode,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError("Invalid request body", 400);
    }
    console.error("[CV_PRIVACY_UPDATE]", error);
    return jsonError("Unable to update CV contact privacy", 400);
  }
}
