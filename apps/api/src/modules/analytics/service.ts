import type { DbPool } from "@beautyai/db";
import type {
  AnalyticsConnection,
  AnalyticsProvider,
  AnalyticsOverview,
  AnalyticsSync,
  AdsCampaignRow,
  Ga4TrafficRow,
  GscReportRow,
} from "@beautyai/shared";
import type { AppConfig } from "../../config/env.js";
import { ApiError } from "../../lib/http.js";
import { makeTokenCipher, type TokenCipher } from "../../analytics/crypto.js";
import type { AnalyticsFetcher, AnalyticsDateRange, ConnectionSecrets } from "../../analytics/types.js";
import {
  adsAggregate, adsCampaigns, adsDailyTotals, deleteConnection, findConnection, finishSync,
  ga4Aggregate, ga4DailyTotals, ga4Traffic, gscAggregate, gscDailyTotals, gscReport,
  latestAnalyticsDate, listConnections, listSyncs, replaceAdsRows, replaceGa4Rows,
  replaceGscRows, setConnectionLastSync, setConnectionTokens, startSync, upsertConnection,
} from "./analytics.repo.js";

export type AnalyticsConfig = Pick<
  AppConfig,
  "ANALYTICS_TOKEN_KEY" | "JWT_ACCESS_SECRET" | "GOOGLE_REDIRECT_URI" | "STOREFRONT_URL" | "GOOGLE_ADS_DEVELOPER_TOKEN"
>;

export interface RunSyncResult {
  sync: AnalyticsSync;
  recordsProcessed: number;
}

export interface AnalyticsSyncParams {
  provider: AnalyticsProvider;
  startDate?: string;
  endDate?: string;
}

export interface AnalyticsService {
  canConnect(): boolean;
  oauthStart(provider: AnalyticsProvider): { url: string | null; configured: boolean };
  connect(tenantId: string, input: { provider: AnalyticsProvider; code?: string; accountId?: string; demo?: boolean }): Promise<AnalyticsConnection>;
  disconnect(tenantId: string, provider: AnalyticsProvider): Promise<void>;
  listConnections(tenantId: string): Promise<AnalyticsConnection[]>;
  listSyncs(tenantId: string, page: number, limit: number): Promise<{ data: AnalyticsSync[]; total: number }>;
  runSync(tenantId: string, params: AnalyticsSyncParams): Promise<RunSyncResult>;
  gscReport(tenantId: string, range: AnalyticsDateRange): Promise<GscReportRow[]>;
  ga4Traffic(tenantId: string, range: AnalyticsDateRange): Promise<Ga4TrafficRow[]>;
  adsCampaigns(tenantId: string, range: AnalyticsDateRange): Promise<AdsCampaignRow[]>;
  overview(tenantId: string, range: AnalyticsDateRange): Promise<AnalyticsOverview>;
}

