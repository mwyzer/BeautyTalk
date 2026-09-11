import type { Db, DbPool } from "@beautyai/db";
import type { FraudConfig, FraudFlagDetails, FraudFlagStatus, FraudRule } from "@beautyai/shared";

export interface FraudFlagRow {
  id: string;
  tenant_id: string;
  order_id: string;
  customer_id: string | null;
  rules: string[];
  risk_score: number;
  status: string;
  details: FraudFlagDetails | null;
  notes: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  order_number: number;
  order_status: string;
  order_email: string | null;
  order_total_amount: number;
  order_currency: string;
  order_placed_at: Date;
  customer_email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface CandidateOrderRow {
  id: string;
  customer_id: string;
  status: string;
  placed_at: Date;
  customer_created_at: Date;
}

const FLAG_SELECT = `
  SELECT f.id, f.tenant_id, f.order_id, f.customer_id, f.rules, f.risk_score, f.status,
         f.details, f.notes, f.reviewed_by, f.reviewed_at, f.created_at,
         o.number::int AS order_number, o.status AS order_status, o.email AS order_email,
         o.total_amount AS order_total_amount, o.currency AS order_currency, o.placed_at AS order_placed_at,
         c.email AS customer_email, c.first_name, c.last_name
  FROM fraud_flags f
  JOIN orders o ON o.id = f.order_id AND o.tenant_id = f.tenant_id
  LEFT JOIN customers c ON c.id = f.customer_id`;

// ===== Rule config =====

export async function getFraudConfigRaw(db: Db, tenantId: string): Promise<FraudConfig | null> {
  const { rows } = await db.query<{ config: FraudConfig | null }>(
    "SELECT config FROM fraud_configs WHERE tenant_id = $1",
    [tenantId],
  );
  return rows[0]?.config ?? null;
}

export async function upsertFraudConfig(db: Db, tenantId: string, config: FraudConfig): Promise<void> {
  await db.query(
    `INSERT INTO fraud_configs (tenant_id, config, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (tenant_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
    [tenantId, JSON.stringify(config)],
  );
}

// ===== Scan =====

export async function listCandidateOrders(db: Db, tenantId: string, lookbackDays: number): Promise<CandidateOrderRow[]> {
  const { rows } = await db.query<CandidateOrderRow>(
    `SELECT o.id, o.customer_id, o.status, o.placed_at, c.created_at AS customer_created_at
     FROM orders o
     JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
     WHERE o.tenant_id = $1 AND o.customer_id IS NOT NULL
       AND o.placed_at >= now() - ($2::int * interval '1 day')
     ORDER BY o.placed_at ASC`,
    [tenantId, lookbackDays],
  );
  return rows;
}

export async function distinctCustomerAddressCounts(db: Db, tenantId: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ customer_id: string; n: string }>(
    `SELECT customer_id, count(DISTINCT (COALESCE(address1, '') || '|' || COALESCE(city, '') || '|' || COALESCE(zip, '') || '|' || COALESCE(country, '')))::text AS n
     FROM customer_addresses
     WHERE tenant_id = $1
     GROUP BY customer_id`,
    [tenantId],
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.customer_id, Number(r.n));
  return map;
}

export interface InsertFlagInput {
  orderId: string;
  customerId: string | null;
  rules: FraudRule[];
  riskScore: number;
  details: FraudFlagDetails;
}

export async function insertFraudFlags(db: DbPool, tenantId: string, flags: InsertFlagInput[]): Promise<number> {
  if (flags.length === 0) return 0;
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const f of flags) {
    values.push(tenantId, f.orderId, f.customerId, f.rules, f.riskScore, JSON.stringify(f.details));
    tuples.push(`($${values.length - 5}, $${values.length - 4}, $${values.length - 3}, $${values.length - 2}, $${values.length - 1}, $${values.length})`);
  }
  const { rowCount } = await db.query(
    `INSERT INTO fraud_flags (tenant_id, order_id, customer_id, rules, risk_score, details)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (tenant_id, order_id) DO NOTHING`,
    values,
  );
  return rowCount ?? 0;
}

// ===== Review queue =====

export async function listFraudFlags(
  db: Db,
  tenantId: string,
  opts: { status?: FraudFlagStatus; page?: number; limit?: number } = {},
): Promise<{ data: FraudFlagRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const clauses: string[] = ["f.tenant_id = $1"];
  const values: unknown[] = [tenantId];
  if (opts.status) {
    values.push(opts.status);
    clauses.push(`f.status = $${values.length}`);
  }
  const where = ` WHERE ${clauses.join(" AND ")}`;
  const { rows } = await db.query<FraudFlagRow>(
    `${FLAG_SELECT}${where} ORDER BY f.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    values,
  );
  const count = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text n FROM fraud_flags f${where}`,
    values,
  );
  return { data: rows, total: Number(count.rows[0]?.n ?? 0) };
}

export async function findFraudFlagById(db: Db, tenantId: string, flagId: string): Promise<FraudFlagRow | null> {
  const { rows } = await db.query<FraudFlagRow>(
    `${FLAG_SELECT} WHERE f.tenant_id = $1 AND f.id = $2`,
    [tenantId, flagId],
  );
  return rows[0] ?? null;
}

export async function fraudOverview(db: Db, tenantId: string): Promise<{ open: number; cleared: number; blocked: number; total: number }> {
  const { rows } = await db.query<{ status: string; n: string }>(
    "SELECT status, COUNT(*)::text n FROM fraud_flags WHERE tenant_id = $1 GROUP BY status",
    [tenantId],
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = Number(r.n);
  const { rows: totalRows } = await db.query<{ n: string }>(
    "SELECT COUNT(*)::text n FROM fraud_flags WHERE tenant_id = $1",
    [tenantId],
  );
  const total = Number(totalRows[0]?.n ?? 0);
  return { open: counts.open ?? 0, cleared: counts.cleared ?? 0, blocked: counts.blocked ?? 0, total };
}

export async function setFraudFlagStatus(
  db: Db,
  tenantId: string,
  flagId: string,
  status: FraudFlagStatus,
  actorId: string,
  notes?: string | null,
): Promise<FraudFlagRow | null> {
  await db.query(
    `UPDATE fraud_flags
     SET status = $1, reviewed_by = $3, reviewed_at = now(),
         notes = CASE WHEN $4::text IS NULL THEN notes ELSE $4 END
     WHERE tenant_id = $2 AND id = $5`,
    [status, tenantId, actorId, notes ?? null, flagId],
  );
  return findFraudFlagById(db, tenantId, flagId);
}