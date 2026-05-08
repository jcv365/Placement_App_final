import { jsonError, jsonOk } from "@/lib/apiResponses";
import { shouldUseSecureCookies } from "@/lib/cookies";
import {
  readSharedGithubAccessToken,
  writeSharedGithubAccessToken,
} from "@/lib/githubAuthStore";
import { z } from "zod";

export const runtime = "nodejs";

const syncBodySchema = z
  .object({
    accessToken: z.string().min(1).optional(),
  })
  .default({});

export async function POST(request: Request) {
  const secureCookies = shouldUseSecureCookies(request);
  const parsed = syncBodySchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) return jsonError("Invalid request body", 400);
  const body = parsed.data;

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
