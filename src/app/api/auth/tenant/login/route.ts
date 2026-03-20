import { jsonError, jsonOk } from "@/lib/apiResponses";
import {
  APP_SESSION_COOKIE,
  createAppSessionToken,
  normaliseTenantId,
  verifyPassword,
} from "@/lib/appAuth";
import { shouldUseSecureCookies } from "@/lib/cookies";
import { prisma } from "@/lib/prisma";
import { TENANT_COOKIE } from "@/lib/tenant";
import { tenantLoginSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const secureCookies = shouldUseSecureCookies(request);
    const body = tenantLoginSchema.parse(await request.json());
    const tenantId = body.tenantId ? normaliseTenantId(body.tenantId) : null;
    const email = body.email.toLowerCase();

    const users = await prisma.tenantUser.findMany({
      where: tenantId ? { tenantId, email } : { email },
      select: {
        id: true,
        tenantId: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
      take: tenantId ? 1 : 10,
    });

    let user = null as (typeof users)[number] | null;

    for (const candidate of users) {
      const validPassword = await verifyPassword(
        body.password,
        candidate.passwordHash,
      );
      if (!validPassword) {
        continue;
      }

      if (!user) {
        user = candidate;
        continue;
      }

      return jsonError(
        "Multiple accounts found for this email. Please sign in from your company admin settings.",
        409,
      );
    }

    if (!user) {
      return jsonError("Email or password is incorrect", 401);
    }

    if (!user.isActive) {
      return jsonError("Please verify your email before signing in", 403);
    }

    const token = createAppSessionToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });

    const response = jsonOk({
      authenticated: true,
      tenantId: user.tenantId,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    });

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

    return response;
  } catch (error) {
    return jsonError("Unable to sign in", 400, {
      message: (error as Error).message,
    });
  }
}
