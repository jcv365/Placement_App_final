import { jsonOk } from "@/lib/apiResponses";
import { parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { resolveTenantAccessScope } from "@/lib/tenantAccess";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

/**
 * GET /api/email/log
 *
 * Returns paginated email drafts with candidate and job info.
 *
 * Query params:
 *   date         – YYYY-MM-DD (default: today UTC)
 *   candidateName – partial match on candidate full name
 *   page, pageSize – pagination (default pageSize 50)
 */
export async function GET(request: Request) {
  const scope = resolveTenantAccessScope(request);
  const { searchParams } = new URL(request.url);

  const dateParam = searchParams.get("date")?.trim();
  const candidateName = searchParams.get("candidateName")?.trim();

  const where: Prisma.EmailDraftWhereInput = {
    tenantId: scope.tenantId,
  };

  // Only apply date filter when a valid date is provided
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    where.createdAt = {
      gte: new Date(`${dateParam}T00:00:00.000Z`),
      lte: new Date(`${dateParam}T23:59:59.999Z`),
    };
  }

  if (candidateName) {
    where.application = {
      candidate: {
        fullName: { contains: candidateName },
      },
    };
  }

  const pagination = parsePagination(searchParams);
  const take = pagination?.take ?? 200;
  const skip = pagination?.skip ?? 0;

  const [rawItems, total] = await Promise.all([
    prisma.emailDraft.findMany({
      where,
      include: {
        application: {
          include: {
            candidate: {
              select: { id: true, fullName: true, email: true },
            },
            job: {
              select: {
                id: true,
                title: true,
                opportunityEmail: true,
                company: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    }),
    prisma.emailDraft.count({ where }),
  ]);

  const items = rawItems.map((d) => ({
    id: d.id,
    subject: d.subject,
    createdAt: d.createdAt.toISOString(),
    applicationId: d.applicationId,
    preferredForLearning: d.preferredForLearning,
    candidate: d.application.candidate,
    job: {
      id: d.application.job.id,
      title: d.application.job.title,
      opportunityEmail: d.application.job.opportunityEmail,
      company: d.application.job.company,
    },
  }));

  return jsonOk({
    items,
    total,
    page: pagination?.page ?? 1,
    pageSize: pagination?.pageSize ?? 200,
  });
}
