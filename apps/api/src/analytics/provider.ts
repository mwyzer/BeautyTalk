import type { AnalyticsProvider } from "@beautyai/shared";
import { ApiError } from "../lib/http.js";
import type { AnalyticsFetcher, AnalyticsDateRange, ConnectionSecrets, AdsSample, Ga4Sample, GscSample } from "./types.js";

export interface GoogleAnalyticsConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string;
  adsDeveloperToken: string | undefined;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";

const SCOPES: Record<AnalyticsProvider, string> = {
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
  ads: "https://www.googleapis.com/auth/adwords",
};

async function postTokenForm(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    throw ApiError.serviceUnavailable(`Google token request failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function authedFetch(path: string, init: RequestInit, accessToken: string): Promise<Response> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw ApiError.serviceUnavailable("Google access token expired or lacks permission for this account");
  }
  return res;
}

export function createGoogleAnalyticsFetcher(config: GoogleAnalyticsConfig): AnalyticsFetcher {
  const configured = Boolean(config.clientId && config.clientSecret);

  async function ensureAccessToken(connection: ConnectionSecrets): Promise<string> {
    if (connection.accessToken) return connection.accessToken;
    throw ApiError.serviceUnavailable(`No access token stored for ${connection.provider} connection`);
  }

  return {
    providers: ["gsc", "ga4", "ads"],

    createOAuthUrl(provider) {
      if (!configured) return null;
      const params = new URLSearchParams({
        client_id: config.clientId!,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: SCOPES[provider],
        access_type: "offline",
        prompt: "consent",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    },

    async exchangeCode(provider, code, redirectUri) {
      if (!configured) throw ApiError.serviceUnavailable("Google OAuth is not configured");
      const body = new URLSearchParams({
        client_id: config.clientId!,
        client_secret: config.clientSecret!,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      const data = await postTokenForm(body);
      if (!data.access_token || !data.refresh_token) {
        throw ApiError.serviceUnavailable("Google OAuth response missing tokens");
      }
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in ?? 3600,
      };
    },

    async refresh(connection) {
      if (!configured) throw ApiError.serviceUnavailable("Google OAuth is not configured");
      const refreshToken = String(connection.settings.refreshToken ?? "");
      if (!refreshToken) throw ApiError.serviceUnavailable(`${connection.provider} connection has no refresh token`);
      const body = new URLSearchParams({
        client_id: config.clientId!,
        client_secret: config.clientSecret!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      const data = await postTokenForm(body);
      if (!data.access_token) throw ApiError.serviceUnavailable("Google token refresh returned no access token");
      return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
    },

    async discoverAccount(provider, accessToken, extra) {
      try {
        if (provider === "gsc") {
          const res = await authedFetch("https://www.googleapis.com/webmasters/v3/sites", {}, accessToken);
          if (!res.ok) return null;
          const data = (await res.json()) as { siteEntry?: Array<{ siteUrl?: string }> };
          return data.siteEntry?.[0]?.siteUrl ?? null;
        }
        if (provider === "ga4") {
          const res = await authedFetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", {}, accessToken);
          if (!res.ok) return null;
          const data = (await res.json()) as { accountSummaries?: Array<{ propertySummaries?: Array<{ property?: string }> }> };
          for (const summary of data.accountSummaries ?? []) {
            for (const prop of summary.propertySummaries ?? []) {
              const match = prop.property?.match(/(\d+)$/);
              if (match) return match[1] ?? null;
            }
          }
          return null;
        }
        if (provider === "ads") {
          const developerToken = String(extra.developerToken ?? "");
          const res = await authedFetch(
            "https://googleads.googleapis.com/v18/customers:listAccessibleCustomers",
            {
              method: "POST",
              headers: developerToken ? { "developer-token": developerToken } : {},
            },
            accessToken,
          );
          if (!res.ok) return null;
          const data = (await res.json()) as { resourceNames?: string[] };
          const match = data.resourceNames?.[0]?.match(/customers\/(\d+)/);
          return match ? (match[1] ?? null) : null;
        }
      } catch {
        return null;
      }
      return null;
    },

    async fetch(connection, range) {
      const token = await ensureAccessToken(connection);
      const accountId = connection.accountId;
      if (!accountId) throw ApiError.badRequest(`${connection.provider} connection is missing an account id`);

      switch (connection.provider) {
        case "gsc":
          return { provider: "gsc", rows: await fetchGsc(token, accountId, range) };
        case "ga4":
          return { provider: "ga4", rows: await fetchGa4(token, accountId, range) };
        case "ads": {
          const developerToken = String(connection.settings.developerToken ?? config.adsDeveloperToken ?? "");
          return { provider: "ads", rows: await fetchAds(token, accountId, developerToken, range) };
        }
      }
    },
  };
}

// ===== Google Search Console =====

function tryParseNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function fetchGsc(accessToken: string, siteUrl: string, range: AnalyticsDateRange): Promise<GscSample[]> {
  const encoded = encodeURIComponent(siteUrl);
  const res = await authedFetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ["date", "query", "page", "country", "device"],
        rowLimit: 25000,
      }),
    },
    accessToken,
  );
  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    throw ApiError.serviceUnavailable(`GSC query failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }> };
  const rows: GscSample[] = [];
  for (const row of data.rows ?? []) {
    const [date, query = "", page = "", country = "", device = ""] = row.keys ?? [];
    if (!date) continue;
    rows.push({
      date,
      query,
      page,
      country,
      device,
      clicks: tryParseNumber(row.clicks),
      impressions: tryParseNumber(row.impressions),
      ctr: tryParseNumber(row.ctr),
      position: tryParseNumber(row.position),
    });
  }
  return rows;
}

