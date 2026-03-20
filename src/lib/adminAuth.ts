import crypto from "node:crypto";

export const ADMIN_SESSION_COOKIE = "adminSession";

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin123";
const SESSION_TTL_HOURS = 24;

type SessionPayload = {
  u: string;
  t: string;
  s?: 1;
  exp: number;
};

const DEFAULT_MASTER_TENANT_ID = "dotcloudconsulting";

function getMasterTenantId(): string {
  return (
    process.env.MASTER_TENANT_ID?.trim().toLowerCase() ||
    DEFAULT_MASTER_TENANT_ID
  );
}

function isMasterTenantId(value?: string | null): boolean {
  if (!value) {
    return false;
  }

  return value.trim().toLowerCase() === getMasterTenantId();
}

function getSessionSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET?.trim() || "local-admin-session-secret"
  );
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signValue(value: string): string {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseSessionToken(token: string): SessionPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      base64UrlDecode(encodedPayload),
    ) as SessionPayload;
    if (!payload.u || !payload.exp) {
      return null;
    }

    if (!payload.t || !payload.t.trim()) {
      payload.t = "default";
    }

    if (Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getAdminUsername(): string {
  return process.env.ADMIN_USERNAME?.trim() || DEFAULT_ADMIN_USERNAME;
}

function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
}

export function validateAdminCredentials(
  username: string,
  password: string,
): boolean {
  const normalisedUsername = username.trim();
  const normalisedPassword = password;

  return (
    safeEqual(normalisedUsername, getAdminUsername()) &&
    safeEqual(normalisedPassword, getAdminPassword())
  );
}

export function createAdminSessionToken(username: string): string {
  return createAdminSessionTokenForTenant(username, "default");
}

export function createAdminSessionTokenForTenant(
  username: string,
  tenantId: string,
  options?: { superAdmin?: boolean },
): string {
  const payload: SessionPayload = {
    u: username.trim(),
    t: tenantId.trim().toLowerCase(),
    s: options?.superAdmin ? 1 : undefined,
    exp: Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signValue(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function getAdminUsernameFromToken(
  token?: string | null,
): string | null {
  if (!token) {
    return null;
  }

  const payload = parseSessionToken(token);
  return payload?.u ?? null;
}

export function getAdminTenantIdFromToken(
  token?: string | null,
): string | null {
  if (!token) {
    return null;
  }

  const payload = parseSessionToken(token);
  return payload?.t ?? null;
}

export function isSuperAdminToken(token?: string | null): boolean {
  if (!token) {
    return false;
  }

  const payload = parseSessionToken(token);
  return payload?.s === 1 || isMasterTenantId(payload?.t);
}

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  if (!match) {
    return undefined;
  }

  return decodeURIComponent(match.split("=").slice(1).join("="));
}

export function getAdminUsernameFromRequest(request: Request): string | null {
  const token = getCookieValue(request, ADMIN_SESSION_COOKIE);
  return getAdminUsernameFromToken(token);
}

export function getAdminTenantIdFromRequest(request: Request): string | null {
  const token = getCookieValue(request, ADMIN_SESSION_COOKIE);
  return getAdminTenantIdFromToken(token);
}

export function isSuperAdminRequest(request: Request): boolean {
  const token = getCookieValue(request, ADMIN_SESSION_COOKIE);
  return isSuperAdminToken(token);
}

export function requireAdminFromRequest(request: Request): string {
  const username = getAdminUsernameFromRequest(request);
  if (!username) {
    throw new Error("UNAUTHORISED_ADMIN");
  }

  return username;
}

export function requireAdminContextFromRequest(request: Request): {
  username: string;
  tenantId: string;
} {
  const username = requireAdminFromRequest(request);
  const tenantId = getAdminTenantIdFromRequest(request) ?? "default";
  return { username, tenantId };
}

export function requireSuperAdminFromRequest(request: Request): string {
  const username = requireAdminFromRequest(request);
  if (!isSuperAdminRequest(request)) {
    throw new Error("FORBIDDEN_SUPER_ADMIN");
  }

  return username;
}
