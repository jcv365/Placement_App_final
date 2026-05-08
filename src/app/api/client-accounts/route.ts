import { jsonError, jsonOk } from "@/lib/apiResponses";
import { writeAuditLog } from "@/lib/auditLog";
import { prisma } from "@/lib/prisma";
import {
  requireAuthenticatedTenantId,
  resolveTenantIdFromRequest,
} from "@/lib/tenant";
import { clientAccountCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const tenantId = resolveTenantIdFromRequest(request);
  const accounts = await prisma.clientAccount.findMany({
    where: { tenantId },
    include: {
      _count: {
        select: { contacts: true, vacancies: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonOk(accounts);
}

export async function POST(request: Request) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const body = clientAccountCreateSchema.parse(await request.json());

    const account = await prisma.clientAccount.create({
      data: {
        tenantId,
        name: body.name,
        domain: body.domain?.trim() ? body.domain.trim() : null,
        contractTerms: body.contractTerms?.trim()
          ? body.contractTerms.trim()
          : null,
        billingNotes: body.billingNotes?.trim()
          ? body.billingNotes.trim()
          : null,
        isActive: body.isActive ?? true,
      },
    });

    await writeAuditLog({
      tenantId,
      entityType: "clientAccount",
      entityId: account.id,
      action: "CREATE",
    });

    return jsonOk(account, { status: 201 });
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[CLIENT_ACCOUNT_CREATE]", error);
    return jsonError("Unable to create client account", 400);
  }
}
