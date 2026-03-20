import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { clientContactCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const tenantId = resolveTenantIdFromRequest(request);
  const contacts = await prisma.clientContact.findMany({
    where: { tenantId },
    include: {
      clientAccount: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonOk(contacts);
}

export async function POST(request: Request) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const body = clientContactCreateSchema.parse(await request.json());

    const account = await prisma.clientAccount.findFirst({
      where: { id: body.clientAccountId, tenantId },
      select: { id: true },
    });

    if (!account) {
      return jsonError("Unable to create client contact", 400, {
        message: "Client account is not available for this tenant.",
      });
    }

    const contact = await prisma.clientContact.create({
      data: {
        tenantId,
        clientAccountId: body.clientAccountId,
        fullName: body.fullName,
        email: body.email,
        phone: body.phone?.trim() ? body.phone.trim() : null,
        role: body.role ?? "OTHER",
        notes: body.notes?.trim() ? body.notes.trim() : null,
      },
      include: {
        clientAccount: {
          select: { id: true, name: true },
        },
      },
    });

    return jsonOk(contact, { status: 201 });
  } catch (error) {
    return jsonError("Unable to create client contact", 400, {
      message: (error as Error).message,
    });
  }
}
