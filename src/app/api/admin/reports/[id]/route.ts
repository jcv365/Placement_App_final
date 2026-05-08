import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { tenantId } = requireAdminContextFromRequest(request);
    const { id } = await context.params;

    const report = await prisma.monthlyFinanceReport.findFirst({
      where: {
        id,
        company: {
          tenantId,
        },
      },
      select: {
        id: true,
        fileName: true,
        csvContent: true,
      },
    });

    if (!report) {
      return jsonError("Report not found", 404);
    }

    return new NextResponse(report.csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${report.fileName}\"`,
      },
    });
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to download report", 400);
  }
}
