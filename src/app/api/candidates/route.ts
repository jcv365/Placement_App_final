import { jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";

export const runtime = "nodejs";

function resolveCandidateStatus(candidate: {
  isActive: boolean;
  applications: Array<{ id: string }>;
}): "ACTIVE" | "NON_ACTIVE" | "PLACED" {
  if (candidate.applications.length > 0) {
    return "PLACED";
  }

  return candidate.isActive ? "ACTIVE" : "NON_ACTIVE";
}

export async function GET(request: Request) {
  const scope = resolveTenantAccessScope(request);
  const candidates = await prisma.candidate.findMany({
    where: {
      tenantId: scope.tenantId,
      ...getOwnerFilter(scope),
    },
    include: {
      agreements: {
        orderBy: { createdAt: "desc" },
      },
      applications: {
        where: { currentStage: "PLACED" },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonOk(
    candidates.map((candidate) => {
      const status = resolveCandidateStatus(candidate);
      const { applications, ...candidateWithoutApplications } = candidate;
      return {
        ...candidateWithoutApplications,
        status,
        isActive: status === "ACTIVE",
      };
    }),
  );
}
