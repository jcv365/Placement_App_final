import { jsonError, jsonOk } from "@/lib/apiResponses";
import { seedFunctionalTestData } from "@/lib/seedFunctionalTestData";

export const runtime = "nodejs";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return jsonError("Seed not available in production", 403);
  }

  const summary = await seedFunctionalTestData();
  return jsonOk(summary);
}
