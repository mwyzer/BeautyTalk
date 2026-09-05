import type { Db, QueryResult } from "@beautyai/db";

export interface MembershipRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: string;
  status: string;
  tenant_name?: string;
  tenant_slug?: string;
}

function mapMembership(row: QueryResult<MembershipRow>["rows"][number]): MembershipRow {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    role: row.role,
    status: row.status,
    tenant_name: row.tenant_name,
    tenant_slug: row.tenant_slug,
  };
}

export async function createMembership(
  db: Db,
  input: { tenantId: string; userId: string; role: string; invitedBy?: string | null },
): Promise<MembershipRow> {
  const { rows } = await db.query<MembershipRow>(
    `INSERT INTO tenant_memberships (tenant_id, user_id, role, invited_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.tenantId, input.userId, input.role, input.invitedBy ?? null],
  );
  return mapMembership(rows[0]!);
}

export async function findActiveMemberships(
  db: Db,
  userId: string,
): Promise<Array<MembershipRow & { tenant_name: string; tenant_slug: string }>> {
  const { rows } = await db.query<
    MembershipRow & { tenant_name: string; tenant_slug: string }
  >(
    `SELECT m.*, t.name AS tenant_name, t.slug AS tenant_slug
     FROM tenant_memberships m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1 AND m.status = 'active'`,
    [userId],
  );
  return rows.map((r) => ({ ...mapMembership(r), tenant_name: r.tenant_name, tenant_slug: r.tenant_slug }));
}

export async function findActiveMembership(
  db: Db,
  userId: string,
  tenantId: string,
): Promise<MembershipRow | null> {
  const { rows } = await db.query<MembershipRow>(
    `SELECT * FROM tenant_memberships
     WHERE user_id = $1 AND tenant_id = $2 AND status = 'active'`,
    [userId, tenantId],
  );
  return rows[0] ? mapMembership(rows[0]) : null;
}

export interface MemberRow {
  id: string;
  userId: string;
  role: string;
  email: string;
  fullName: string | null;
  status: string;
}

export async function listMembersByTenant(db: Db, tenantId: string): Promise<MemberRow[]> {
  const { rows } = await db.query<MemberRow>(
    `SELECT m.id, m.user_id AS "userId", m.role, u.email, u.full_name AS "fullName", m.status
     FROM tenant_memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = $1
     ORDER BY m.created_at ASC`,
    [tenantId],
  );
  return rows;
}