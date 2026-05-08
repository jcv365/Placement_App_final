import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

const DEFAULT_PUBLIC_BASE_URL = "http://localhost:3001";

function resolveBaseUrl(request: Request): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }

  // Prefer the public app URL so redirects stay on the canonical hostname.
  if (DEFAULT_PUBLIC_BASE_URL) {
    return DEFAULT_PUBLIC_BASE_URL;
  }

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";

  if (host) {
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const baseUrl = resolveBaseUrl(request);
  const token = searchParams.get("token")?.trim();

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/auth/signin?verified=missing`);
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();

  const user = await prisma.tenantUser.findFirst({
    where: {
      verifyTokenHash: tokenHash,
      verifyTokenExpiry: {
        gt: now,
      },
    },
    select: {
      id: true,
      isActive: true,
    },
  });

  if (!user) {
    return NextResponse.redirect(`${baseUrl}/auth/signin?verified=invalid`);
  }

  if (!user.isActive) {
    await prisma.tenantUser.update({
      where: { id: user.id },
      data: {
        isActive: true,
        emailVerifiedAt: now,
        verifyTokenHash: null,
        verifyTokenExpiry: null,
      },
    });
  }

  return NextResponse.redirect(`${baseUrl}/auth/signin?verified=success`);
}
