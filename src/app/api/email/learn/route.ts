import { handleAuthError, jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { requireAuthenticatedTenantId } from "@/lib/tenant";
import { emailLearningSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const tenantId = requireAuthenticatedTenantId(request);
    const body = emailLearningSchema.parse(await request.json());

    const draft = await prisma.emailDraft.findFirst({
      where: { id: body.emailDraftId, tenantId },
    });

    if (!draft) {
      return jsonError("Email draft not found", 404);
    }

    await prisma.emailDraft.updateMany({
      where: { id: draft.id, tenantId },
      data: {
        preferredForLearning: body.preferredForLearning ?? true,
      },
    });

    const updated = await prisma.emailDraft.findFirst({
      where: { id: draft.id, tenantId },
    });

    return jsonOk(updated);
  } catch (error) {
    return (
      handleAuthError(error) ??
      jsonError("Unable to update learning preference", 400)
    );
  }
}
