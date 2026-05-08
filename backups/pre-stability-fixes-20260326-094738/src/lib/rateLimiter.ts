/**
 * Simple in-memory rate limiter for auth endpoints.
 * Limits requests per key (e.g. IP or email) within a sliding window.
 */

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitRecord>();
const MAX_STORE_SIZE = 50_000;

// Periodic cleanup every 5 minutes
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(
    () => {
      const now = Date.now();
      for (const [key, record] of store.entries()) {
        if (record.resetAt < now) store.delete(key);
      }
      if (store.size === 0 && cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
    },
    5 * 60 * 1000,
  );
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export function checkRateLimit(
  key: string,
  maxAttempts = 10,
  windowMs = 60_000,
): { allowed: boolean; retryAfterMs: number } {
  ensureCleanup();
  const now = Date.now();
  const record = store.get(key);

  if (!record || record.resetAt < now) {
    // Evict if store is too large
    if (store.size >= MAX_STORE_SIZE) {
      const oldest = Array.from(store.entries()).sort(
        (a, b) => a[1].resetAt - b[1].resetAt,
      );
      for (let i = 0; i < oldest.length / 2; i++) {
        store.delete(oldest[i][0]);
      }
    }
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (record.count >= maxAttempts) {
    return { allowed: false, retryAfterMs: record.resetAt - now };
  }

  record.count++;
  return { allowed: true, retryAfterMs: 0 };
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
