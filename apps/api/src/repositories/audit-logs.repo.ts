import type { Db } from "@beautyai/db";

export interface AuditLogInput {
  tenantId: string;
  userId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
}

export async function writeAuditLog(db: Db, input: AuditLogInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, before, after, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.tenantId,
      input.userId ?? null,
      input.action,
      input.resourceType ?? null,
      input.resourceId ?? null,
      input.before ?? null,
      input.after ?? null,
      input.ip ?? null,
    ],
  );
}