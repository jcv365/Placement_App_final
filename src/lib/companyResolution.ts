import { prisma } from "@/lib/prisma";

const ROLE_LIKE_TERMS = [
  "engineer",
  "developer",
  "architect",
  "consultant",
  "manager",
  "designer",
  "analyst",
  "specialist",
  "lead",
  "director",
  "administrator",
  "devops",
  "product",
  "full stack",
  "full-stack",
  "backend",
  "front end",
  "frontend",
  "solution",
  "domain",
  "enterprise",
  "ai",
  "ml",
  "data engineer",
  "cloud engineer",
  "technical architect",
];

const JOB_POSTING_TERMS = [
  "contract",
  "role",
  "remote",
  "outside ir35",
  "inside ir35",
  "day rate",
  "per day",
  "hiring",
  "vacancy",
  "opportunity",
  "required",
  "immediate start",
];

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function countWords(value: string): number {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function includesAnyTerm(haystack: string, terms: string[]): boolean {
  return terms.some((term) => haystack.includes(term));
}

export function cleanCompanyCandidate(
  value: string | undefined,
  maxLength = 120,
): string | undefined {
  const cleaned = collapseWhitespace(value ?? "");
  if (!cleaned) {
    return undefined;
  }

  return cleaned.length <= maxLength ? cleaned : cleaned.slice(0, maxLength);
}

export function isLikelyInvalidCompanyName(value: string): boolean {
  const cleaned = collapseWhitespace(value);
  const lower = cleaned.toLowerCase();
  const words = countWords(lower);

  if (!cleaned || words === 0) {
    return true;
  }

  if (cleaned.length > 90) {
    return true;
  }

  if (/[@]|https?:\/\//i.test(cleaned)) {
    return true;
  }

  if (/[\u00a3$€]\s?\d|\b\d+\s*(?:\/day|per\s+day|day)\b/i.test(cleaned)) {
    return true;
  }

  const roleLike = includesAnyTerm(lower, ROLE_LIKE_TERMS);
  const postingLike = includesAnyTerm(lower, JOB_POSTING_TERMS);
  const sentenceLike = /,|;|\(|\)|\//.test(cleaned) && words >= 6;

  if (roleLike && (postingLike || sentenceLike || words >= 7)) {
    return true;
  }

  return false;
}

async function findTenantDefaultCompany(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { tenantId },
    select: { displayName: true },
  });

  const displayName = collapseWhitespace(tenant?.displayName ?? "");
  if (displayName) {
    const byDisplayName = await prisma.company.findFirst({
      where: {
        tenantId,
        name: displayName,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (byDisplayName) {
      return byDisplayName;
    }
  }

  return prisma.company.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
    },
  });
}

export async function resolveCompanyForTenant(
  tenantId: string,
  proposedCompanyName: string | undefined,
): Promise<{
  companyId: string | undefined;
  companyName: string | undefined;
  usedFallback: boolean;
}> {
  const cleanedCandidate = cleanCompanyCandidate(proposedCompanyName);
  const validCandidate =
    cleanedCandidate && !isLikelyInvalidCompanyName(cleanedCandidate)
      ? cleanedCandidate
      : undefined;

  if (validCandidate) {
    const existing = await prisma.company.findFirst({
      where: {
        tenantId,
        name: validCandidate,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (existing) {
      return {
        companyId: existing.id,
        companyName: existing.name,
        usedFallback: false,
      };
    }

    const created = await prisma.company.create({
      data: {
        tenantId,
        name: validCandidate,
      },
      select: {
        id: true,
        name: true,
      },
    });

    return {
      companyId: created.id,
      companyName: created.name,
      usedFallback: false,
    };
  }

  const fallback = await findTenantDefaultCompany(tenantId);
  return {
    companyId: fallback?.id,
    companyName: fallback?.name,
    usedFallback: true,
  };
}
