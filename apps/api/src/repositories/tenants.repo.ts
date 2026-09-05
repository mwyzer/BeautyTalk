import type { Db, QueryResult } from "@beautyai/db";

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  custom_domain: string | null;
  currency: string;
  locale: string;
  status: string;
  logo_url: string | null;
  trial_ends_at: Date | null;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function mapTenant(row: QueryResult<TenantRow>["rows"][number]): TenantRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    custom_domain: row.custom_domain,
    currency: row.currency,
    locale: row.locale,
    status: row.status,
    logo_url: row.logo_url,
    trial_ends_at: row.trial_ends_at,
    settings: row.settings,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createTenant(
  db: Db,
  input: { name: string; slug: string; currency?: string; locale?: string },
): Promise<TenantRow> {
  const { rows } = await db.query<TenantRow>(
    `INSERT INTO tenants (name, slug, currency, locale)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.name, input.slug, input.currency ?? "usd", input.locale ?? "en"],
  );
  return mapTenant(rows[0]!);
}

export async function findTenantById(db: Db, id: string): Promise<TenantRow | null> {
  const { rows } = await db.query<TenantRow>("SELECT * FROM tenants WHERE id = $1", [id]);
  return rows[0] ? mapTenant(rows[0]) : null;
}

export async function findTenantBySlug(db: Db, slug: string): Promise<TenantRow | null> {
  const { rows } = await db.query<TenantRow>("SELECT * FROM tenants WHERE slug = $1", [slug]);
  return rows[0] ? mapTenant(rows[0]) : null;
}