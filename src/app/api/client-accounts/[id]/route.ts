import { jsonError, jsonOk } from "@/lib/apiResponses";
import { writeAuditLog } from "@/lib/auditLog";
import { prisma } from "@/lib/prisma";
import { requireAuthenticatedTenantId } from "@/lib/tenant";
import { clientAccountUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
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

    await writeAuditLog({
      tenantId,
      entityType: "clientAccount",
      entityId: account.id,
      action: "UPDATE",
    });

    return jsonOk(account);
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[CLIENT_ACCOUNT_UPDATE]", error);
    return jsonError("Unable to update client account", 400);
  }
}
