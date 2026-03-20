import { jsonError, jsonOk } from "@/lib/apiResponses";
import { hashPassword, requireTenantAdminFromRequest } from "@/lib/appAuth";
import { prisma } from "@/lib/prisma";
import { tenantUserRegistrationSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = requireTenantAdminFromRequest(request);
    const body = tenantUserRegistrationSchema.parse(await request.json());
    const email = body.email.toLowerCase();

    const existing = await prisma.tenantUser.findFirst({
      where: {
        tenantId: session.tenantId,
        email,
      },
      select: { id: true },
    });

    if (existing) {
      return jsonError("User already exists in this tenant", 409);
    }

    const passwordHash = await hashPassword(body.password);
    const created = await prisma.tenantUser.create({
      data: {
        tenantId: session.tenantId,
        fullName: body.fullName,
        email,
        passwordHash,
        role: body.role,
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    return jsonOk(created, { status: 201 });
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_TENANT_ADMIN") {
      return jsonError("Admin access is required", 401);
    }

    return jsonError("Unable to register tenant user", 400, {
      message: (error as Error).message,
    });
  }
}
