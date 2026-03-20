import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { rulesetUpdateSchema } from "@/lib/validation";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const updates = rulesetUpdateSchema.parse(await request.json());
    const { id } = await context.params;

    const current = await prisma.ruleSet.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!current) {
      return jsonError("Ruleset not found", 404);
    }

    if (updates.isDefault) {
      await prisma.ruleSet.updateMany({
        where: { tenantId },
        data: { isDefault: false },
      });
    }

    await prisma.ruleSet.updateMany({
      where: { id: current.id, tenantId },
      data: {
        ...updates,
        rulesJson: updates.rulesJson as Prisma.InputJsonValue | undefined,
      },
    });

    const ruleset = await prisma.ruleSet.findFirst({
      where: { id: current.id, tenantId },
    });

    return jsonOk(ruleset);
  } catch (error) {
    return jsonError("Unable to update ruleset", 400, {
      message: (error as Error).message,
    });
  }
}
