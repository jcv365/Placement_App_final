import { prisma } from "@/lib/prisma";

/**
 * Write an audit log entry. Failures are logged but never block the request.
 */
export async function writeAuditLog(params: {
  tenantId: string;
  actor?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        actor: params.actor ?? undefined,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        beforeJson:
          params.before !== undefined
            ? JSON.parse(JSON.stringify(params.before))
            : undefined,
        afterJson:
          params.after !== undefined
            ? JSON.parse(JSON.stringify(params.after))
            : undefined,
      },
    });
  } catch (error) {
    console.error("[AUDIT_LOG]", error);
  }
}
