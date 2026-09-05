import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Db, type DbPool } from "./pool.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const MIGRATION_LOCK_KEY = 0xbe471010;

export async function withMigrationLock<T>(db: DbPool, fn: () => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

export async function ensureMigrationsTable(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function listPendingMigrations(db: Db): Promise<string[]> {
  await ensureMigrationsTable(db);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) return [];

  const { rows } = await db.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations WHERE filename = ANY($1)",
    [files],
  );
  const applied = new Set(rows.map((r) => r.filename));
  return files.filter((f) => !applied.has(f));
}

export async function runMigrations(db: DbPool, log: (msg: string) => void = console.log): Promise<string[]> {
  return withMigrationLock(db, async () => {
    const pending = await listPendingMigrations(db);
    for (const file of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query("COMMIT");
        log(`applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration failed: ${file}\n${(err as Error).message}`, { cause: err });
      } finally {
        client.release();
      }
    }
    return pending;
  });
}

export async function resetMigrations(db: DbPool, log: (msg: string) => void = console.log): Promise<void> {
  await withMigrationLock(db, async () => {
    const client = await db.connect();
    try {
      await client.query(
        "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;",
      );
    } finally {
      client.release();
    }
  });
  log("dropped and recreated public schema");
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_TEST;
  if (!connectionString) {
    console.error("DATABASE_URL or DATABASE_URL_TEST is required");
    process.exitCode = 1;
    return;
  }
  const db = createPool({ connectionString });
  try {
    const applied = await runMigrations(db);
    if (applied.length === 0) console.log("migrations up to date");
  } finally {
    await db.end();
  }
}

if (process.argv[1] && import.meta.url.startsWith("file:")) {
  const entry = fileURLToPath(import.meta.url);
  if (process.argv[1].endsWith("migrate.ts") || entry === process.argv[1].replace(/\\/g, "/")) {
    void main();
  }
}