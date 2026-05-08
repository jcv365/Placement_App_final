import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import {
  requireAuthenticatedTenantId,
  resolveTenantIdFromRequest,
} from "@/lib/tenant";
import { rulesetSchema } from "@/lib/validation";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export const runtime = "nodejs";

const rulesetUpsertSchema = rulesetSchema.extend({
  id: z.string().optional(),
});

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
    const tenantId = requireAuthenticatedTenantId(request);
    const body = rulesetUpsertSchema.parse(await request.json());

    const current = body.id
      ? await prisma.ruleSet.findFirst({
          where: { id: body.id, tenantId },
          select: { id: true },
        })
      : await prisma.ruleSet.findFirst({
          where: { tenantId, name: body.name },
          select: { id: true },
        });

    if (current) {
      const ruleset = await prisma.$transaction(async (tx) => {
        if (body.isDefault) {
          await tx.ruleSet.updateMany({
            where: { tenantId },
            data: { isDefault: false },
          });
        }

        await tx.ruleSet.updateMany({
          where: { id: current.id, tenantId },
          data: {
            name: body.name,
            isDefault: body.isDefault,
            rulesJson: body.rulesJson as Prisma.InputJsonValue,
          },
        });

        return tx.ruleSet.findFirst({
          where: { id: current.id, tenantId },
        });
      });

      return jsonOk(ruleset);
    }

    const ruleset = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.ruleSet.updateMany({
          where: { tenantId },
          data: { isDefault: false },
        });
      }

      return tx.ruleSet.create({
        data: {
          tenantId,
          ...body,
          rulesJson: body.rulesJson as Prisma.InputJsonValue,
        },
      });
    });
    return jsonOk(ruleset, { status: 201 });
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[RULESET_CREATE]", error);
    return jsonError("Invalid ruleset", 400);
  }
}
