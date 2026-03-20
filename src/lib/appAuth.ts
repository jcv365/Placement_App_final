import crypto from "node:crypto";

export const APP_SESSION_COOKIE = "appSession";

const SESSION_TTL_HOURS = 24;
const SCRYPT_KEYLEN = 64;

export type AppSessionRole = "ADMIN" | "USER";

type AppSessionPayload = {
  uid: string;
  tid: string;
  role: AppSessionRole;
  exp: number;
};

function getSessionSecret(): string {
  return process.env.APP_SESSION_SECRET?.trim() || "local-app-session-secret";
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

function parseSessionToken(token: string): AppSessionPayload | null {
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
    ) as AppSessionPayload;

    if (!payload.uid || !payload.tid || !payload.role || !payload.exp) {
      return null;
    }

    if (Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
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

export function createAppSessionToken(params: {
  userId: string;
  tenantId: string;
  role: AppSessionRole;
}): string {
  const payload: AppSessionPayload = {
    uid: params.userId,
    tid: params.tenantId,
    role: params.role,
    exp: Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signValue(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function getAppSessionFromRequest(
  request: Request,
): AppSessionPayload | null {
  const token = getCookieValue(request, APP_SESSION_COOKIE);
  if (!token) {
    return null;
  }

  return parseSessionToken(token);
}

export function requireTenantAdminFromRequest(request: Request): {
  userId: string;
  tenantId: string;
} {
  const session = getAppSessionFromRequest(request);
  if (!session || session.role !== "ADMIN") {
    throw new Error("UNAUTHORISED_TENANT_ADMIN");
  }

  return { userId: session.uid, tenantId: session.tid };
}

export function normaliseTenantId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await new Promise<string>((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve((key as Buffer).toString("hex"));
    });
  });

  return `${salt}:${hash}`;
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [salt, hash] = encodedHash.split(":");
  if (!salt || !hash) {
    return false;
  }

  const candidate = await new Promise<string>((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve((key as Buffer).toString("hex"));
    });
  });

  return safeEqual(candidate, hash);
}
