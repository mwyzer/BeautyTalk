import { createPool, runMigrations, type DbPool } from "@beautyai/db";
import { createApp } from "../app.js";
import { createConfig, type AppConfig } from "../config/env.js";
import type { ContentProvider } from "../content/types.js";

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  const url = testDatabaseUrl();
  return createConfig({
    DATABASE_URL: url,
    NODE_ENV: "test",
    JWT_ACCESS_SECRET: "test_access_secret_at_least_16_chars",
    JWT_REFRESH_SECRET: "test_refresh_secret_at_least_16_chars",
    STRIPE_WEBHOOK_SECRET: "whsec_test_webhook_secret",
    ...overrides,
  });
}

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_TEST is required for integration tests");
  return url;
}

export async function setupTestDb(): Promise<DbPool> {
  const db = createPool({ connectionString: testDatabaseUrl(), max: 4 });
  await runMigrations(db, () => {});
  await truncateAll(db);
  return db;
}

export async function truncateAll(db: DbPool): Promise<void> {
  const { rows } = await db.query<{ name: string }>(
    `SELECT tablename AS name
     FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.name}"`).join(", ");
  await db.query(`TRUNCATE TABLE ${tables} CASCADE`);
}

export function makeTestApp(db: DbPool, overrides: Record<string, string> = {}): { app: ReturnType<typeof createApp>; config: AppConfig } {
  return makeTestAppWith(db, overrides);
}

export function makeTestAppWith(db: DbPool, overrides: Record<string, string> = {}, provider?: ContentProvider | null): { app: ReturnType<typeof createApp>; config: AppConfig } {
  const config = testConfig(overrides);
  return { app: createApp({ db, config, contentProvider: provider }), config };
}