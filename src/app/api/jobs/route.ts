import { jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const scope = resolveTenantAccessScope(request);
  const jobs = await prisma.job.findMany({
    where: {
      tenantId: scope.tenantId,
      ...getOwnerFilter(scope),
    },
    orderBy: { createdAt: "desc" },
  });
  return jsonOk(jobs);
}
