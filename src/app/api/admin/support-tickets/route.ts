import {
    isSuperAdminRequest,
    requireAdminContextFromRequest,
} from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const createSupportTicketSchema = z.object({
  companyId: z.string().min(1).optional(),
  category: z.enum(["USER_ACCESS", "ADMIN_ACCESS", "BILLING", "SUPPORT"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  subject: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(4000),
});

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function getSlaWindows(priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"): {
  responseHours: number;
  resolutionHours: number;
} {
  switch (priority) {
    case "URGENT":
      return { responseHours: 1, resolutionHours: 8 };
    case "HIGH":
      return { responseHours: 4, resolutionHours: 24 };
    case "MEDIUM":
      return { responseHours: 8, resolutionHours: 48 };
    case "LOW":
    default:
      return { responseHours: 24, resolutionHours: 120 };
  }
}

export async function GET(request: Request) {
  try {
    const { tenantId } = requireAdminContextFromRequest(request);
    const isSuperAdmin = isSuperAdminRequest(request);

    const tickets = await prisma.supportTicket.findMany({
      where: isSuperAdmin ? undefined : { tenantId },
      include: {
        company: {
          select: {
            id: true,
            name: true,
          },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            author: true,
            body: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 300,
    });

    const tenantIds = Array.from(
      new Set(tickets.map((ticket) => ticket.tenantId)),
    );
    const tenants = tenantIds.length
      ? await prisma.tenant.findMany({
          where: { tenantId: { in: tenantIds } },
          select: { tenantId: true, displayName: true },
        })
      : [];

    const tenantNameById = new Map(
      tenants.map((tenant) => [tenant.tenantId, tenant.displayName]),
    );

    return jsonOk({
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        tenantId: ticket.tenantId,
        tenantDisplayName:
          tenantNameById.get(ticket.tenantId) ?? ticket.tenantId,
        companyId: ticket.companyId,
        companyName: ticket.company?.name ?? null,
        category: ticket.category,
        priority: ticket.priority,
        subject: ticket.subject,
        description: ticket.description,
        status: ticket.status,
        createdBy: ticket.createdBy,
        assignedTo: ticket.assignedTo,
        slaResponseDueAt: ticket.slaResponseDueAt,
        slaResolutionDueAt: ticket.slaResolutionDueAt,
        firstResponseAt: ticket.firstResponseAt,
        responseSlaBreached:
          !ticket.firstResponseAt &&
          ticket.status !== "RESOLVED" &&
          ticket.status !== "CLOSED" &&
          ticket.slaResponseDueAt !== null &&
          new Date(ticket.slaResponseDueAt).getTime() < Date.now(),
        resolutionSlaBreached:
          ticket.status !== "RESOLVED" &&
          ticket.status !== "CLOSED" &&
          ticket.slaResolutionDueAt !== null &&
          new Date(ticket.slaResolutionDueAt).getTime() < Date.now(),
        resolutionNotes: ticket.resolutionNotes,
        resolvedAt: ticket.resolvedAt,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        comments: ticket.comments,
      })),
    });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to load support tickets", 400, { message });
  }
}

export async function POST(request: Request) {
  try {
    const { username, tenantId } = requireAdminContextFromRequest(request);
    const body = createSupportTicketSchema.parse(await request.json());
    const now = new Date();
    const sla = getSlaWindows(body.priority);

    if (body.companyId) {
      const company = await prisma.company.findFirst({
        where: {
          id: body.companyId,
          tenantId,
        },
        select: {
          id: true,
        },
      });

      if (!company) {
        return jsonError("Company not found for this tenant", 404);
      }
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        tenantId,
        companyId: body.companyId,
        category: body.category,
        priority: body.priority,
        subject: body.subject,
        description: body.description,
        createdBy: username,
        slaResponseDueAt: addHours(now, sla.responseHours),
        slaResolutionDueAt: addHours(now, sla.resolutionHours),
      },
      select: {
        id: true,
      },
    });

    return jsonOk({ ticketId: ticket.id });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to create support ticket", 400, { message });
  }
}
