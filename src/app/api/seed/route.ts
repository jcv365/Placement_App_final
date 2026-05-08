import { jsonError, jsonOk } from "@/lib/apiResponses";
import { seedFunctionalTestData } from "@/lib/seedFunctionalTestData";

export const runtime = "nodejs";

export async function POST() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DISABLE_SEED === "true"
  ) {
    return jsonError("Seed not available in this environment", 403);
  }

  const summary = await seedFunctionalTestData();
  return jsonOk(summary);
}
