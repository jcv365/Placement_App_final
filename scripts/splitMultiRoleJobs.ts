import { generateStructuredJson } from "@/lib/aiJson";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeRole(value: string): boolean {
  const cleaned = cleanText(value);
  if (!cleaned || cleaned.length < 3 || cleaned.length > 120) {
    return false;
  }

  return /\b(lead|head|manager|engineer|architect|analyst|consultant|specialist|developer|administrator|officer|designer|sre|devops|qa|scientist|researcher|coordinator|director|owner|strategist|practitioner|steward|evangelist|tester|trainer|scrum|programmer|technician)\b/i.test(
    cleaned,
  );
}

function expandConsortiumSecurityRoles(source: string): string[] {
  const consortiumMatch = source.match(/^.+consortium\s*\((.+)\)$/i);
  if (!consortiumMatch) {
    return [];
  }

  const body = consortiumMatch[1] ?? "";
  const items = body
    .split(/\s*,\s*/)
    .map((part) => cleanText(part))
    .filter(Boolean);

  if (items.length <= 1) {
    return [];
  }

  const expanded = items
    .map((item) => `${item} Engineer`)
    .map((role) => cleanText(role))
    .filter(looksLikeRole);

  return [...new Set(expanded)];
}

function splitRoleTitle(title: string): string[] {
  const source = cleanText(title)
    .replace(/&amp;/gi, "&")
    .replace(/^linkedin\s+opportunit(?:y|ies):?\s*/i, "")
    .replace(
      /\b(contract\s+roles?|contract\s+role|openings?|positions?)\b.*$/i,
      "",
    )
    .trim();

  if (!source) {
    return [];
  }

  const consortiumRoles = expandConsortiumSecurityRoles(source);
  if (consortiumRoles.length > 1) {
    return consortiumRoles;
  }

  const segments = source.split(/\s*,\s*/).map((part) => cleanText(part));
  if (segments.length >= 2) {
    const last = segments[segments.length - 1] ?? "";
    const lastMatch = last.match(
      /^(.+)\s+(engineers?|developers?|architects?|analysts?|consultants?)$/i,
    );

    if (lastMatch) {
      const lastPrefix = cleanText(lastMatch[1] ?? "");
      const suffixRaw = (lastMatch[2] ?? "").toLowerCase();
      const suffix = suffixRaw.endsWith("s")
        ? suffixRaw.slice(0, -1)
        : suffixRaw;

      const expandedPrefixes = [...segments.slice(0, -1), lastPrefix].filter(
        Boolean,
      );
      const expanded = expandedPrefixes
        .map((prefix) => `${prefix} ${suffix}`)
        .map((role) => cleanText(role))
        .filter(looksLikeRole);

      if (expanded.length > 1) {
        return [...new Set(expanded)];
      }
    }
  }

  const sharedSuffixMatch = source.match(
    /^(.+),\s*(engineers?|developers?|architects?|analysts?|consultants?)$/i,
  );

  if (sharedSuffixMatch) {
    const prefixList = sharedSuffixMatch[1] ?? "";
    const suffixRaw = (sharedSuffixMatch[2] ?? "").toLowerCase();
    const suffix = suffixRaw.endsWith("s") ? suffixRaw.slice(0, -1) : suffixRaw;

    const expanded = prefixList
      .split(/\s*,\s*/)
      .map((part) => cleanText(part))
      .filter(Boolean)
      .map((part) => `${part} ${suffix}`)
      .filter(looksLikeRole);

    if (expanded.length > 1) {
      return [...new Set(expanded)];
    }
  }

  // Only split on strong list delimiters for this migration.
  const parts = source
    .split(/\s*[\n,;|]+\s*/)
    .map((part) => part.replace(/^[-*\d.)\s]+/, "").trim())
    .map((part) => part.replace(/[|,;:\-]+$/, "").trim())
    .filter(Boolean)
    .filter((part) => part.length <= 120)
    .filter(looksLikeRole);

  return [...new Set(parts)];
}

