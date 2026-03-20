import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { tenantId } = requireAdminContextFromRequest(request);

    const logs = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return jsonOk(logs);
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to load audit logs", 400, {
      message: (error as Error).message,
    });
  }
}