function daysAgoUtc(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function dateRangeFor(input: { startDate?: string; endDate?: string }, lastDataDate: string | null): AnalyticsDateRange {
  const end = input.endDate ?? daysAgoUtc(0);
  if (input.startDate) return { startDate: input.startDate, endDate: end };
  if (lastDataDate) {
    const nextDay = new Date(`${lastDataDate}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    if (nextDay.toISOString().slice(0, 10) <= end) {
      return { startDate: nextDay.toISOString().slice(0, 10), endDate: end };
    }
  }
  return { startDate: daysAgoUtc(29), endDate: end };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function createAnalyticsService(deps: { db: DbPool; fetcher: AnalyticsFetcher; config: AnalyticsConfig }): AnalyticsService {
  const { db, fetcher, config } = deps;
  const cipher: TokenCipher = makeTokenCipher(config.ANALYTICS_TOKEN_KEY ?? config.JWT_ACCESS_SECRET);

  async function withCipherAccess(connection: { accessTokenEnc: string | null; refreshTokenEnc: string | null; provider: AnalyticsProvider; accountId: string | null }): Promise<ConnectionSecrets> {
    const settings: Record<string, unknown> = {};
    if (connection.refreshTokenEnc) settings.refreshToken = cipher.decrypt(connection.refreshTokenEnc);
    return {
      provider: connection.provider,
      accountId: connection.accountId,
      accessToken: connection.accessTokenEnc ? cipher.decrypt(connection.accessTokenEnc) : null,
      settings,
    };
  }

  return {
    canConnect(): boolean {
      return Boolean(fetcher.createOAuthUrl("ga4"));
    },

    oauthStart(provider) {
      return { url: fetcher.createOAuthUrl(provider), configured: Boolean(fetcher.createOAuthUrl(provider)) };
    },

    async connect(tenantId, input) {
      const demo = input.demo === true;
      if (!demo && fetcher.createOAuthUrl(input.provider) == null) {
        throw ApiError.serviceUnavailable(
          "Google Analytics is not configured on this server. Use demo mode to explore the dashboard.",
        );
      }

      let accountId = input.accountId ?? null;
      let accessTokenEnc: string | null = null;
      let refreshTokenEnc: string | null = null;
      let tokenExpiresAt: string | null = null;
      let status = "connected";

      if (demo) {
        const demoAccount = await fetcher.discoverAccount(input.provider, "stub-access", {});
        accountId = input.accountId ?? demoAccount;
        accessTokenEnc = cipher.encrypt("stub-access-token");
        refreshTokenEnc = cipher.encrypt("stub-refresh-token");
        tokenExpiresAt = new Date(Date.now() + 3600_000).toISOString();
      } else {
        if (!input.code) throw ApiError.badRequest("code is required when connecting a real Google account");
        const redirectUri = config.GOOGLE_REDIRECT_URI ?? `${config.STOREFRONT_URL ?? "http://localhost:4321"}/admin/analytics`;
        const tokens = await fetcher.exchangeCode(input.provider, input.code, redirectUri);
        accessTokenEnc = cipher.encrypt(tokens.accessToken);
        refreshTokenEnc = cipher.encrypt(tokens.refreshToken);
        tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
        accountId =
          input.accountId ??
          (await fetcher.discoverAccount(input.provider, tokens.accessToken, {
            developerToken: config.GOOGLE_ADS_DEVELOPER_TOKEN,
          }));
        status = accountId ? "connected" : "needs_account";
      }

      const stored = await upsertConnection(db, {
        tenantId,
        provider: input.provider,
        accountId,
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt,
        status,
        settings: {},
      });
      return storedToPublic(stored);
    },

    async disconnect(tenantId, provider) {
      const connection = await findConnection(db, tenantId, provider);
      if (!connection) throw ApiError.notFound(`${provider} connection not found`);
      await deleteConnection(db, tenantId, connection.id);
      const table = provider === "gsc" ? "gsc_data" : provider === "ga4" ? "ga4_data" : "ads_data";
      await db.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    },

    async listConnections(tenantId) {
      return listConnections(db, tenantId);
    },

    async listSyncs(tenantId, page, limit) {
      const safePage = Math.max(1, page);
      const safeLimit = Math.min(100, Math.max(1, limit));
      return listSyncs(db, tenantId, { page: safePage, limit: safeLimit });
    },

    async runSync(tenantId, params) {
      const connection = await findConnection(db, tenantId, params.provider);
      if (!connection) throw ApiError.notFound(`${params.provider} connection not found`);

      const sync = await startSync(db, tenantId, params.provider);
      try {
        if (!connection.tokenExpiresAt || new Date(connection.tokenExpiresAt).getTime() <= Date.now()) {
          if (connection.refreshTokenEnc) {
            const secrets = await withCipherAccess(connection);
            const refreshed = await fetcher.refresh(secrets);
            await setConnectionTokens(db, {
              tenantId,
              id: connection.id,
              accessTokenEnc: cipher.encrypt(refreshed.accessToken),
              tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
            });
          }
        }

        const lastDataDate = await latestAnalyticsDate(db, tenantId, params.provider);
        const range = dateRangeFor(params, lastDataDate);
        const stored = await findConnection(db, tenantId, params.provider);
        if (!stored) throw ApiError.notFound(`${params.provider} connection not found`);

        const secrets: ConnectionSecrets = {
          provider: params.provider,
          accountId: stored.accountId,
          accessToken: stored.accessTokenEnc ? cipher.decrypt(stored.accessTokenEnc) : null,
          settings: {
            refreshToken: stored.refreshTokenEnc ? cipher.decrypt(stored.refreshTokenEnc) : "",
            developerToken: config.GOOGLE_ADS_DEVELOPER_TOKEN,
          },
        };

        const result = await fetcher.fetch(secrets, range);
        let recordsProcessed = 0;
        switch (result.provider) {
          case "gsc":
            recordsProcessed = await replaceGscRows(db, tenantId, result.rows);
            break;
          case "ga4":
            recordsProcessed = await replaceGa4Rows(db, tenantId, result.rows);
            break;
          case "ads":
            recordsProcessed = await replaceAdsRows(db, tenantId, result.rows);
            break;
        }

        const finished = await finishSync(db, sync.id, { recordsProcessed });
        await setConnectionLastSync(db, tenantId, connection.id, new Date().toISOString());
        return { sync: finished, recordsProcessed };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown sync error";
        await finishSync(db, sync.id, { recordsProcessed: 0, error: message });
        if (err instanceof ApiError) throw err;
        throw ApiError.serviceUnavailable(`Analytics sync failed: ${message}`);
      }
    },

    async gscReport(tenantId, range) {
      return gscReport(db, tenantId, range);
    },

    async ga4Traffic(tenantId, range) {
      return ga4Traffic(db, tenantId, range);
    },

    async adsCampaigns(tenantId, range) {
      return adsCampaigns(db, tenantId, range);
    },

    async overview(tenantId, range) {
      const [gscAgg, ga4Agg, adsAgg, gscDaily, ga4Daily, adsDaily] = await Promise.all([
        gscAggregate(db, tenantId, range),
        ga4Aggregate(db, tenantId, range),
        adsAggregate(db, tenantId, range),
        gscDailyTotals(db, tenantId, range),
        ga4DailyTotals(db, tenantId, range),
        adsDailyTotals(db, tenantId, range),
      ]);

      const points = new Map<string, { date: string; clicks: number; impressions: number; sessions: number; adClicks: number; adCost: number; adRevenue: number }>();
      for (const d of gscDaily) {
        points.set(d.date, { date: d.date, clicks: d.clicks, impressions: d.impressions, sessions: 0, adClicks: 0, adCost: 0, adRevenue: 0 });
      }
      for (const d of ga4Daily) {
        const p = points.get(d.date) ?? { date: d.date, clicks: 0, impressions: 0, sessions: 0, adClicks: 0, adCost: 0, adRevenue: 0 };
        p.sessions = d.sessions;
        points.set(d.date, p);
      }
      for (const d of adsDaily) {
        const p = points.get(d.date) ?? { date: d.date, clicks: 0, impressions: 0, sessions: 0, adClicks: 0, adCost: 0, adRevenue: 0 };
        p.adClicks = d.clicks;
        p.adCost = round2(d.cost);
        p.adRevenue = round2(d.revenue);
        points.set(d.date, p);
      }

      return {
        startDate: range.startDate,
        endDate: range.endDate,
        kpis: {
          organicClicks: gscAgg.clicks,
          organicImpressions: gscAgg.impressions,
          organicCtr: round2(gscAgg.ctr),
          organicPosition: round2(gscAgg.position),
          sessions: ga4Agg.sessions,
          users: ga4Agg.users,
          conversions: ga4Agg.conversions,
          adClicks: adsAgg.clicks,
          adSpend: round2(adsAgg.cost),
          adRevenue: round2(adsAgg.conversionValue),
          roas: adsAgg.cost > 0 ? round2(adsAgg.conversionValue / adsAgg.cost) : 0,
        },
        series: [...points.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 400),
      };
    },
  };
}

function storedToPublic(stored: { id: string; tenantId: string; provider: AnalyticsProvider; accountId: string | null; status: string; lastSyncAt: string | null; settings: Record<string, unknown>; createdAt: string; updatedAt: string }): AnalyticsConnection {
  return {
    id: stored.id,
    tenantId: stored.tenantId,
    provider: stored.provider,
    accountId: stored.accountId,
    status: stored.status,
    lastSyncAt: stored.lastSyncAt,
    settings: stored.settings,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}