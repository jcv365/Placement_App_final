import { getAdminTenantIdFromRequest } from "@/lib/adminAuth";
import { getAppSessionFromRequest } from "@/lib/appAuth";

export const TENANT_COOKIE = "tenantId";
export const DEFAULT_TENANT_ID = "default";

function normaliseTenantId(value?: string | null): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(trimmed) ? trimmed : undefined;
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

export function resolveTenantIdFromRequest(request: Request): string {
  const fromAppSession = normaliseTenantId(
    getAppSessionFromRequest(request)?.tid,
  );
  if (fromAppSession) {
    return fromAppSession;
  }

  const fromAdminSession = normaliseTenantId(
    getAdminTenantIdFromRequest(request),
  );
  if (fromAdminSession) {
    return fromAdminSession;
  }

  const fromHeader = normaliseTenantId(request.headers.get("x-tenant-id"));
  if (fromHeader) {
    return fromHeader;
  }

  const fromCookie = normaliseTenantId(getCookieValue(request, TENANT_COOKIE));
  if (fromCookie) {
    return fromCookie;
  }

  return DEFAULT_TENANT_ID;
}
