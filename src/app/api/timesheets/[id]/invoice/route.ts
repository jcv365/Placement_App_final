import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { invoiceCreateSchema, invoiceUpdateSchema } from "@/lib/validation";
import crypto from "crypto";

export const runtime = "nodejs";

function calculateInvoiceAmount(params: {
  hoursWorked: number;
  ratePerHour: number;
  engineerRatePerHour: number;
  agreedHourlyRate: number | null;
  billingModel: "PER_HOUR_PER_CANDIDATE" | "PERCENTAGE";
  billingRatePerHour: number;
  revenueSplitPercent: number;
  placementBillingModel: string | null;
  placementFeePercent: number | null;
  annualCtc: number | null;
  contractValue: number | null;
}): number {
  // Placement-level billing model takes precedence when set
  if (params.placementBillingModel) {
    switch (params.placementBillingModel) {
      case "EOR_MARGIN":
      case "INDEPENDENT_CONTRACTOR_MARGIN": {
        const contractRate = params.agreedHourlyRate ?? params.ratePerHour;
        const margin = contractRate - params.engineerRatePerHour;
        return margin * params.hoursWorked * (params.revenueSplitPercent / 100);
      }
      case "ONCE_OFF_PLACEMENT_FEE": {
        const cv = params.contractValue ?? 0;
        const pct = params.placementFeePercent ?? 0;
        return cv * (pct / 100);
      }
      case "PERMANENT_PLACEMENT_FEE": {
        const ctc = params.annualCtc ?? 0;
        const pct = params.placementFeePercent ?? 0;
        return ctc * (pct / 100);
      }
    }
  }

  // Fallback to company-level billing model
  if (params.billingModel === "PER_HOUR_PER_CANDIDATE") {
    const hourlyRate =
      params.billingRatePerHour > 0
        ? params.billingRatePerHour
        : (params.agreedHourlyRate ?? params.ratePerHour);
    return hourlyRate * params.hoursWorked;
  }

  const contractRate = params.agreedHourlyRate ?? params.ratePerHour;
  const margin = contractRate - params.engineerRatePerHour;
  return margin * params.hoursWorked * (params.revenueSplitPercent / 100);
}

function createInvoiceNumber(tenantId: string) {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `${tenantId}-INV-${datePart}-${randomPart}`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const { id } = await context.params;
    const body = invoiceCreateSchema.parse(await request.json());

    const timesheet = await prisma.timesheet.findFirst({
      where: { id, tenantId },
      include: {
        invoice: true,
        application: {
          select: {
            agreedHourlyRate: true,
            placementBillingModel: true,
            placementFeePercent: true,
            annualCtc: true,
            contractValue: true,
            job: {
              select: {
                company: {
                  select: {
                    settings: {
                      select: {
                        billingModel: true,
                        billingRatePerHour: true,
                        revenueSplitPercent: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!timesheet) {
      return jsonError("Timesheet not found", 404);
    }

    if (timesheet.invoice) {
      return jsonOk(timesheet.invoice);
    }

    const companySettings = timesheet.application.job.company?.settings;
    const rawAmount = calculateInvoiceAmount({
      hoursWorked: timesheet.hoursWorked,
      ratePerHour: timesheet.ratePerHour,
      engineerRatePerHour: timesheet.engineerRatePerHour,
      agreedHourlyRate: timesheet.application.agreedHourlyRate,
      billingModel: companySettings?.billingModel ?? "PERCENTAGE",
      billingRatePerHour: companySettings?.billingRatePerHour ?? 0,
      revenueSplitPercent: companySettings?.revenueSplitPercent ?? 50,
      placementBillingModel: timesheet.application.placementBillingModel,
      placementFeePercent: timesheet.application.placementFeePercent,
      annualCtc: timesheet.application.annualCtc,
      contractValue: timesheet.application.contractValue,
    });
    const amount = Math.round(rawAmount * 100) / 100;

    if (!isFinite(amount) || amount <= 0) {
      const contractRate =
        timesheet.application.agreedHourlyRate ?? timesheet.ratePerHour;
      if (contractRate <= timesheet.engineerRatePerHour) {
        return jsonError(
          `Invoice amount is invalid: contract rate (${contractRate}) must exceed engineer rate (${timesheet.engineerRatePerHour})`,
          400,
        );
      }
      return jsonError("Calculated invoice amount is invalid", 400);
    }

    const invoice = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          tenantId,
          timesheetId: timesheet.id,
          invoiceNumber: createInvoiceNumber(tenantId),
          amount,
          currency: timesheet.currency,
          dueDate: body.dueDate
            ? (() => {
                const d = new Date(body.dueDate);
                if (isNaN(d.getTime())) throw new Error("Invalid due date");
                return d;
              })()
            : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          status: "SENT",
          issuedAt: new Date(),
        },
      });

      await tx.timesheet.updateMany({
        where: { id: timesheet.id, tenantId },
        data: { status: "INVOICED" },
      });

      return inv;
    });

    return jsonOk(invoice, { status: 201 });
  } catch (error) {
    console.error("[INVOICE_CREATE]", error);
    return jsonError("Unable to generate invoice", 400);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const { id } = await context.params;
    const body = invoiceUpdateSchema.parse(await request.json());

    const timesheet = await prisma.timesheet.findFirst({
      where: { id, tenantId },
      select: { invoice: { select: { id: true } } },
    });

    if (!timesheet?.invoice?.id) {
      return jsonError("Invoice not found for timesheet", 404);
    }

    await prisma.invoice.updateMany({
      where: { id: timesheet.invoice.id, tenantId },
      data: {
        status: body.status,
        ...(body.status === "PAID" ? { paidAt: new Date() } : {}),
      },
    });

    const invoice = await prisma.invoice.findFirst({
      where: { id: timesheet.invoice.id, tenantId },
    });

    return jsonOk(invoice);
  } catch (error) {
    console.error("[INVOICE_UPDATE]", error);
    return jsonError("Unable to update invoice", 400);
  }
}
