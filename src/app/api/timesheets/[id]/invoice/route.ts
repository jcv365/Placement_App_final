import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { invoiceCreateSchema, invoiceUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

function createInvoiceNumber(tenantId: string) {
  const timestamp = Date.now().toString().slice(-8);
  return `${tenantId}-INV-${timestamp}`;
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
      include: { invoice: true },
    });

    if (!timesheet) {
      return jsonError("Timesheet not found", 404);
    }

    if (timesheet.invoice) {
      return jsonOk(timesheet.invoice);
    }

    const amount = Number(
      (timesheet.hoursWorked * timesheet.ratePerHour).toFixed(2),
    );

    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        timesheetId: timesheet.id,
        invoiceNumber: createInvoiceNumber(tenantId),
        amount,
        currency: timesheet.currency,
        dueDate: body.dueDate
          ? new Date(body.dueDate)
          : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        status: "SENT",
        issuedAt: new Date(),
      },
    });

    await prisma.timesheet.updateMany({
      where: { id: timesheet.id, tenantId },
      data: { status: "INVOICED" },
    });

    return jsonOk(invoice, { status: 201 });
  } catch (error) {
    return jsonError("Unable to generate invoice", 400, {
      message: (error as Error).message,
    });
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
        paidAt: body.status === "PAID" ? new Date() : null,
      },
    });

    const invoice = await prisma.invoice.findFirst({
      where: { id: timesheet.invoice.id, tenantId },
    });

    return jsonOk(invoice);
  } catch (error) {
    return jsonError("Unable to update invoice", 400, {
      message: (error as Error).message,
    });
  }
}
