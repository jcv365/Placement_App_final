import { jsonError, jsonOk } from "@/lib/apiResponses";
import { z } from "zod";

export const runtime = "nodejs";

const startBodySchema = z
  .object({
    clientId: z.string().min(1).optional(),
  })
  .default({});

export async function POST(request: Request) {
  const parsed = startBodySchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) return jsonError("Invalid request body", 400);
  const body = parsed.data;

  const clientId = body.clientId ?? process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return jsonError("Missing env var: GITHUB_OAUTH_CLIENT_ID", 400);
  }

  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: "read:user",
    }),
  });

  const data = (await response.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || data.error) {
    return jsonError("Unable to start GitHub device login", 400, data);
  }

  return jsonOk(data);
}
