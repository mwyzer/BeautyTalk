import type { Db, QueryResult } from "@beautyai/db";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  full_name: string | null;
  status: string;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapUser(row: QueryResult<UserRow>["rows"][number]): UserRow {
  return {
    id: row.id,
    email: row.email,
    password_hash: row.password_hash,
    full_name: row.full_name,
    status: row.status,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function findByEmail(db: Db, email: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findById(db: Db, id: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function createUser(
  db: Db,
  input: { email: string; passwordHash: string | null; fullName: string | null },
): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.email, input.passwordHash, input.fullName],
  );
  return mapUser(rows[0]!);
}

export async function updateLastLogin(db: Db, id: string): Promise<void> {
  await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [id]);
}

export async function setPassword(db: Db, id: string, passwordHash: string): Promise<void> {
  await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, id]);
}