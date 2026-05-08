import {
  isSuperAdminRequest,
  requireAdminContextFromRequest,
} from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const updateSupportTicketSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  assignedTo: z.string().trim().max(120).nullable().optional(),
  slaResponseDueAt: z.string().datetime().nullable().optional(),
  slaResolutionDueAt: z.string().datetime().nullable().optional(),
  resolutionNotes: z.string().trim().max(4000).optional(),
});

type Params = {
  params: Promise<{ ticketId: string }>;
};

export async function PATCH(request: Request, { params }: Params) {
  try {
    requireAdminContextFromRequest(request);
    if (!isSuperAdminRequest(request)) {
      return jsonError("Super admin access is required", 403);
    }

    const { ticketId } = await params;
    const body = updateSupportTicketSchema.parse(await request.json());

    const existing = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, firstResponseAt: true },
    });

    if (!existing) {
      return jsonError("Support ticket not found", 404);
    }

    const nextStatus = body.status;
    const resolvedAt =
      nextStatus === "RESOLVED" || nextStatus === "CLOSED"
        ? new Date()
        : nextStatus
          ? null
          : undefined;

    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: nextStatus,
        assignedTo:
          body.assignedTo !== undefined
            ? body.assignedTo
              ? body.assignedTo.trim() || null
              : null
            : undefined,
        resolutionNotes:
          body.resolutionNotes !== undefined
            ? body.resolutionNotes.trim() || null
            : undefined,
        slaResponseDueAt:
          body.slaResponseDueAt !== undefined
            ? body.slaResponseDueAt
              ? new Date(body.slaResponseDueAt)
              : null
            : undefined,
        slaResolutionDueAt:
          body.slaResolutionDueAt !== undefined
            ? body.slaResolutionDueAt
              ? new Date(body.slaResolutionDueAt)
              : null
            : undefined,
        firstResponseAt:
          !existing.firstResponseAt &&
          (nextStatus === "IN_PROGRESS" ||
            nextStatus === "RESOLVED" ||
            nextStatus === "CLOSED")
            ? new Date()
            : undefined,
        resolvedAt,
      },
    });

    return jsonOk({ ticketId });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to update support ticket", 400);
  }
}
