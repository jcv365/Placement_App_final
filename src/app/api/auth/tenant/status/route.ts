import { jsonOk } from "@/lib/apiResponses";
import { getAppSessionFromRequest } from "@/lib/appAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = getAppSessionFromRequest(request);
  if (!session) {
    return jsonOk({ authenticated: false });
  }

  const user = await prisma.tenantUser.findFirst({
    where: {
      id: session.uid,
      tenantId: session.tid,
      isActive: true,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
    },
  });

  if (!user) {
    return jsonOk({ authenticated: false });
  }

  return jsonOk({
    authenticated: true,
    tenantId: session.tid,
    user,
  });
}
