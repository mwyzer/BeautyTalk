import type { Db, Queryable } from "@beautyai/db";
import type { AdsRow, AnalyticsConnection, AnalyticsProvider, AnalyticsSync, Ga4Row, GscRow, SyncStatus } from "@beautyai/shared";

interface ConnectionRow {
  id: string;
  tenant_id: string;
  provider: string;
  account_id: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: string;
  last_sync_at: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function toConnection(row: ConnectionRow): AnalyticsConnection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider as AnalyticsProvider,
    accountId: row.account_id,
    status: row.status,
    lastSyncAt: row.last_sync_at,
    settings: row.settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface SyncRow {
  id: string;
  tenant_id: string;
  provider: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  records_processed: number;
  error: string | null;
}

function toSync(row: SyncRow): AnalyticsSync {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider as AnalyticsProvider,
    status: row.status as SyncStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    recordsProcessed: row.records_processed,
    error: row.error,
  };
}

export interface StoredConnection extends AnalyticsConnection {
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenExpiresAt: string | null;
}

// ===== Connections =====

export async function upsertConnection(
  db: Queryable,
  input: {
    tenantId: string;
    provider: AnalyticsProvider;
    accountId: string | null;
    accessTokenEnc: string | null;
    refreshTokenEnc: string | null;
    tokenExpiresAt: string | null;
    status: string;
    settings: Record<string, unknown>;
  },
): Promise<StoredConnection> {
  const { rows } = await db.query<ConnectionRow>(
    `INSERT INTO analytics_connections (
       tenant_id, provider, account_id, access_token_enc, refresh_token_enc,
       token_expires_at, status, settings
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       account_id = COALESCE(EXCLUDED.account_id, analytics_connections.account_id),
       access_token_enc = COALESCE(EXCLUDED.access_token_enc, analytics_connections.access_token_enc),
       refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, analytics_connections.refresh_token_enc),
       token_expires_at = COALESCE(EXCLUDED.token_expires_at, analytics_connections.token_expires_at),
       status = EXCLUDED.status,
       settings = EXCLUDED.settings,
       updated_at = now()
     RETURNING *`,
    [
      input.tenantId,
      input.provider,
      input.accountId,
      input.accessTokenEnc,
      input.refreshTokenEnc,
      input.tokenExpiresAt,
      input.status,
      JSON.stringify(input.settings),
    ],
  );
  return toStoredConnection(rows[0]!);
}

function toStoredConnection(row: ConnectionRow): StoredConnection {
  return {
    ...toConnection(row),
    accessTokenEnc: row.access_token_enc,
    refreshTokenEnc: row.refresh_token_enc,
    tokenExpiresAt: row.token_expires_at,
  };
}

export async function findConnection(db: Db, tenantId: string, provider: AnalyticsProvider): Promise<StoredConnection | null> {
  const { rows } = await db.query<ConnectionRow>(`SELECT * FROM analytics_connections WHERE tenant_id = $1 AND provider = $2`, [tenantId, provider]);
  return rows[0] ? toStoredConnection(rows[0]) : null;
}

export async function findConnectionById(db: Db, tenantId: string, id: string): Promise<StoredConnection | null> {
  const { rows } = await db.query<ConnectionRow>(`SELECT * FROM analytics_connections WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return rows[0] ? toStoredConnection(rows[0]) : null;
}

export async function listConnections(db: Db, tenantId: string): Promise<AnalyticsConnection[]> {
  const { rows } = await db.query<ConnectionRow>(
    `SELECT * FROM analytics_connections WHERE tenant_id = $1 ORDER BY provider`,
    [tenantId],
  );
  return rows.map(toConnection);
}

export async function deleteConnection(db: Db, tenantId: string, id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM analytics_connections WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return (rowCount ?? 0) > 0;
}

export async function setConnectionLastSync(db: Queryable, tenantId: string, id: string, at: string): Promise<void> {
  await db.query(
    `UPDATE analytics_connections SET last_sync_at = $3, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, at],
  );
}

