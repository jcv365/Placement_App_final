import {
  getAdminTenantIdFromRequest,
  getAdminUsernameFromRequest,
  isSuperAdminRequest,
} from "@/lib/adminAuth";
import { jsonOk } from "@/lib/apiResponses";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const username = getAdminUsernameFromRequest(request);
  const tenantId = getAdminTenantIdFromRequest(request) ?? "default";
  const superAdmin = isSuperAdminRequest(request);
  return jsonOk({
    authenticated: Boolean(username),
    username,
    tenantId,
    superAdmin,
  });
}
