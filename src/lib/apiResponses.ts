import { NextResponse } from "next/server";

export function jsonOk(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: { message, details } },
    { status },
  );
}

/**
 * Returns a 401 response if the error is an UNAUTHENTICATED sentinel,
 * otherwise `null` so callers can fall through to their standard handler.
 */
export function handleAuthError(error: unknown): NextResponse | null {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return jsonError("Authentication required", 401);
  }
  return null;
}

/**
 * Validates the Origin header on mutation requests to prevent CSRF.
 * Returns a 403 response if the origin doesn't match, or null if valid.
 *
 * Nginx (WAF reverse-proxy) forwards the Host header without the port, so we
 * compare both `host` (host+port) and `hostname` (host only) from the Origin
 * against every trusted host candidate.  APP_BASE_URL provides the authoritative
 * host:port when it differs from the forwarded Host header.
 */
export function rejectCrossOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Same-origin requests from browsers always include Origin on POST/PATCH/DELETE.
    // If absent, it may be a server-to-server call — allow it.
    return null;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return jsonError("Cross-origin request rejected", 403);
  }

  // Build the set of trusted host values (with and without port).
  const trusted = new Set<string>();
  const addHost = (h: string | null | undefined) => {
    if (!h) return;
    trusted.add(h);
    // Also trust the bare hostname so nginx port-stripping doesn't break things.
    const colonIdx = h.lastIndexOf(":");
    if (colonIdx > 0) trusted.add(h.slice(0, colonIdx));
  };

  addHost(request.headers.get("x-forwarded-host"));
  addHost(request.headers.get("host"));

  const baseUrl = process.env.APP_BASE_URL;
  if (baseUrl) {
    try {
      const b = new URL(baseUrl);
      addHost(b.host); // hostname:port
      addHost(b.hostname); // hostname only
    } catch {
      /* ignore malformed value */
    }
  }

  if (trusted.size === 0) {
    return null;
  }

  if (trusted.has(originUrl.host) || trusted.has(originUrl.hostname)) {
    return null;
  }

  return jsonError("Cross-origin request rejected", 403);
}

/** Max bytes for JSON request bodies (1 MB). */
export const MAX_JSON_BODY_BYTES = 1 * 1024 * 1024;

/**
 * Rejects requests whose Content-Length exceeds maxBytes.
 * Returns a 413 response if too large, or null if acceptable.
 */
export function rejectOversizedBody(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): NextResponse | null {
  const cl = request.headers.get("content-length");
  if (cl && Number(cl) > maxBytes) {
    return jsonError("Request body too large", 413);
  }
  return null;
}

/**
 * Extracts a safe, generic error message from an unknown thrown value.
 * Never leaks raw Error.message to the client.
 */
export function safeErrorMessage(
  error: unknown,
  fallback = "An unexpected error occurred",
): string {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return "Authentication required";
  }
  if (error instanceof Error && error.message === "UNAUTHORISED_ADMIN") {
    return "Admin sign-in is required";
  }
  console.error(fallback, error);
  return fallback;
}
