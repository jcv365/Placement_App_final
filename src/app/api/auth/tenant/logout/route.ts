import { jsonOk } from "@/lib/apiResponses";
import { APP_SESSION_COOKIE } from "@/lib/appAuth";
import { shouldUseSecureCookies } from "@/lib/cookies";
import { TENANT_COOKIE } from "@/lib/tenant";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secureCookies = shouldUseSecureCookies(request);
  const response = jsonOk({ authenticated: false });

  response.cookies.set({
    name: APP_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: 0,
  });

  response.cookies.set({
    name: TENANT_COOKIE,
    value: "",
    httpOnly: false,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: 0,
  });

  return response;
}
