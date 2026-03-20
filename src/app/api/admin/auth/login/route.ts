import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionTokenForTenant,
  validateAdminCredentials,
} from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { getAppSessionFromRequest, verifyPassword } from "@/lib/appAuth";
import { shouldUseSecureCookies } from "@/lib/cookies";
import { prisma } from "@/lib/prisma";
import { TENANT_COOKIE } from "@/lib/tenant";
import { adminLoginSchema } from "@/lib/validation";

export const runtime = "nodejs";

function normaliseTenantId(value?: string | null): string | undefined {
  const cleaned = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  if (!cleaned || cleaned.length < 2 || cleaned.length > 63) {
    return undefined;
  }

  return cleaned;
}

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  if (!match) {
    return undefined;
  }

  return decodeURIComponent(match.split("=").slice(1).join("="));
}

export async function POST(request: Request) {
  try {
    const secureCookies = shouldUseSecureCookies(request);
    const body = adminLoginSchema.parse(await request.json());
    const requestedTenantId = normaliseTenantId(body.tenantId);
    const sessionTenantId = normaliseTenantId(
      getAppSessionFromRequest(request)?.tid,
    );
    const cookieTenantId = normaliseTenantId(
      getCookieValue(request, TENANT_COOKIE),
    );
    const inferredTenantId =
      requestedTenantId || sessionTenantId || cookieTenantId;

    const valid = validateAdminCredentials(body.username, body.password);
    if (valid) {
      const tenantId = inferredTenantId || "default";
      const token = createAdminSessionTokenForTenant(body.username, tenantId, {
        superAdmin: true,
      });
      const response = jsonOk({
        authenticated: true,
        username: body.username,
        tenantId,
      });

      response.cookies.set({
        name: ADMIN_SESSION_COOKIE,
        value: token,
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
        path: "/",
        maxAge: 60 * 60 * 24,
      });

      response.cookies.set({
        name: TENANT_COOKIE,
        value: tenantId,
        httpOnly: false,
        sameSite: "lax",
        secure: secureCookies,
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });

      return response;
    }

    const email = body.username.toLowerCase();
    const candidates = await prisma.tenantUser.findMany({
      where: inferredTenantId
        ? {
            tenantId: inferredTenantId,
            email,
            role: "ADMIN",
            isActive: true,
          }
        : { email, role: "ADMIN", isActive: true },
      select: {
        id: true,
        tenantId: true,
        email: true,
        fullName: true,
        passwordHash: true,
      },
      take: inferredTenantId ? 1 : 10,
    });

    let matchedAdmin: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      const passwordValid = await verifyPassword(
        body.password,
        candidate.passwordHash,
      );
      if (!passwordValid) {
        continue;
      }

      if (!matchedAdmin) {
        matchedAdmin = candidate;
        continue;
      }

      return jsonError(
        "Multiple administrator accounts matched this email. Sign in to your tenant account first, then retry admin sign-in.",
        409,
      );
    }

    if (!matchedAdmin) {
      return jsonError("Invalid admin email/username or password", 401);
    }

    const tenantId = matchedAdmin.tenantId;
    const token = createAdminSessionTokenForTenant(
      matchedAdmin.fullName || matchedAdmin.email,
      tenantId,
    );
    const response = jsonOk({
      authenticated: true,
      username: matchedAdmin.fullName || matchedAdmin.email,
      tenantId,
    });

    response.cookies.set({
      name: ADMIN_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      path: "/",
      maxAge: 60 * 60 * 24,
    });

    response.cookies.set({
      name: TENANT_COOKIE,
      value: tenantId,
      httpOnly: false,
      sameSite: "lax",
      secure: secureCookies,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    return jsonError("Unable to sign in as admin", 400, {
      message: (error as Error).message,
    });
  }
}
