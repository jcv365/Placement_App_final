import { jsonOk } from "@/lib/apiResponses";
import { parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const scope = resolveTenantAccessScope(request);
  const { searchParams } = new URL(request.url);
  const pagination = parsePagination(searchParams);

  const contactableOnly = searchParams.get("contactable") === "true";

  const where = {
    tenantId: scope.tenantId,
    ...getOwnerFilter(scope),
    ...(contactableOnly
      ? { opportunityEmail: { not: null }, NOT: { opportunityEmail: "" } }
      : {}),
  };

  const jobs = await prisma.job.findMany({
    where,
    include: { company: true },
    orderBy: { createdAt: "desc" },
    ...(pagination ? { take: pagination.take, skip: pagination.skip } : {}),
  });

  // Truncate rawText to 4 000 chars for the list response.
  // Full raw text is available via GET /api/jobs/[id] when an individual job is needed.
  const trimmed = jobs.map((job) => ({
    ...job,
    rawText:
      job.rawText.length > 4000 ? job.rawText.slice(0, 4000) : job.rawText,
  }));

  if (pagination) {
    const total = await prisma.job.count({ where });
    return jsonOk({
      items: trimmed,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    });
  }

  return jsonOk(trimmed);
}
