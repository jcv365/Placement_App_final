import { jsonError, jsonOk } from "@/lib/apiResponses";
import { shouldUseSecureCookies } from "@/lib/cookies";
import {
  readSharedGithubAccessToken,
  writeSharedGithubAccessToken,
} from "@/lib/githubAuthStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secureCookies = shouldUseSecureCookies(request);
  const body = (await request.json()) as {
    accessToken?: string;
  };

  const providedToken = body.accessToken?.trim();
  const sharedToken = await readSharedGithubAccessToken();
  const accessToken = providedToken || sharedToken?.trim();
  if (!accessToken) {
    return jsonError("No GitHub access token available to sync", 400);
  }

  if (providedToken) {
    await writeSharedGithubAccessToken(accessToken);
  }

  const response = jsonOk({ status: "ok" });
  response.cookies.set({
    name: "githubAccessToken",
    value: accessToken,
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
