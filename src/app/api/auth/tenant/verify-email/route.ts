import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

function resolveBaseUrl(request: Request): string {
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
