import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { calculateMonthToDateProjection } from "@/lib/financeReports";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { tenantId } = requireAdminContextFromRequest(request);

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId")?.trim();

    if (!companyId) {
      return jsonError("companyId is required", 400);
    }

    const company = await prisma.company.findFirst({
      where: {
        id: companyId,
        tenantId,
      },
      select: { id: true, name: true },
    });

    if (!company) {
      return jsonError("Company not found", 404);
    }

    const projection = await calculateMonthToDateProjection(
      companyId,
      tenantId,
    );
    return jsonOk({
      company,
      projection,
    });
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to calculate month-to-date projection", 400, {
      message: (error as Error).message,
    });
  }
}