// ── AI acronym resolution ────────────────────────────────────────────────────

type AiRoleTitle = { title: string };

/**
 * Asks AI for the canonical job title for an unknown IT/security acronym.
 * Falls back to "<acronym> Engineer" if AI is unavailable.
 */
async function resolveRoleAcronym(acronym: string): Promise<string> {
  try {
    const result = await generateStructuredJson<AiRoleTitle>({
      systemPrompt:
        'You are a job title expert. Given a technical acronym from the IT/cybersecurity industry, return the most common formal job title that uses it. Respond with valid JSON only: { "title": "<full job title>" }. Keep it 2–5 words.',
      userPrompt: `Acronym: "${acronym}"`,
      maxTokens: 30,
      temperature: 0.1,
    });
    const resolved = result?.title?.trim();
    return resolved && resolved.length >= 3 ? resolved : `${acronym} Engineer`;
  } catch {
    return `${acronym} Engineer`;
  }
}

/**
 * Post-processes roles produced by splitRoleTitle: any role that is just
 * "<ACRONYM> Engineer" (where ACRONYM is ≤6 uppercase letters) is sent to AI
 * for expansion into a proper job title.
 */
async function resolveGenericRoles(roles: string[]): Promise<string[]> {
  const resolved = await Promise.all(
    roles.map(async (role) => {
      const words = role.trim().split(/\s+/);
      if (words.length === 2 && words[1]?.toLowerCase() === "engineer") {
        const prefix = words[0] ?? "";
        if (
          prefix.length >= 2 &&
          prefix.length <= 6 &&
          /^[A-Z]+$/.test(prefix)
        ) {
          return resolveRoleAcronym(prefix);
        }
      }
      return role;
    }),
  );
  return [...new Set(resolved)];
}

async function run() {
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      tenantId: true,
      ownerUserId: true,
      title: true,
      rawText: true,
      opportunityEmail: true,
      opportunityUrl: true,
      companyId: true,
      _count: {
        select: {
          applications: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  let scanned = 0;
  let splitCandidates = 0;
  let skippedWithApplications = 0;
  let createdJobs = 0;
  let alreadyExisted = 0;
  let deletedCombined = 0;

  for (const job of jobs) {
    scanned += 1;

    const roles = await resolveGenericRoles(splitRoleTitle(job.title));
    if (roles.length <= 1) {
      continue;
    }

    splitCandidates += 1;

    if (job._count.applications > 0) {
      skippedWithApplications += 1;
      continue;
    }

    let createdForJob = 0;
    let coveredRoles = 0;

    for (const role of roles) {
      const existing = await prisma.job.findFirst({
        where: {
          tenantId: job.tenantId,
          title: role,
          rawText: job.rawText,
          companyId: job.companyId,
          opportunityEmail: job.opportunityEmail,
          opportunityUrl: job.opportunityUrl,
        },
        select: { id: true },
      });

      if (existing) {
        alreadyExisted += 1;
        coveredRoles += 1;
        continue;
      }

      await prisma.job.create({
        data: {
          tenantId: job.tenantId,
          ownerUserId: job.ownerUserId,
          title: role,
          rawText: job.rawText,
          opportunityEmail: job.opportunityEmail,
          opportunityUrl: job.opportunityUrl,
          companyId: job.companyId,
        },
      });

      createdForJob += 1;
      coveredRoles += 1;
      createdJobs += 1;
    }

    if (coveredRoles === roles.length) {
      await prisma.job.delete({
        where: { id: job.id },
      });
      deletedCombined += 1;
    }
  }

  console.log("splitMultiRoleJobs summary");
  console.log(`scanned=${scanned}`);
  console.log(`splitCandidates=${splitCandidates}`);
  console.log(`skippedWithApplications=${skippedWithApplications}`);
  console.log(`createdJobs=${createdJobs}`);
  console.log(`alreadyExisted=${alreadyExisted}`);
  console.log(`deletedCombined=${deletedCombined}`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
