import { generateStructuredJson } from "@/lib/aiJson";
import { prisma } from "@/lib/prisma";

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function countWords(value: string): number {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
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

/**
 * Fast heuristic checks with zero false positives — no AI call needed.
 * Returns true if the value is definitely not a company name.
 */
function isDefinitelyInvalidCompanyName(value: string): boolean {
  const cleaned = collapseWhitespace(value);
  const words = countWords(cleaned);

  if (!cleaned || words === 0) return true;
  if (cleaned.length > 90) return true;
  if (/[@]|https?:\/\//i.test(cleaned)) return true;
  if (/[\u00a3$€]\s?\d|\b\d+\s*(?:\/day|per\s+day|day)\b/i.test(cleaned))
    return true;
  return false;
}

type CompanyNameCheck = { isCompanyName: boolean };

// In-process cache: avoids repeated AI calls for the same company name string.
// Entries are trimmed once the cache exceeds the cap to prevent unbounded growth.
const AI_VALIDATION_CACHE = new Map<string, boolean>();
const AI_VALIDATION_CACHE_MAX = 500;

/**
 * AI-backed check: returns true when the string looks like a job posting
 * snippet, role title, or other non-company-name text.
 */
async function isLikelyInvalidCompanyNameWithAi(
  value: string,
): Promise<boolean> {
  const cached = AI_VALIDATION_CACHE.get(value);
  if (cached !== undefined) {
    return cached;
  }

  let result: boolean;
  try {
    const response = await generateStructuredJson<CompanyNameCheck>({
      systemPrompt:
        'You are a data quality assistant. Decide whether the given text is a legitimate company or organisation name (true) or something else such as a job title, job posting excerpt, or general description (false). Respond with valid JSON only: { "isCompanyName": true|false }',
      userPrompt: `Text: "${value}"`,
      maxTokens: 20,
      temperature: 0.1,
    });
    result = response?.isCompanyName === false;
  } catch {
    // On AI failure fall back to a simple word-count heuristic.
    result = countWords(value) >= 7;
  }

  if (AI_VALIDATION_CACHE.size >= AI_VALIDATION_CACHE_MAX) {
    const firstKey = AI_VALIDATION_CACHE.keys().next().value;
    if (firstKey !== undefined) AI_VALIDATION_CACHE.delete(firstKey);
  }
  AI_VALIDATION_CACHE.set(value, result);
  return result;
}

/** Sync guard kept for backward compatibility with existing callers. */
export function isLikelyInvalidCompanyName(value: string): boolean {
  return isDefinitelyInvalidCompanyName(value);
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
  let validCandidate: string | undefined = undefined;
  if (cleanedCandidate) {
    const definitelyInvalid = isDefinitelyInvalidCompanyName(cleanedCandidate);
    const aiInvalid = definitelyInvalid
      ? true
      : await isLikelyInvalidCompanyNameWithAi(cleanedCandidate);
    if (!aiInvalid) {
      validCandidate = cleanedCandidate;
    }
  }

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
