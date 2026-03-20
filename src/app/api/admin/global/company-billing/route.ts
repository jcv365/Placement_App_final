import { requireSuperAdminFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const updateCompanyBillingSchema = z
  .object({
    companyId: z.string().min(1),
    billingModel: z.enum(["PER_HOUR_PER_CANDIDATE", "PERCENTAGE"]),
    billingRatePerHour: z.number().min(0).optional(),
    revenueSplitPercent: z.number().min(0).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.billingModel === "PER_HOUR_PER_CANDIDATE" &&
      (value.billingRatePerHour === undefined || value.billingRatePerHour <= 0)
    ) {
      ctx.addIssue({
        path: ["billingRatePerHour"],
        code: z.ZodIssueCode.custom,
        message:
          "billingRatePerHour must be greater than 0 for per-hour billing",
      });
    }

    if (
      value.billingModel === "PERCENTAGE" &&
      (value.revenueSplitPercent === undefined ||
        value.revenueSplitPercent < 0 ||
        value.revenueSplitPercent > 100)
    ) {
      ctx.addIssue({
        path: ["revenueSplitPercent"],
        code: z.ZodIssueCode.custom,
        message:
          "revenueSplitPercent must be provided between 0 and 100 for percentage billing",
      });
    }
  });

export async function PATCH(request: Request) {
  try {
    requireSuperAdminFromRequest(request);

    const body = updateCompanyBillingSchema.parse(await request.json());

    const company = await prisma.company.findUnique({
      where: {
        id: body.companyId,
      },
      select: {
        id: true,
      },
    });

    if (!company) {
      return jsonError("Company not found", 404);
    }

    const updated = await prisma.companySettings.upsert({
      where: {
        companyId: company.id,
      },
      create: {
        companyId: company.id,
        billingModel: body.billingModel,
        billingRatePerHour:
          body.billingModel === "PER_HOUR_PER_CANDIDATE"
            ? (body.billingRatePerHour ?? 0)
            : 0,
        revenueSplitPercent:
          body.billingModel === "PERCENTAGE"
            ? (body.revenueSplitPercent ?? 50)
            : 0,
      },
      update: {
        billingModel: body.billingModel,
        billingRatePerHour:
          body.billingModel === "PER_HOUR_PER_CANDIDATE"
            ? (body.billingRatePerHour ?? 0)
            : 0,
        revenueSplitPercent:
          body.billingModel === "PERCENTAGE"
            ? (body.revenueSplitPercent ?? 50)
            : 0,
      },
      select: {
        companyId: true,
        billingModel: true,
        billingRatePerHour: true,
        revenueSplitPercent: true,
      },
    });

    return jsonOk(updated);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    if (message === "FORBIDDEN_SUPER_ADMIN") {
      return jsonError("Super admin access is required", 403);
    }

    return jsonError("Unable to update company billing", 400, {
      message,
    });
  }
}
