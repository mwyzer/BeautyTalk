import type { AnalyticsProvider } from "@beautyai/shared";

export interface AnalyticsDateRange {
  startDate: string;
  endDate: string;
}

export interface ConnectionSecrets {
  provider: AnalyticsProvider;
  accountId: string | null;
  accessToken: string | null;
  settings: Record<string, unknown>;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface GscSample {
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

export interface Ga4Sample {
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

export interface AdsSample {
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

export type ProviderResult =
  | { provider: "gsc"; rows: GscSample[] }
  | { provider: "ga4"; rows: Ga4Sample[] }
  | { provider: "ads"; rows: AdsSample[] };

export interface AnalyticsFetcher {
  providers: AnalyticsProvider[];
  createOAuthUrl(provider: AnalyticsProvider): string | null;
  exchangeCode(provider: AnalyticsProvider, code: string, redirectUri: string): Promise<OAuthToken>;
  refresh(connection: ConnectionSecrets): Promise<{ accessToken: string; expiresIn: number }>;
  discoverAccount(provider: AnalyticsProvider, accessToken: string, extra: Record<string, unknown>): Promise<string | null>;
  fetch(connection: ConnectionSecrets, range: AnalyticsDateRange): Promise<ProviderResult>;
}