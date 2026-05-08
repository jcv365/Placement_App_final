import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { hashPassword } from "@/lib/appAuth";
import { prisma } from "@/lib/prisma";
import { tenantUserRegistrationSchema } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";

const updateTenantUserSchema = z
  .object({
    userId: z.string().min(1),
    fullName: z.string().trim().min(2).max(120).optional(),
    role: z.enum(["ADMIN", "USER"]).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8).max(120).optional(),
  })
  .refine(
    (value) =>
      value.fullName !== undefined ||
      value.role !== undefined ||
      value.isActive !== undefined ||
      value.password !== undefined,
    {
      message: "No user updates were provided",
    },
  );

export async function GET(request: Request) {
  try {
    const admin = requireAdminContextFromRequest(request);

    const users = await prisma.tenantUser.findMany({
      where: { tenantId: admin.tenantId },
      orderBy: [{ role: "desc" }, { fullName: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return jsonOk({ users });
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin access is required", 401);
    }

    console.error("[ADMIN_USERS_GET]", error);
    return jsonError("Unable to load user logins", 400);
  }
}

export async function POST(request: Request) {
  try {
    const admin = requireAdminContextFromRequest(request);
    const body = tenantUserRegistrationSchema.parse(await request.json());
    const email = body.email.toLowerCase();

    const existing = await prisma.tenantUser.findFirst({
      where: {
        tenantId: admin.tenantId,
        email,
      },
      select: { id: true },
    });

    if (existing) {
      return jsonError("User already exists in this company", 409);
    }

    const passwordHash = await hashPassword(body.password);
    const created = await prisma.tenantUser.create({
      data: {
        tenantId: admin.tenantId,
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
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin access is required", 401);
    }

    return jsonError("Unable to create user login", 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = requireAdminContextFromRequest(request);
    const body = updateTenantUserSchema.parse(await request.json());
    const passwordResetRequested = body.password !== undefined;

    const target = await prisma.tenantUser.findFirst({
      where: {
        id: body.userId,
        tenantId: admin.tenantId,
      },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!target) {
      return jsonError("User not found in this company", 404);
    }

    const nextRole = body.role ?? target.role;
    const nextIsActive = body.isActive ?? target.isActive;

    if (target.role === "ADMIN" && target.isActive) {
      const adminWillRemainActive = nextRole === "ADMIN" && nextIsActive;
      if (!adminWillRemainActive) {
        const activeAdminCount = await prisma.tenantUser.count({
          where: {
            tenantId: admin.tenantId,
            role: "ADMIN",
            isActive: true,
          },
        });

        if (activeAdminCount <= 1) {
          return jsonError(
            "At least one active admin must remain in this company",
            409,
          );
        }
      }
    }

    const passwordHash =
      body.password !== undefined
        ? await hashPassword(body.password)
        : undefined;

    const updated = await prisma.tenantUser.update({
      where: { id: target.id },
      data: {
        fullName: body.fullName,
        role: body.role,
        isActive: body.isActive,
        passwordHash,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    if (passwordResetRequested) {
      await prisma.auditLog.create({
        data: {
          tenantId: admin.tenantId,
          actor: admin.username,
          entityType: "tenant_user_login",
          entityId: updated.id,
          action: "password_reset",
          beforeJson: {
            role: target.role,
            isActive: target.isActive,
          },
          afterJson: {
            email: updated.email,
            fullName: updated.fullName,
            role: updated.role,
            isActive: updated.isActive,
            resetByAdmin: true,
          },
        },
      });
    }

    return jsonOk(updated);
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin access is required", 401);
    }

    console.error("[ADMIN_USERS_PATCH]", error);
    return jsonError("Unable to update user login", 400);
  }
}
