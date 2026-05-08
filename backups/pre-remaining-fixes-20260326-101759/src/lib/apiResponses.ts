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