export async function setConnectionTokens(
  db: Queryable,
  input: { tenantId: string; id: string; accessTokenEnc: string | null; tokenExpiresAt: string | null; refreshTokenEnc?: string | null },
): Promise<void> {
  const { rows } = await db.query(
    `UPDATE analytics_connections SET
       access_token_enc = COALESCE($3, access_token_enc),
       token_expires_at = $4,
       refresh_token_enc = COALESCE($5, refresh_token_enc),
       updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, input.id, input.accessTokenEnc, input.tokenExpiresAt, input.refreshTokenEnc ?? null],
  );
  void rows;
}

export async function latestAnalyticsDate(db: Db, tenantId: string, provider: AnalyticsProvider): Promise<string | null> {
  const table = providerTable(provider);
  const { rows } = await db.query<{ d: string | null }>(`SELECT max(date)::text AS d FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  return rows[0]?.d ?? null;
}

function providerTable(provider: AnalyticsProvider): string {
  switch (provider) {
    case "gsc":
      return "gsc_data";
    case "ga4":
      return "ga4_data";
    case "ads":
      return "ads_data";
  }
}

// ===== Sync runs =====

export async function startSync(db: Queryable, tenantId: string, provider: AnalyticsProvider): Promise<AnalyticsSync> {
  const { rows } = await db.query<SyncRow>(
    `INSERT INTO analytics_syncs (tenant_id, provider, status, started_at)
     VALUES ($1, $2, 'running', now())
     RETURNING *`,
    [tenantId, provider],
  );
  return toSync(rows[0]!);
}

export async function finishSync(
  db: Queryable,
  syncId: string,
  input: { recordsProcessed: number; error?: string },
): Promise<AnalyticsSync> {
  const { rows } = await db.query<SyncRow>(
    `UPDATE analytics_syncs SET
       status = $2, finished_at = now(),
       records_processed = $3, error = $4
     WHERE id = $1
     RETURNING *`,
    [syncId, input.error ? "failed" : "completed", input.recordsProcessed, input.error ?? null],
  );
  return toSync(rows[0]!);
}

export async function listSyncs(db: Db, tenantId: string, input: { page: number; limit: number }): Promise<{ data: AnalyticsSync[]; total: number }> {
  const offset = (input.page - 1) * input.limit;
  const { rows } = await db.query<SyncRow>(
    `SELECT * FROM analytics_syncs WHERE tenant_id = $1
     ORDER BY started_at DESC
     LIMIT $2 OFFSET $3`,
    [tenantId, input.limit, offset],
  );
  const { rows: count } = await db.query<{ c: string }>(`SELECT count(*)::text AS c FROM analytics_syncs WHERE tenant_id = $1`, [tenantId]);
  return { data: rows.map(toSync), total: Number(count[0]?.c ?? 0) };
}

// ===== Data upserts =====

interface GscField {
  date: string;
  query: string;
  page: string;
  country: string;
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Ga4Field {
  date: string;
  source: string;
  medium: string;
  campaign: string;
  landingPage: string;
  sessions: number;
  users: number;
  newUsers: number;
  engagementRate: number;
  conversions: number;
  revenueAmount: number;
}

interface AdsField {
  date: string;
  campaignId: string;
  campaignName: string;
  adGroup: string;
  keyword: string;
  clicks: number;
  impressions: number;
  costMicros: number;
  conversions: number;
  conversionValueMicros: number;
}

export async function replaceGscRows(db: Queryable, tenantId: string, rows: GscField[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO gsc_data (tenant_id, date, query, page, country, device, clicks, impressions, ctr, position)
     SELECT $1, * FROM UNNEST(
       $2::date[], $3::text[], $4::text[], $5::text[], $6::text[],
       $7::int[], $8::int[], $9::numeric[], $10::numeric[]
     )
     ON CONFLICT (tenant_id, date, query, page, country, device) DO UPDATE SET
       clicks = EXCLUDED.clicks,
       impressions = EXCLUDED.impressions,
       ctr = EXCLUDED.ctr,
       position = EXCLUDED.position,
       updated_at = now()`,
    [
      tenantId,
      rows.map((r) => r.date),
      rows.map((r) => r.query),
      rows.map((r) => r.page),
      rows.map((r) => r.country),
      rows.map((r) => r.device),
      rows.map((r) => r.clicks),
      rows.map((r) => r.impressions),
      rows.map((r) => r.ctr),
      rows.map((r) => r.position),
    ],
  );
  return rowCount ?? 0;
}

export async function replaceGa4Rows(db: Queryable, tenantId: string, rows: Ga4Field[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO ga4_data (tenant_id, date, source, medium, campaign, landing_page, sessions, users, new_users, engagement_rate, conversions, revenue_amount)
     SELECT $1, * FROM UNNEST(
       $2::date[], $3::text[], $4::text[], $5::text[], $6::text[],
       $7::int[], $8::int[], $9::int[], $10::numeric[], $11::int[], $12::int[]
     )
     ON CONFLICT (tenant_id, date, source, medium, campaign, landing_page) DO UPDATE SET
       sessions = EXCLUDED.sessions,
       users = EXCLUDED.users,
       new_users = EXCLUDED.new_users,
       engagement_rate = EXCLUDED.engagement_rate,
       conversions = EXCLUDED.conversions,
       revenue_amount = EXCLUDED.revenue_amount,
       updated_at = now()`,
    [
      tenantId,
      rows.map((r) => r.date),
      rows.map((r) => r.source),
      rows.map((r) => r.medium),
      rows.map((r) => r.campaign),
      rows.map((r) => r.landingPage),
      rows.map((r) => r.sessions),
      rows.map((r) => r.users),
      rows.map((r) => r.newUsers),
      rows.map((r) => r.engagementRate),
      rows.map((r) => r.conversions),
      rows.map((r) => r.revenueAmount),
    ],
  );
  return rowCount ?? 0;
}

export async function replaceAdsRows(db: Queryable, tenantId: string, rows: AdsField[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO ads_data (tenant_id, date, campaign_id, campaign_name, ad_group, keyword, clicks, impressions, cost_micros, conversions, conversion_value_micros)
     SELECT $1, * FROM UNNEST(
       $2::date[], $3::text[], $4::text[], $5::text[], $6::text[],
       $7::int[], $8::int[], $9::bigint[], $10::int[], $11::bigint[]
     )
     ON CONFLICT (tenant_id, date, campaign_id, ad_group, keyword) DO UPDATE SET
       campaign_name = EXCLUDED.campaign_name,
       clicks = EXCLUDED.clicks,
       impressions = EXCLUDED.impressions,
       cost_micros = EXCLUDED.cost_micros,
       conversions = EXCLUDED.conversions,
       conversion_value_micros = EXCLUDED.conversion_value_micros,
       updated_at = now()`,
    [
      tenantId,
      rows.map((r) => r.date),
      rows.map((r) => r.campaignId),
      rows.map((r) => r.campaignName),
      rows.map((r) => r.adGroup),
      rows.map((r) => r.keyword),
      rows.map((r) => r.clicks),
      rows.map((r) => r.impressions),
      rows.map((r) => r.costMicros),
      rows.map((r) => r.conversions),
      rows.map((r) => r.conversionValueMicros),
    ],
  );
  return rowCount ?? 0;
}

// ===== Reports =====

export async function gscReport(
  db: Db,
  tenantId: string,
  range: { startDate: string; endDate: string },
): Promise<Array<{ query: string | null; page: string | null; clicks: number; impressions: number; ctr: number; position: number }>> {
  const { rows } = await db.query<{
    query: string | null;
    page: string | null;
    clicks: string;
    impressions: string;
    ctr: string;
    position: string;
  }>(
    `SELECT query, page,
            sum(clicks)::text AS clicks,
            sum(impressions)::text AS impressions,
            COALESCE(sum(clicks)::numeric / NULLIF(sum(impressions), 0), 0) AS ctr,
            COALESCE(sum(position * impressions)::numeric / NULLIF(sum(impressions), 0), 0) AS position
     FROM gsc_data
     WHERE tenant_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY query, page
     ORDER BY sum(clicks) DESC
     LIMIT 500`,
    [tenantId, range.startDate, range.endDate],
  );
  return rows.map((r) => ({
    query: r.query,
    page: r.page,
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    ctr: Number(r.ctr),
    position: Math.round(Number(r.position) * 100) / 100,
  }));
}

export async function ga4Traffic(
  db: Db,
  tenantId: string,
  range: { startDate: string; endDate: string },
): Promise<Array<{ source: string | null; medium: string | null; sessions: number; users: number; conversionRate: number; revenueAmount: number }>> {
  const { rows } = await db.query<{
    source: string | null;
    medium: string | null;
    sessions: string;
    users: string;
    conversions: string;
    revenue_amount: string;
  }>(
    `SELECT source, medium,
            sum(sessions)::text AS sessions,
            sum(users)::text AS users,
            sum(conversions)::text AS conversions,
            sum(revenue_amount)::text AS revenue_amount
     FROM ga4_data
     WHERE tenant_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY source, medium
     ORDER BY sum(sessions) DESC
     LIMIT 200`,
    [tenantId, range.startDate, range.endDate],
  );
  return rows.map((r) => {
    const sessions = Number(r.sessions);
    const conversions = Number(r.conversions);
    return {
      source: r.source,
      medium: r.medium,
      sessions,
      users: Number(r.users),
      conversionRate: sessions > 0 ? Math.round((conversions / sessions) * 10000) / 100 : 0,
      revenueAmount: Number(r.revenue_amount),
    };
  });
}

export async function adsCampaigns(
  db: Db,
  tenantId: string,
  range: { startDate: string; endDate: string },
): Promise<Array<{ campaignName: string | null; clicks: number; impressions: number; cost: number; conversions: number; conversionValue: number; roas: number }>> {
  const { rows } = await db.query<{
    campaign_name: string | null;
    clicks: string;
    impressions: string;
    cost_micros: string;
    conversions: string;
    conversion_value_micros: string;
  }>(
    `SELECT campaign_name,
            sum(clicks)::text AS clicks,
            sum(impressions)::text AS impressions,
            sum(cost_micros)::text AS cost_micros,
            sum(conversions)::text AS conversions,
            sum(conversion_value_micros)::text AS conversion_value_micros
     FROM ads_data
     WHERE tenant_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY campaign_name
     ORDER BY sum(cost_micros) DESC
     LIMIT 200`,
    [tenantId, range.startDate, range.endDate],
  );
  return rows.map((r) => {
    const cost = Number(r.cost_micros) / 1_000_000;
    const value = Number(r.conversion_value_micros) / 1_000_000;
    return {
      campaignName: r.campaign_name,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      cost: Math.round(cost * 100) / 100,
      conversions: Number(r.conversions),
      conversionValue: Math.round(value * 100) / 100,
      roas: cost > 0 ? Math.round((value / cost) * 100) / 100 : 0,
    };
  });
}

export async function gscDailyTotals(
  db: Db,
  tenantId: string,
  range: { startDate: string; endDate: string },
): Promise<Array<{ date: string; clicks: number; impressions: number }>> {
  const { rows } = await db.query<{ date: string; clicks: string; impressions: string }>(
    `SELECT date::text AS date, sum(clicks)::text AS clicks, sum(impressions)::text AS impressions
     FROM gsc_data
     WHERE tenant_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY date ORDER BY date`,
    [tenantId, range.startDate, range.endDate],
  );
  return rows.map((r) => ({ date: r.date, clicks: Number(r.clicks), impressions: Number(r.impressions) }));
}

export async function ga4DailyTotals(
  db: Db,
  tenantId: string,
  range: { startDate: string; endDate: string },
): Promise<Array<{ date: string; sessions: number; users: number; conversions: number }>> {
  const { rows } = await db.query<{ date: string; sessions: string; users: string; conversions: string }>(
    `SELECT date::text AS date, sum(sessions)::text AS sessions, sum(users)::text AS users, sum(conversions)::text AS conversions
     FROM ga4_data
     WHERE tenant_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY date ORDER BY date`,
    [tenantId, range.startDate, range.endDate],
  );
  return rows.map((r) => ({ date: r.date, sessions: Number(r.sessions), users: Number(r.users), conversions: Number(r.conversions) }));
}

export async function adsDailyTotals(
  db: Db,
  tenantId: string,
  range: { startDate: string; endDate: string },
): Promise<Array<{ date: string; clicks: number; cost: number; revenue: number }>> {
  const { rows } = await db.query<{ date: string; clicks: string; cost: string; revenue: string }>(
    `SELECT date::text AS date,
            sum(clicks)::text AS clicks,
            (sum(cost_micros) / 1e6)::text AS cost,
            (sum(conversion_value_micros) / 1e6)::text AS revenue
     FROM ads_data
     WHERE tenant_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY date ORDER BY date`,
    [tenantId, range.startDate, range.endDate],
  );
  return rows.map((r) => ({ date: r.date, clicks: Number(r.clicks), cost: Number(r.cost), revenue: Number(r.revenue) }));
}

export async function gscAggregate(
  db: Db,
  tenantId: string,
  range: { startDate: string; endDate: string },
): Promise<{ clicks: number; impressions: number; ctr: number; position: number }> {
  const { rows } = await db.query<{ clicks: string; impressions: string; ctr: string; position: string }>(
    `SELECT sum(clicks)::text AS clicks, sum(impressions)::text AS impressions,
            COALESCE(sum(clicks)::numeric / NULLIF(sum(impressions), 0), 0) AS ctr,
            COALESCE(sum(position * impressions)::numeric / NULLIF(sum(impressions), 0), 0) AS position
     FROM gsc_data WHERE tenant_id = $1 AND date BETWEEN $2 AND $3`,
    [tenantId, range.startDate, range.endDate],
  );
  const r = rows[0]!;
  return {
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    ctr: Math.round(Number(r.ctr) * 100) / 100,
    position: Math.round(Number(r.position) * 100) / 100,
  };
}

export async function ga4Aggregate(
  db: Db,
  tenantId: string,
  range: { startDate: string; endDate: string },
): Promise<{ sessions: number; users: number; conversions: number; revenueAmount: number }> {
  const { rows } = await db.query<{ sessions: string; users: string; conversions: string; revenue_amount: string }>(
    `SELECT sum(sessions)::text AS sessions, sum(users)::text AS users,
            sum(conversions)::text AS conversions, sum(revenue_amount)::text AS revenue_amount
     FROM ga4_data WHERE tenant_id = $1 AND date BETWEEN $2 AND $3`,
    [tenantId, range.startDate, range.endDate],
  );
  const r = rows[0]!;
  return {
    sessions: Number(r.sessions),
    users: Number(r.users),
    conversions: Number(r.conversions),
    revenueAmount: Number(r.revenue_amount),
  };
}

export async function adsAggregate(
  db: Db,
  tenantId: string,
  range: { startDate: string; endDate: string },
): Promise<{ clicks: number; impressions: number; cost: number; conversions: number; conversionValue: number }> {
  const { rows } = await db.query<{ clicks: string; impressions: string; cost: string; conversions: string; value: string }>(
    `SELECT sum(clicks)::text AS clicks, sum(impressions)::text AS impressions,
            (sum(cost_micros) / 1e6)::text AS cost,
            sum(conversions)::text AS conversions,
            (sum(conversion_value_micros) / 1e6)::text AS value
     FROM ads_data WHERE tenant_id = $1 AND date BETWEEN $2 AND $3`,
    [tenantId, range.startDate, range.endDate],
  );
  const r = rows[0]!;
  return {
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    cost: Number(r.cost),
    conversions: Number(r.conversions),
    conversionValue: Number(r.value),
  };
}

export type StoredGscRow = GscRow;
export type StoredGa4Row = Ga4Row;
export type StoredAdsRow = AdsRow;