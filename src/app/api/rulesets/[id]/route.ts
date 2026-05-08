import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { requireAuthenticatedTenantId } from "@/lib/tenant";
import { rulesetUpdateSchema } from "@/lib/validation";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

async function updateRuleset(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
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
      const ruleset = await prisma.$transaction(async (tx) => {
        await tx.ruleSet.updateMany({
          where: { tenantId },
          data: { isDefault: false },
        });

        await tx.ruleSet.updateMany({
          where: { id: current.id, tenantId },
          data: {
            ...updates,
            rulesJson: updates.rulesJson as Prisma.InputJsonValue | undefined,
          },
        });

        return tx.ruleSet.findFirst({
          where: { id: current.id, tenantId },
        });
      });

      return jsonOk(ruleset);
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
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[RULESET_UPDATE]", error);
    return jsonError("Unable to update ruleset", 400);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return updateRuleset(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return updateRuleset(request, context);
}
