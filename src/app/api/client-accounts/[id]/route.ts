import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { clientAccountUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const { id } = await context.params;
    const body = clientAccountUpdateSchema.parse(await request.json());

    const current = await prisma.clientAccount.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!current) {
      return jsonError("Client account not found", 404);
    }

    const account = await prisma.clientAccount.update({
      where: { id: current.id, tenantId },
      data: {
        name: body.name,
        domain:
          body.domain === undefined
            ? undefined
            : body.domain.trim()
              ? body.domain.trim()
              : null,
        contractTerms:
          body.contractTerms === undefined
            ? undefined
            : body.contractTerms.trim()
              ? body.contractTerms.trim()
              : null,
        billingNotes:
          body.billingNotes === undefined
            ? undefined
            : body.billingNotes.trim()
              ? body.billingNotes.trim()
              : null,
        isActive: body.isActive,
      },
    });

    return jsonOk(account);
  } catch (error) {
    return jsonError("Unable to update client account", 400, {
      message: (error as Error).message,
    });
  }
}
