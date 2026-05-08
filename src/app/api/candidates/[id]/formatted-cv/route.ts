import fs from "fs";
import path from "path";

import { jsonError, jsonOk } from "@/lib/apiResponses";
import {
    formatCvForAtsWithFallback,
    renderFormattedCvText,
} from "@/lib/cvFormatter";
import { buildFormattedCvPdf } from "@/lib/pdfRedaction";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/candidates/:id/formatted-cv
 * Download the pre-formatted ATS PDF for a candidate.
 */
export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id } = await context.params;

    const candidate = await prisma.candidate.findFirst({
      where: { id, tenantId: scope.tenantId, ...getOwnerFilter(scope) },
      select: {
        fullName: true,
        formattedCvPdfData: true,
        formattedCvFileName: true,
        formattedCvGeneratedAt: true,
      },
    });

    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    if (!candidate.formattedCvPdfData) {
      return jsonError(
        "Formatted CV not yet generated for this candidate.",
        404,
        {
          hint: "POST to this endpoint to trigger generation, or re-upload the CV.",
        },
      );
    }

    const fileName =
      candidate.formattedCvFileName?.trim() ||
      `${candidate.fullName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40)}-formatted.pdf`;

    return new NextResponse(candidate.formattedCvPdfData, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    }) as unknown as NextResponse;
  } catch (error) {
    console.error("[FORMATTED_CV_GET]", error);
    return jsonError("Failed to retrieve formatted CV", 500);
  }
}

/**
 * POST /api/candidates/:id/formatted-cv
 * Trigger (re)generation of the formatted CV for a candidate.
 * Returns { ok: true, formattedCvFileName, generatedAt } on success.
 */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id } = await context.params;

    const candidate = await prisma.candidate.findFirst({
      where: { id, tenantId: scope.tenantId, ...getOwnerFilter(scope) },
      select: {
        id: true,
        fullName: true,
        rawCV: true,
        skillsCsv: true,
        certificationsCsv: true,
        suggestedRolesCsv: true,
      },
    });

    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    if (!candidate.rawCV?.trim()) {
      return jsonError("No CV text stored for this candidate.", 400);
    }

    const sections = await formatCvForAtsWithFallback({
      rawCvText: candidate.rawCV,
      candidateName: candidate.fullName,
      skillsCsv: candidate.skillsCsv ?? "",
      certificationsCsv: candidate.certificationsCsv ?? "",
      suggestedRolesCsv: candidate.suggestedRolesCsv ?? "",
    });

    const formattedText = renderFormattedCvText(sections);
    const pdfBuffer = await buildFormattedCvPdf(sections);

    const safeNameSlug = candidate.fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    const formattedCvFileName = `${safeNameSlug}-formatted.pdf`;

    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        formattedCvText: formattedText,
        formattedCvPdfData: new Uint8Array(pdfBuffer),
        formattedCvFileName,
        formattedCvGeneratedAt: new Date(),
      },
    });

    // Write branded PDF to disk so it is available in cv/<name>/ immediately.
    try {
      const cvRoot = path.join(process.cwd(), "cv");
      const candidateDir = path.join(cvRoot, safeNameSlug);
      const diskPdfPath = path.join(candidateDir, `${safeNameSlug}.pdf`);
      fs.mkdirSync(candidateDir, { recursive: true });
      fs.writeFileSync(diskPdfPath, pdfBuffer);
      console.log("[FORMATTED_CV_POST] PDF written to disk", { diskPdfPath });
    } catch (diskErr) {
      console.warn("[FORMATTED_CV_POST] Disk write failed (non-fatal)", {
        candidateId: candidate.id,
        message: (diskErr as Error).message,
      });
    }

    return jsonOk({
      formattedCvFileName,
      generatedAt: new Date().toISOString(),
      textLength: formattedText.length,
      pdfBytes: pdfBuffer.byteLength,
    });
  } catch (error) {
    console.error("[FORMATTED_CV_POST]", error);
    const message =
      (error as Error)?.message ?? "Failed to generate formatted CV";
    return jsonError(message, 500);
  }
}
