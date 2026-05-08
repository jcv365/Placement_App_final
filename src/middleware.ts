import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const MUTATION_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const MAX_JSON_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * API paths that are still allowed to mutate on the demo instance.
 * Everything else is blocked to keep the demo read-only.
 */
const DEMO_MUTATION_ALLOWLIST = [
  "/api/demo/login",
  "/api/auth/",
  "/api/admin/auth/",
  "/api/seed",
  "/api/public/contact",
  "/api/public/candidate-signup",
  "/api/email/generate",
];

function isDemoMutationAllowed(pathname: string): boolean {
  return DEMO_MUTATION_ALLOWLIST.some((prefix) => pathname.startsWith(prefix));
}

function isDemo(): boolean {
  if (process.env.DEMO_MODE) return true;
  const dbUrl = process.env.DATABASE_URL ?? "";
  return dbUrl.includes("demo.db");
}

/**
 * Build the set of hosts that are considered "same-origin" for CSRF purposes.
 * Includes the Host / X-Forwarded-Host header AND the configured APP_BASE_URL
 * so that requests arriving through the WAF reverse proxy are accepted.
 *
 * Nginx's $host directive strips the port, so we also add the bare hostname
 * for every host:port entry to handle Origin headers that include the port.
 */
function getTrustedHosts(request: NextRequest): Set<string> {
  const hosts = new Set<string>();

  const fwdHost = request.headers.get("x-forwarded-host");
  if (fwdHost) hosts.add(fwdHost);

  const hostHeader = request.headers.get("host");
  if (hostHeader) hosts.add(hostHeader);

  const baseUrl = process.env.APP_BASE_URL;
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      hosts.add(parsed.host); // host:port
      hosts.add(parsed.hostname); // hostname only
    } catch {
      /* ignore malformed value */
    }
  }

  // Trust sibling tenant subdomains (*.dotcloud.africa)
  const wildcardDomain = process.env.TENANT_WILDCARD_DOMAIN;
  if (wildcardDomain) {
    hosts.add(`*.${wildcardDomain}`);
  }

  // For every host:port already in the set, also trust the bare hostname.
  // This handles the reverse-proxy case where nginx forwards Host without
  // port but the browser Origin includes the port.
  const expanded = new Set(hosts);
  for (const h of hosts) {
    if (h.startsWith("*.")) continue;
    const colonIdx = h.lastIndexOf(":");
    if (colonIdx > 0) {
      expanded.add(h.slice(0, colonIdx));
    }
  }

  return expanded;
}

/**
 * Check whether a hostname matches any trusted host, including wildcard
 * entries like `*.dotcloud.africa`.
 */
function isTrustedHost(hostname: string, trustedHosts: Set<string>): boolean {
  if (trustedHosts.has(hostname)) return true;
  for (const pattern of trustedHosts) {
    if (pattern.startsWith("*.") && hostname.endsWith(pattern.slice(1))) {
      return true;
    }
  }
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Candidate-signup redirect ---
  // When CANDIDATE_SIGNUP_REDIRECT_URL is set (e.g. on the dev/demo stack via
  // docker-compose.dev.yml), redirect both the page and the API endpoint to the
  // production instance so CVs always land in prod.db.
  const signupRedirectUrl = process.env.CANDIDATE_SIGNUP_REDIRECT_URL;
  if (signupRedirectUrl) {
    if (
      pathname === "/candidate-signup" ||
      pathname.startsWith("/candidate-signup/") ||
      pathname === "/api/public/candidate-signup"
    ) {
      return NextResponse.redirect(signupRedirectUrl);
    }
  }

  // Only apply remaining checks to API mutation requests
  if (!pathname.startsWith("/api/") || !MUTATION_METHODS.has(request.method)) {
    return NextResponse.next();
  }

  // --- Demo read-only guard ---
  if (isDemo() && !isDemoMutationAllowed(request.nextUrl.pathname)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          message:
            "This is a read-only demo. Contact us to learn more about the platform.",
        },
      },
      { status: 403 },
    );
  }

  // --- CSRF: Origin / Referer header validation ---
  const origin = request.headers.get("origin");
  const trustedHosts = getTrustedHosts(request);

  if (origin) {
    if (trustedHosts.size > 0) {
      try {
        const originUrl = new URL(origin);
        // Check both host (with port) and hostname (without port) to handle
        // reverse-proxy port mismatches. Also supports wildcard patterns.
        if (
          !isTrustedHost(originUrl.host, trustedHosts) &&
          !isTrustedHost(originUrl.hostname, trustedHosts)
        ) {
          return NextResponse.json(
            { ok: false, error: { message: "Cross-origin request rejected" } },
            { status: 403 },
          );
        }
      } catch {
        return NextResponse.json(
          { ok: false, error: { message: "Invalid origin header" } },
          { status: 403 },
        );
      }
    }
  } else {
    // No Origin header — fall back to Referer check
    const referer = request.headers.get("referer");
    if (referer && trustedHosts.size > 0) {
      try {
        const refererUrl = new URL(referer);
        if (
          !isTrustedHost(refererUrl.host, trustedHosts) &&
          !isTrustedHost(refererUrl.hostname, trustedHosts)
        ) {
          return NextResponse.json(
            { ok: false, error: { message: "Cross-origin request rejected" } },
            { status: 403 },
          );
        }
      } catch {
        return NextResponse.json(
          { ok: false, error: { message: "Invalid referer header" } },
          { status: 403 },
        );
      }
    }
  }

  // --- Content-Length guard for JSON bodies ---
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const cl = request.headers.get("content-length");
    if (cl && Number(cl) > MAX_JSON_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, error: { message: "Request body too large" } },
        { status: 413 },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/candidate-signup", "/candidate-signup/:path*"],
};
