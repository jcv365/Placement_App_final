import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { generateMonthlyReportForCompany } from "@/lib/financeReports";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { tenantId } = requireAdminContextFromRequest(request);

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId")?.trim();

    const reports = await prisma.monthlyFinanceReport.findMany({
      where: {
        companyId: companyId || undefined,
        company: {
          tenantId,
        },
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ generatedAt: "desc" }],
      take: 100,
    });

    return jsonOk(reports);
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to load reports", 400);
  }
}

export async function POST(request: Request) {
  try {
    const { username: actor, tenantId } =
      requireAdminContextFromRequest(request);
    const body = z
      .object({ companyId: z.string().trim().min(1) })
      .parse(await request.json());

    if (!body.companyId?.trim()) {
      return jsonError("companyId is required", 400);
    }

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

    const report = await generateMonthlyReportForCompany({
      companyId: body.companyId,
      tenantId,
      actor,
    });

    return jsonOk(report, { status: 201 });
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }
    if (error instanceof z.ZodError) {
      return jsonError("Invalid request body", 400);
    }
    console.error("[REPORTS_POST]", error);
    return jsonError("Unable to generate report", 400);
  }
}
