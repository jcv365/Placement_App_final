import { jsonOk } from "@/lib/apiResponses";
import { shouldUseSecureCookies } from "@/lib/cookies";
import { clearSharedGithubAccessToken } from "@/lib/githubAuthStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secureCookies = shouldUseSecureCookies(request);
  await clearSharedGithubAccessToken();

  const response = jsonOk({ status: "ok" });
  response.cookies.set({
    name: "githubAccessToken",
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: 0,
  });

  return response;
}
