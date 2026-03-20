import { requireSuperAdminFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { hashPassword } from "@/lib/appAuth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const createCompanyAdminSchema = z.object({
  tenantId: z.string().trim().min(2).max(63),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(120),
});

const removeCompanyAdminSchema = z.object({
  userId: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    requireSuperAdminFromRequest(request);

    const admins = await prisma.tenantUser.findMany({
      where: {
        role: "ADMIN",
        isActive: true,
      },
      orderBy: [{ tenantId: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        tenantId: true,
        fullName: true,
        email: true,
        createdAt: true,
      },
    });

    return jsonOk({ admins });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    if (message === "FORBIDDEN_SUPER_ADMIN") {
      return jsonError("Super admin access is required", 403);
    }

    return jsonError("Unable to load company admins", 400, {
      message,
    });
  }
}

export async function POST(request: Request) {
  try {
    requireSuperAdminFromRequest(request);

    const body = createCompanyAdminSchema.parse(await request.json());
    const tenantId = body.tenantId.toLowerCase();
    const email = body.email.toLowerCase();

    const tenant = await prisma.tenant.findUnique({
      where: { tenantId },
      select: { tenantId: true },
    });

    if (!tenant) {
      return jsonError("Tenant not found", 404);
    }

    const existing = await prisma.tenantUser.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email,
        },
      },
      select: { id: true, role: true, isActive: true },
    });

    const passwordHash = await hashPassword(body.password);

    if (existing) {
      const updated = await prisma.tenantUser.update({
        where: { id: existing.id },
        data: {
          fullName: body.fullName,
          role: "ADMIN",
          isActive: true,
          passwordHash,
        },
        select: {
          id: true,
          tenantId: true,
          fullName: true,
          email: true,
          role: true,
          isActive: true,
        },
      });

      return jsonOk(updated);
    }

    const created = await prisma.tenantUser.create({
      data: {
        tenantId,
        fullName: body.fullName,
        email,
        passwordHash,
        role: "ADMIN",
        isActive: true,
      },
      select: {
        id: true,
        tenantId: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    return jsonOk(created, { status: 201 });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    if (message === "FORBIDDEN_SUPER_ADMIN") {
      return jsonError("Super admin access is required", 403);
    }

    return jsonError("Unable to add company admin", 400, {
      message,
    });
  }
}

export async function DELETE(request: Request) {
  try {
    requireSuperAdminFromRequest(request);

    const body = removeCompanyAdminSchema.parse(await request.json());

    const target = await prisma.tenantUser.findUnique({
      where: { id: body.userId },
      select: {
        id: true,
        tenantId: true,
        role: true,
        isActive: true,
      },
    });

    if (!target || target.role !== "ADMIN" || !target.isActive) {
      return jsonError("Active admin user not found", 404);
    }

    const remainingAdmins = await prisma.tenantUser.count({
      where: {
        tenantId: target.tenantId,
        role: "ADMIN",
        isActive: true,
      },
    });

    if (remainingAdmins <= 1) {
      return jsonError(
        "Cannot remove the last active admin from a company",
        409,
      );
    }

    await prisma.tenantUser.update({
      where: { id: target.id },
      data: {
        isActive: false,
      },
    });

    return jsonOk({ removed: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    if (message === "FORBIDDEN_SUPER_ADMIN") {
      return jsonError("Super admin access is required", 403);
    }

    return jsonError("Unable to remove company admin", 400, {
      message,
    });
  }
}
