import { jsonOk } from "@/lib/apiResponses";
import { parsePagination } from "@/lib/pagination";
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
  const { searchParams } = new URL(request.url);
  const pagination = parsePagination(searchParams);
  // slim=true: skip rawCV, vettingNotes, and agreements — used by match review
  const slim = searchParams.get("slim") === "true";

  const where = {
    tenantId: scope.tenantId,
    ...getOwnerFilter(scope),
  };

  if (slim) {
    const candidates = await prisma.candidate.findMany({
      where,
      select: {
        id: true,
        tenantId: true,
        ownerUserId: true,
        fullName: true,
        email: true,
        phone: true,
        skillsCsv: true,
        certificationsCsv: true,
        suggestedRolesCsv: true,
        preferredRolesCsv: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      ...(pagination ? { take: pagination.take, skip: pagination.skip } : {}),
    });

    if (pagination) {
      const total = await prisma.candidate.count({ where });
      return jsonOk({
        items: candidates,
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
      });
    }
    return jsonOk(candidates);
  }

  const candidates = await prisma.candidate.findMany({
    where,
    select: {
      id: true,
      tenantId: true,
      ownerUserId: true,
      fullName: true,
      cvStorageMode: true,
      cvFileName: true,
      cvMimeType: true,
      cvUploadedAt: true,
      email: true,
      phone: true,
      skillsCsv: true,
      certificationsCsv: true,
      suggestedRolesCsv: true,
      preferredRolesCsv: true,
      vettingStatus: true,
      vettedAt: true,
      vettingNotes: true,
      criminalRecordFileName: true,
      criminalRecordUploadedAt: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
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
    ...(pagination ? { take: pagination.take, skip: pagination.skip } : {}),
  });

  const mapped = candidates.map((candidate) => {
    const status = resolveCandidateStatus(candidate);
    const { applications, ...candidateWithoutApplications } = candidate;
    return {
      ...candidateWithoutApplications,
      status,
      isActive: status === "ACTIVE",
    };
  });

  if (pagination) {
    const total = await prisma.candidate.count({ where });
    return jsonOk({
      items: mapped,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    });
  }

  return jsonOk(mapped);
}
