import { handleAuthError, jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { requireAuthenticatedTenantId } from "@/lib/tenant";
import { noteSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const body = noteSchema.parse(await request.json());
    const { id } = await context.params;

    const application = await prisma.application.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!application) {
      return jsonError("Application not found", 404);
    }

    const note = await prisma.note.create({
      data: {
        tenantId,
        applicationId: application.id,
        content: body.content,
        author: body.author,
      },
    });

    return jsonOk(note, { status: 201 });
  } catch (error) {
    return handleAuthError(error) ?? jsonError("Unable to add note", 400);
  }
}
