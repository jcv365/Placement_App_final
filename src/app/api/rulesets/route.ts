import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { rulesetSchema } from "@/lib/validation";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const tenantId = resolveTenantIdFromRequest(request);
  const rulesets = await prisma.ruleSet.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  return jsonOk(rulesets);
}

export async function POST(request: Request) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const body = rulesetSchema.parse(await request.json());

    if (body.isDefault) {
      await prisma.ruleSet.updateMany({
        where: { tenantId },
        data: { isDefault: false },
      });
    }

    const ruleset = await prisma.ruleSet.create({
      data: {
        tenantId,
        ...body,
        rulesJson: body.rulesJson as Prisma.InputJsonValue,
      },
    });
    return jsonOk(ruleset, { status: 201 });
  } catch (error) {
    return jsonError("Invalid ruleset", 400, {
      message: (error as Error).message,
    });
  }
}
