import {
    isSuperAdminRequest,
    requireAdminContextFromRequest,
} from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const createCommentSchema = z.object({
  body: z.string().trim().min(2).max(4000),
});

type Params = {
  params: Promise<{ ticketId: string }>;
};

export async function POST(request: Request, { params }: Params) {
  try {
    const { tenantId, username } = requireAdminContextFromRequest(request);
    const isSuperAdmin = isSuperAdminRequest(request);
    const { ticketId } = await params;
    const body = createCommentSchema.parse(await request.json());

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, tenantId: true },
    });

    if (!ticket) {
      return jsonError("Support ticket not found", 404);
    }

    if (!isSuperAdmin && ticket.tenantId !== tenantId) {
      return jsonError("Support ticket not found for this tenant", 404);
    }

    await prisma.supportTicketComment.create({
      data: {
        ticketId,
        tenantId: ticket.tenantId,
        author: username,
        body: body.body,
      },
    });

    if (isSuperAdmin) {
      const existing = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        select: { firstResponseAt: true },
      });

      if (!existing?.firstResponseAt) {
        await prisma.supportTicket.update({
          where: { id: ticketId },
          data: { firstResponseAt: new Date(), status: "IN_PROGRESS" },
        });
      }
    }

    return jsonOk({ ticketId });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to add support ticket comment", 400, { message });
  }
}
