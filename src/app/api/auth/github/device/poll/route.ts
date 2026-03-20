import { jsonError, jsonOk } from "@/lib/apiResponses";
import { shouldUseSecureCookies } from "@/lib/cookies";
import { writeSharedGithubAccessToken } from "@/lib/githubAuthStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secureCookies = shouldUseSecureCookies(request);
  const body = (await request.json()) as {
    deviceCode?: string;
    clientId?: string;
  };

  const clientId = body.clientId ?? process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return jsonError("Missing env var: GITHUB_OAUTH_CLIENT_ID", 400);
  }

  if (!body?.deviceCode) {
    return jsonError("deviceCode is required", 400);
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: body.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  const data = (await response.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error === "authorization_pending") {
    return jsonOk({ status: "pending", reason: "authorization_pending" });
  }

  if (data.error === "slow_down") {
    return jsonOk({ status: "pending", reason: "slow_down" });
  }

  if (data.error === "expired_token") {
    return jsonError(
      "Device code expired. Start device login again.",
      400,
      data,
    );
  }

  if (data.error === "access_denied") {
    return jsonError("GitHub authorisation was denied.", 400, data);
  }

  if (!response.ok || data.error || !data.access_token) {
    return jsonError("Unable to complete GitHub device login", 400, data);
  }

  await writeSharedGithubAccessToken(data.access_token);

  const result = jsonOk({
    status: "ok",
    accessToken: data.access_token,
    tokenType: data.token_type,
    scope: data.scope,
  });

  result.cookies.set({
    name: "githubAccessToken",
    value: data.access_token,
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return result;
}
