import { APP_SESSION_COOKIE } from "@/lib/appAuth";
import { shouldUseSecureCookies } from "@/lib/cookies";
import { TENANT_COOKIE } from "@/lib/tenant";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_PUBLIC_BASE_URL = "http://localhost:3001";

function resolvePublicBaseUrl(request: Request): string {
  const configured = process.env.APP_BASE_URL?.trim();
  const source =
    configured && configured.length > 0 ? configured : DEFAULT_PUBLIC_BASE_URL;

  try {
    return new URL(source).origin;
  } catch {
    return new URL(request.url).origin;
  }
}

export async function GET(request: Request) {
  const secureCookies = shouldUseSecureCookies(request);
  const redirectUrl = new URL("/auth/signin", resolvePublicBaseUrl(request));
  const response = NextResponse.redirect(redirectUrl);

  response.cookies.set({
    name: APP_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: 0,
  });

  response.cookies.set({
    name: TENANT_COOKIE,
    value: "",
    httpOnly: false,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: 0,
  });

  return response;
}
