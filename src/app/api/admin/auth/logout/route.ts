import { ADMIN_SESSION_COOKIE } from "@/lib/adminAuth";
import { jsonOk } from "@/lib/apiResponses";
import { APP_SESSION_COOKIE } from "@/lib/appAuth";
import { shouldUseSecureCookies } from "@/lib/cookies";
import { TENANT_COOKIE } from "@/lib/tenant";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secureCookies = shouldUseSecureCookies(request);
  const response = jsonOk({ authenticated: false });

  // Clear all session cookies so no token can be replayed
  for (const name of [
    ADMIN_SESSION_COOKIE,
    APP_SESSION_COOKIE,
    TENANT_COOKIE,
  ]) {
    response.cookies.set({
      name,
      value: "",
      httpOnly: name !== TENANT_COOKIE,
      sameSite: "lax",
      secure: secureCookies,
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}
