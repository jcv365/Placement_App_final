import { jsonError, jsonOk } from "@/lib/apiResponses";
import {
  APP_SESSION_COOKIE,
  createAppSessionToken,
  normaliseTenantId,
  verifyPassword,
} from "@/lib/appAuth";
import { shouldUseSecureCookies } from "@/lib/cookies";
import { sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { TENANT_COOKIE } from "@/lib/tenant";
import { tenantLoginSchema } from "@/lib/validation";
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";
import crypto from "node:crypto";

export const runtime = "nodejs";

const DEFAULT_PUBLIC_BASE_URL = "https://placement.dotcloud.africa:8082";

function resolveVerificationBaseUrl(request: Request): string {
  const configured = process.env.APP_BASE_URL?.trim();
  const fallback = new URL(request.url).origin;
  const source =
    configured && configured.length > 0 ? configured : DEFAULT_PUBLIC_BASE_URL;

  try {
    const parsed = new URL(source);
    if (parsed.hostname === "localhost" || parsed.hostname === "::1") {
      parsed.hostname = "127.0.0.1";
    }
    return parsed.origin;
  } catch {
    return fallback;
  }
}

async function sendVerificationReminderEmail(params: {
  request: Request;
  userId: string;
  fullName: string;
  email: string;
}): Promise<{ sent: boolean }> {
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const verificationTokenHash = crypto
    .createHash("sha256")
    .update(verificationToken)
    .digest("hex");
  const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.tenantUser.update({
    where: { id: params.userId },
    data: {
      verifyTokenHash: verificationTokenHash,
      verifyTokenExpiry: verificationExpiry,
    },
  });

  const baseUrl = resolveVerificationBaseUrl(params.request);
  const verificationLink = `${baseUrl}/api/auth/tenant/verify-email?token=${verificationToken}`;
  const mailResult = await sendMail({
    to: [params.email],
    subject: "Verify your Contract Placements account",
    text:
      `Hello ${params.fullName},\n\n` +
      "You tried to sign in, but your account is not verified yet.\n\n" +
      "Please verify your account by opening this link:\n" +
      `<${verificationLink}>\n\n` +
      "This link expires in 24 hours.",
  });

  return { sent: mailResult.sent };
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const { allowed, retryAfterMs } = checkRateLimit(
      `tenant-login:${ip}`,
      10,
      60_000,
    );
    if (!allowed) {
      return jsonError(
        "Too many login attempts. Please try again later.",
        429,
        { retryAfterMs },
      );
    }

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
      const reminderResult = await sendVerificationReminderEmail({
        request,
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
      });

      return jsonError(
        reminderResult.sent
          ? "Your account is not verified yet. A verification email has been sent. Please verify your email before signing in."
          : "Your account is not verified yet. Please verify your email before signing in.",
        403,
      );
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
