import { jsonError, jsonOk } from "@/lib/apiResponses";
import { inferSuggestedRolesFromSkillsAndCertifications } from "@/lib/candidateProfile";
import { readSharedGithubAccessToken } from "@/lib/githubAuthStore";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";

export const runtime = "nodejs";

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  const parts = cookieHeader.split(";").map((part) => part.trim());
  for (const part of parts) {
    const [cookieName, ...cookieValueParts] = part.split("=");
    if (cookieName !== name) continue;
    return decodeURIComponent(cookieValueParts.join("="));
  }

  return undefined;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      skillsCsv?: string;
      certificationsCsv?: string;
      githubAccessToken?: string;
      aiProvider?: "auto" | "github-models" | "azure-openai" | "copilot-studio";
    };

    const candidate = await prisma.candidate.findFirst({
      where: { id, tenantId },
    });
    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    const githubTokenFromCookie = getCookieValue(request, "githubAccessToken");
    const githubTokenFromSharedStore = await readSharedGithubAccessToken();
    const githubAccessToken =
      body.githubAccessToken ??
      githubTokenFromCookie ??
      githubTokenFromSharedStore ??
      process.env.GITHUB_MODELS_TOKEN;

    const skillsCsv =
      typeof body.skillsCsv === "string" ? body.skillsCsv : candidate.skillsCsv;
    const certificationsCsv =
      typeof body.certificationsCsv === "string"
        ? body.certificationsCsv
        : candidate.certificationsCsv;

    const suggestedRoles = await inferSuggestedRolesFromSkillsAndCertifications(
      {
        skillsCsv,
        certificationsCsv,
        githubAccessToken,
        preferredProvider: body.aiProvider ?? "auto",
      },
    );

    await prisma.candidate.updateMany({
      where: { id: candidate.id, tenantId },
      data: {
        skillsCsv,
        certificationsCsv,
        suggestedRolesCsv: suggestedRoles.join(", "),
      },
    });

    const updatedCandidate = await prisma.candidate.findFirst({
      where: { id: candidate.id, tenantId },
    });

    if (!updatedCandidate) {
      return jsonError("Candidate not found", 404);
    }

    return jsonOk({
      id: updatedCandidate.id,
      suggestedRolesCsv: updatedCandidate.suggestedRolesCsv,
      suggestedRoles,
    });
  } catch (error) {
    return jsonError("Unable to regenerate suggested roles", 400, {
      message: (error as Error).message,
      hint: "Connect GitHub Models or Azure OpenAI in Settings, and ensure skills/certifications are filled in.",
    });
  }
}
