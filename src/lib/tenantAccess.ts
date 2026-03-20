import { getAppSessionFromRequest } from "@/lib/appAuth";
import { resolveTenantIdFromRequest } from "@/lib/tenant";

export type TenantAccessScope = {
  tenantId: string;
  isTenantUser: boolean;
  isTenantAdmin: boolean;
  userId?: string;
};

export function resolveTenantAccessScope(request: Request): TenantAccessScope {
  const tenantId = resolveTenantIdFromRequest(request);
  const session = getAppSessionFromRequest(request);

  if (!session) {
    return {
      tenantId,
      isTenantUser: false,
      isTenantAdmin: false,
    };
  }

  return {
    tenantId,
    isTenantUser: session.role === "USER",
    isTenantAdmin: session.role === "ADMIN",
    userId: session.uid,
  };
}

export function getOwnerFilter(
  scope: TenantAccessScope,
): { ownerUserId: string } | Record<string, never> {
  if (scope.isTenantUser && scope.userId) {
    return { ownerUserId: scope.userId };
  }

  return {};
}
