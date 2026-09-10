import type { AnalyticsProvider } from "@beautyai/shared";
import { deriveStubSeed } from "./crypto.js";
import type { AnalyticsFetcher, AnalyticsDateRange, OAuthToken, ProviderResult, AdsSample, Ga4Sample, GscSample } from "./types.js";

const GSC_QUERIES = [
  "vitamin c serum",
  "best moisturizer dry skin",
  "retinol night cream",
  "sunscreen for sensitive skin",
  "hyaluronic acid serum",
  "niacinamide toner",
  "facial oil rosehip",
  "eye cream dark circles",
  "exfoliating cleanser",
  "peptide moisturizer",
  "beauty gift set",
  "skincare routine order",
  "hydrating face mask",
  "face mist rosewater",
];

const PAGES = [
  "/collections/all",
  "/products/vitamin-c-serum",
  "/products/hydra-moisturizer",
  "/products/retinol-night-cream",
  "/products/sunscreen-spf30",
  "/products/hyaluronic-serum",
  "/products/face-oil-rosehip",
  "/collections/skincare",
  "/products/eye-cream",
  "/products/cleansing-gel",
];

const COUNTRIES = ["US", "GB", "CA", "DE", "FR", "AU", "NL", "SE"];
const DEVICES = ["MOBILE", "DESKTOP", "TABLET"];

const GA4_SOURCES: Array<[string, string, string]> = [
  ["google", "cpc", "(data-driven)"],
  ["google", "organic", "(organic)"],
  ["facebook", "cpc", "spring_sale"],
  ["facebook", "social", "(social)"],
  ["instagram", "cpc", "creator_collab"],
  ["pinterest", "cpc", "prospecting"],
  ["email", "email", "newsletter_42"],
  ["tiktok", "cpc", "viral_kits"],
  ["bing", "organic", "(organic)"],
  ["(direct)", "(none)", "(direct)"],
];

const ADS_CAMPAIGNS: Array<{ campaignId: string; campaignName: string; adGroups: string[]; keywords: string[] }> = [
  { campaignId: "7812039401", campaignName: "Search — Vitamin C", adGroups: ["Serum / broad", "Serum / exact", "Gift sets"], keywords: ["vitamin c serum", "vitamin c for face", "brightening serum"] },
  { campaignId: "7812039402", campaignName: "Search — Moisturizers", adGroups: ["Dry skin / exact", "For sensitive"], keywords: ["best moisturizer dry skin", "sensitive skin cream"] },
  { campaignId: "7812039403", campaignName: "Search — Retinol", adGroups: ["Night cream / broad", "Anti-aging"], keywords: ["retinol night cream", "retinol serum for wrinkles"] },
  { campaignId: "7812039404", campaignName: "PMax — Skincare bundle", adGroups: ["Pmax / category"], keywords: ["skincare bundle", "beauty gift set"] },
];

export function createStubAnalyticsFetcher(): AnalyticsFetcher {
  return {
    providers: ["gsc", "ga4", "ads"],

    createOAuthUrl() {
      return null;
    },

    async exchangeCode(): Promise<OAuthToken> {
      return { accessToken: "stub-access", refreshToken: "stub-refresh", expiresIn: 3600 };
    },

    async refresh() {
      return { accessToken: "stub-access", expiresIn: 3600 };
    },

    async discoverAccount(provider) {
      switch (provider) {
        case "gsc":
          return "demo-site";
        case "ga4":
          return "demo-property";
        case "ads":
          return "demo-customer";
      }
    },

    async fetch(connection, range): Promise<ProviderResult> {
      const seed = connection.accountId ?? connection.provider;
      return stubRows(connection.provider, seed, range);
    },
  };
}

function dateRangeDays(range: AnalyticsDateRange): string[] {
  const days: string[] = [];
  const current = new Date(`${range.startDate}T00:00:00Z`);
  const end = new Date(`${range.endDate}T00:00:00Z`);
  if (Number.isNaN(current.getTime()) || Number.isNaN(end.getTime()) || current > end) return days;
  while (current <= end && days.length < 400) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length) % list.length]!;
}

function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function stubRows(provider: AnalyticsProvider, seed: string, range: AnalyticsDateRange): ProviderResult {
  const days = dateRangeDays(range);

  if (provider === "gsc") {
    const gsc: GscSample[] = [];
    for (const date of days) {
      const rng = deriveStubSeed(seed, provider, date);
      const rowsPerDay = 6 + Math.floor(rng() * 10);
      for (let i = 0; i < rowsPerDay; i += 1) {
        const impressions = intBetween(rng, 5, 800);
        const clicks = Math.round(impressions * (0.01 + rng() * 0.09));
        const position = 4 + rng() * 46;
        gsc.push({
          date,
          query: pick(rng, GSC_QUERIES),
          page: pick(rng, PAGES),
          country: pick(rng, COUNTRIES),
          device: pick(rng, DEVICES),
          clicks,
          impressions,
          ctr: impressions > 0 ? clicks / impressions : 0,
          position: Math.round(position * 100) / 100,
        });
      }
    }
    return { provider: "gsc", rows: gsc };
  }

  if (provider === "ga4") {
    const ga4: Ga4Sample[] = [];
    for (const date of days) {
      const rng = deriveStubSeed(seed, provider, date);
      for (const [source, medium, campaign] of GA4_SOURCES) {
        const sessions = intBetween(rng, 8, 1600);
        const users = Math.round(sessions * (0.55 + rng() * 0.35));
        const newUsers = Math.round(users * (0.15 + rng() * 0.45));
        const conversions = Math.round(sessions * (0.01 + rng() * 0.04));
        ga4.push({
          date,
          source,
          medium,
          campaign,
          landingPage: pick(rng, PAGES),
          sessions,
          users,
          newUsers,
          engagementRate: Math.round((0.45 + rng() * 0.45) * 1000) / 1000,
          conversions,
          revenueAmount: conversions * intBetween(rng, 2800, 9000),
        });
      }
    }
    return { provider: "ga4", rows: ga4 };
  }

  const ads: AdsSample[] = [];
  for (const date of days) {
    const rng = deriveStubSeed(seed, provider, date);
    for (const campaign of ADS_CAMPAIGNS) {
      for (const adGroup of campaign.adGroups) {
        for (const keyword of campaign.keywords) {
          const impressions = intBetween(rng, 20, 900);
          const clicks = Math.round(impressions * (0.012 + rng() * 0.06));
          ads.push({
            date,
            campaignId: campaign.campaignId,
            campaignName: campaign.campaignName,
            adGroup,
            keyword,
            clicks,
            impressions,
            costMicros: clicks * intBetween(rng, 120_000, 350_000),
            conversions: Math.round(clicks * (0.02 + rng() * 0.08)),
            conversionValueMicros: intBetween(rng, 500, 9000) * 1_000_000,
          });
        }
      }
    }
  }
  return { provider: "ads", rows: ads };
}