// ===== Google Analytics 4 =====

async function fetchGa4(accessToken: string, propertyId: string, range: AnalyticsDateRange): Promise<Ga4Sample[]> {
  const res = await authedFetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
        dimensions: [
          { name: "date" },
          { name: "sessionSource" },
          { name: "sessionMedium" },
          { name: "sessionCampaignName" },
          { name: "landingPage" },
        ],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "engagementRate" },
          { name: "conversions" },
          { name: "totalRevenue" },
        ],
        limit: 250000,
      }),
    },
    accessToken,
  );
  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    throw ApiError.serviceUnavailable(`GA4 report failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
  };
  const rows: Ga4Sample[] = [];
  for (const row of data.rows ?? []) {
    const dims = (row.dimensionValues ?? []).map((d) => d.value ?? "");
    const metrics = (row.metricValues ?? []).map((m) => tryParseNumber(m.value));
    const [date, source = "", medium = "", campaign = "", landingPage = ""] = dims;
    const [sessions = 0, users = 0, newUsers = 0, engagementRate = 0, conversions = 0, revenue = 0] = metrics;
    if (!date) continue;
    rows.push({
      date,
      source,
      medium,
      campaign,
      landingPage,
      sessions,
      users,
      newUsers,
      engagementRate,
      conversions,
      revenueAmount: Math.round(revenue),
    });
  }
  return rows;
}

// ===== Google Ads (GAQL via REST) =====

async function fetchAds(accessToken: string, customerId: string, developerToken: string, range: AnalyticsDateRange): Promise<AdsSample[]> {
  if (!developerToken) {
    throw ApiError.serviceUnavailable("Google Ads requires a developer token (GOOGLE_ADS_DEVELOPER_TOKEN)");
  }
  const query = [
    "SELECT segments.date, campaign.id, campaign.name, ad_group.name, ad_group_criterion.keyword.text,",
    "metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions, metrics.conversions_value",
    "FROM ad_group_criterion",
    `WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'`,
    "AND ad_group_criterion.type = 'KEYWORD'",
    "ORDER BY segments.date",
  ].join(" ");
  const res = await authedFetch(
    `https://googleads.googleapis.com/v18/customers/${encodeURIComponent(customerId)}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "developer-token": developerToken,
      },
      body: JSON.stringify({ query, pageSize: 10000 }),
    },
    accessToken,
  );
  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    throw ApiError.serviceUnavailable(`Google Ads query failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const rows: AdsSample[] = [];
  for (const item of data.results ?? []) {
    const segments = (item.segments ?? {}) as Record<string, unknown>;
    const campaign = (item.campaign ?? {}) as Record<string, unknown>;
    const adGroup = (item.ad_group ?? {}) as Record<string, unknown>;
    const criterion = (item.ad_group_criterion ?? {}) as Record<string, unknown>;
    const keyword = (criterion.keyword ?? {}) as Record<string, unknown>;
    const metrics = (item.metrics ?? {}) as Record<string, unknown>;
    const date = String(segments.date ?? "");
    if (!date) continue;
    rows.push({
      date,
      campaignId: String(campaign.id ?? ""),
      campaignName: String(campaign.name ?? ""),
      adGroup: String(adGroup.name ?? ""),
      keyword: String(keyword.text ?? ""),
      clicks: tryParseNumber(metrics.clicks),
      impressions: tryParseNumber(metrics.impressions),
      costMicros: tryParseNumber(metrics.cost_micros),
      conversions: tryParseNumber(metrics.conversions),
      conversionValueMicros: tryParseNumber(metrics.conversions_value),
    });
  }
  return rows;
}