import { jsonOk } from "@/lib/apiResponses";
import { readSharedGithubAccessToken } from "@/lib/githubAuthStore";

export const runtime = "nodejs";

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  if (!match) {
    return undefined;
  }

  return decodeURIComponent(match.split("=").slice(1).join("="));
}

export async function GET(request: Request) {
  const cookieToken = getCookieValue(request, "githubAccessToken");
  const sharedToken = await readSharedGithubAccessToken();
  const envGithubToken = process.env.GITHUB_MODELS_TOKEN?.trim();

  const githubConnected = Boolean(
    cookieToken?.trim() || sharedToken?.trim() || envGithubToken,
  );

  const azureConfigured = Boolean(
    process.env.AZURE_OPENAI_ENDPOINT &&
    process.env.AZURE_OPENAI_API_KEY &&
    process.env.AZURE_OPENAI_DEPLOYMENT,
  );

  return jsonOk({
    githubConnected,
    azureConfigured,
  });
}
