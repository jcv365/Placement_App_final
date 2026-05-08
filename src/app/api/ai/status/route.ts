import { jsonOk } from "@/lib/apiResponses";
import { isAiGatewayConfigured } from "@/lib/liteLlm";

export const runtime = "nodejs";

export async function GET() {
  const gatewayConfigured = isAiGatewayConfigured();

  return jsonOk({
    liteLlmConfigured: gatewayConfigured,
  });
}
