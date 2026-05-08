import { jsonError, jsonOk } from "@/lib/apiResponses";
import { shouldUseSecureCookies } from "@/lib/cookies";
import { isDemoInstance } from "@/lib/demoMode";
import { demoPersonas } from "@/lib/demoTours";
import { prisma } from "@/lib/prisma";
import { TENANT_COOKIE } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/demo/login
 * Quick-login for demo personas — only available on the demo instance.
 *
 * appAuth uses node:crypto which Turbopack may bundle into an Edge chunk
 * at build time, so we dynamically import it to keep the top-level
 * module graph Edge-safe.
 */
export async function POST(request: Request) {
  if (!isDemoInstance()) {
    return jsonError("Demo login is only available on the demo instance", 403);
  }

  try {
    const { APP_SESSION_COOKIE, createAppSessionToken, verifyPassword } =
      await import("@/lib/appAuth");
    const { ADMIN_SESSION_COOKIE, createAdminSessionTokenForTenant } =
      await import("@/lib/adminAuth");

    const body = (await request.json()) as { personaId?: string };
    const personaId = body.personaId;

    if (!personaId || typeof personaId !== "string") {
      return jsonError("personaId is required", 400);
    }

    const persona = demoPersonas.find((p) => p.id === personaId);
    if (!persona) {
      return jsonError("Unknown persona", 400);
    }

    const user = await prisma.tenantUser.findFirst({
      where: { email: persona.email },
      select: {
        id: true,
        tenantId: true,
        role: true,
        passwordHash: true,
        isActive: true,
      },
    });

    if (!user) {
      return jsonError(
        "Demo account not found. Please run the seed script first.",
        404,
      );
    }

    // Verify password to ensure the account is correctly seeded
    const valid = await verifyPassword(persona.password, user.passwordHash);
    if (!valid || !user.isActive) {
      return jsonError("Demo account is not properly configured", 500);
    }

    const secureCookies = shouldUseSecureCookies(request);
    const token = createAppSessionToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });

    const response = jsonOk({ authenticated: true, tenantId: user.tenantId });

    response.cookies.set({
      name: APP_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      path: "/",
      maxAge: 60 * 60 * 24,
    });

    response.cookies.set({
      name: TENANT_COOKIE,
      value: user.tenantId,
      httpOnly: false,
      sameSite: "lax",
      secure: secureCookies,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    // Admin personas also need the adminSession cookie so the /admin
    // portal is accessible without a second sign-in.
    if (user.role === "ADMIN") {
      const adminToken = createAdminSessionTokenForTenant(
        persona.label,
        user.tenantId,
      );

      response.cookies.set({
        name: ADMIN_SESSION_COOKIE,
        value: adminToken,
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
        path: "/",
        maxAge: 60 * 60 * 24,
      });
    }

    return response;
  } catch (error) {
    console.error("[DEMO_LOGIN]", error);
    return jsonError("Unable to perform demo login", 500);
  }
}
