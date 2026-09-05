import type { Db, QueryResult } from "@beautyai/db";

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  tenant_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

function mapToken(row: QueryResult<RefreshTokenRow>["rows"][number]): RefreshTokenRow {
  return {
    id: row.id,
    user_id: row.user_id,
    tenant_id: row.tenant_id,
    token_hash: row.token_hash,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
  };
}

export async function createRefreshToken(
  db: Db,
  input: { userId: string; tenantId: string; tokenHash: string; expiresAt: Date },
): Promise<RefreshTokenRow> {
  const { rows } = await db.query<RefreshTokenRow>(
    `INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.userId, input.tenantId, input.tokenHash, input.expiresAt],
  );
  return mapToken(rows[0]!);
}

export async function findValidToken(db: Db, tokenHash: string, now: Date): Promise<RefreshTokenRow | null> {
  const { rows } = await db.query<RefreshTokenRow>(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
    [tokenHash, now],
  );
  return rows[0] ? mapToken(rows[0]) : null;
}

export async function revokeToken(db: Db, id: string, now: Date): Promise<void> {
  await db.query("UPDATE refresh_tokens SET revoked_at = $1 WHERE id = $2", [now, id]);
}

export async function revokeAllForUser(db: Db, userId: string, tenantId: string, now: Date): Promise<void> {
  await db.query(
    "UPDATE refresh_tokens SET revoked_at = $1 WHERE user_id = $2 AND tenant_id = $3 AND revoked_at IS NULL",
    [now, userId, tenantId],
  );
}