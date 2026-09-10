import type { DbPool } from "@beautyai/db";
import type { Product, ProductRecommendation, RecommendationStrategy, RecStrategyConfig } from "@beautyai/shared";
import type { RecEventInput } from "@beautyai/shared";
import { ApiError } from "../../lib/http.js";
import { findProductByHandle, findProductById, loadProductDetail } from "../../repositories/products.repo.js";
import {
  computeBoughtTogether,
  computePopular,
  computeRelated,
  getRecStrategyRaw,
  insertCustomerEvent,
  listStrategyRows,
  recentSessionProductIds,
  replaceRecommendations,
  resolveProductIdByVariant,
  upsertRecStrategy,
  type RecommendationRow,
} from "./recommendations.repo.js";

export interface RecServiceDeps {
  db: DbPool;
}

export interface RecRefreshResult {
  ok: boolean;
  counts: Record<string, number>;
  generatedAt: string;
  queued: boolean;
}

export function defaultRecConfig(): RecStrategyConfig {
  return {
    related: { enabled: true, limit: 8, weightCollection: 1, weightTag: 1 },
    boughtTogether: { enabled: true, limit: 4, minPairs: 1 },
    home: { enabled: true, limit: 8, windowDays: 90 },
    personalized: { enabled: true, limit: 8, lookbackDays: 14 },
  };
}

function mergeConfig(stored: RecStrategyConfig | null, patch?: Partial<RecStrategyConfig>): RecStrategyConfig {
  const merged = defaultRecConfig();
  const storedConfig = stored ?? defaultRecConfig();
  merged.related = { ...merged.related, ...storedConfig.related, ...patch?.related };
  merged.boughtTogether = { ...merged.boughtTogether, ...storedConfig.boughtTogether, ...patch?.boughtTogether };
  merged.home = { ...merged.home, ...storedConfig.home, ...patch?.home };
  merged.personalized = { ...merged.personalized, ...storedConfig.personalized, ...patch?.personalized };
  return merged;
}

function publicProduct(product: Product): Product {
  const { attributes: _attributes, ...rest } = product;
  return rest as Product;
}

async function rowsToRecs(
  db: DbPool,
  tenantId: string,
  strategy: RecommendationStrategy,
  rows: RecommendationRow[],
): Promise<ProductRecommendation[]> {
  const out: ProductRecommendation[] = [];
  for (const row of rows) {
    const product = await findProductById(db, tenantId, row.recommendedProductId);
    if (!product || product.status !== "active") continue;
    const detail = await loadProductDetail(db, tenantId, product);
    if (detail.variants.length === 0) continue;
    out.push({ product: publicProduct(detail), strategy, score: row.score });
  }
  return out;
}

async function hydrateRecommendations(
  db: DbPool,
  tenantId: string,
  rows: { productId: string; strategy: RecommendationStrategy; score: number }[],
): Promise<ProductRecommendation[]> {
  const out: ProductRecommendation[] = [];
  for (const row of rows) {
    const product = await findProductById(db, tenantId, row.productId);
    if (!product || product.status !== "active") continue;
    const detail = await loadProductDetail(db, tenantId, product);
    if (detail.variants.length === 0) continue;
    out.push({ product: publicProduct(detail), strategy: row.strategy, score: row.score });
  }
  return out;
}

export interface RecommendationService {
  getConfig(tenantId: string): Promise<RecStrategyConfig>;
  updateConfig(tenantId: string, patch: Partial<RecStrategyConfig>): Promise<RecStrategyConfig>;
  recordEvent(
    tenantId: string,
    input: RecEventInput,
  ): Promise<{ id: string; event: string; productId: string; createdAt: string }>;
  refresh(tenantId: string): Promise<RecRefreshResult>;
  related(tenantId: string, handle: string, limit?: number): Promise<ProductRecommendation[]>;
  boughtTogether(tenantId: string, handle: string, limit?: number): Promise<ProductRecommendation[]>;
  home(tenantId: string, opts: { limit?: number; sessionId?: string }): Promise<ProductRecommendation[]>;
}

export function createRecommendationService({ db }: RecServiceDeps): RecommendationService {
  return {
    async getConfig(tenantId) {
      const stored = await getRecStrategyRaw(db, tenantId);
      return mergeConfig(stored);
    },

    async updateConfig(tenantId, patch) {
      const stored = await getRecStrategyRaw(db, tenantId);
      const merged = mergeConfig(stored, patch);
      await upsertRecStrategy(db, tenantId, merged);
      return merged;
    },

    async recordEvent(tenantId, input) {
      let productId: string | null = null;
      if (input.productHandle) {
        const product = await findProductByHandle(db, tenantId, input.productHandle);
        productId = product?.id ?? null;
      } else if (input.variantId) {
        productId = await resolveProductIdByVariant(db, tenantId, input.variantId);
      }
      if (!productId) throw ApiError.notFound("Product not found");
      const created = await insertCustomerEvent(db, {
        tenantId,
        sessionId: input.sessionId,
        eventType: input.event,
        productId,
        variantId: input.variantId,
        quantity: input.quantity,
      });
      return { id: created.id, event: input.event, productId, createdAt: created.createdAt };
    },

    async refresh(tenantId) {
      const config = await this.getConfig(tenantId);
      const rows: { sourceProductId: string | null; recommendedProductId: string; strategy: RecommendationStrategy; score: number; rank: number }[] = [];
      const counts: Record<string, number> = {};

      if (config.related.enabled) {
        const related = await computeRelated(db, tenantId, {
          weightCollection: config.related.weightCollection,
          weightTag: config.related.weightTag,
          limit: config.related.limit,
        });
        const rankCounter = new Map<string, number>();
        for (const r of related) {
          rankCounter.set(r.sourceId, (rankCounter.get(r.sourceId) ?? 0) + 1);
          rows.push({ sourceProductId: r.sourceId, recommendedProductId: r.recId, strategy: "related", score: r.score, rank: rankCounter.get(r.sourceId)! });
        }
        counts.related = rows.filter((r) => r.strategy === "related").length;
      }

      if (config.boughtTogether.enabled) {
        const pairs = await computeBoughtTogether(db, tenantId, {
          minPairs: config.boughtTogether.minPairs,
          limit: config.boughtTogether.limit,
        });
        const rankCounter = new Map<string, number>();
        for (const r of pairs) {
          rankCounter.set(r.sourceId, (rankCounter.get(r.sourceId) ?? 0) + 1);
          rows.push({ sourceProductId: r.sourceId, recommendedProductId: r.recId, strategy: "bought_together", score: r.score, rank: rankCounter.get(r.sourceId)! });
        }
        counts.boughtTogether = rows.filter((r) => r.strategy === "bought_together").length;
      }

      if (config.home.enabled) {
        const popular = await computePopular(db, tenantId, { windowDays: config.home.windowDays, limit: config.home.limit });
        popular.forEach((p, i) => rows.push({ sourceProductId: null, recommendedProductId: p.productId, strategy: "popular", score: p.score, rank: i + 1 }));
        counts.popular = popular.length;
      }

      const generatedAt = await replaceRecommendations(db, tenantId, rows);
      return { ok: true, counts, generatedAt: generatedAt.toISOString(), queued: false };
    },

    async related(tenantId, handle, limit) {
      const config = await this.getConfig(tenantId);
      if (!config.related.enabled) return [];
      const product = await findProductByHandle(db, tenantId, handle);
      if (!product) throw ApiError.notFound("Product not found");
      const rows = await listStrategyRows(db, tenantId, product.id, "related", limit ?? config.related.limit);
      return rowsToRecs(db, tenantId, "related", rows);
    },

    async boughtTogether(tenantId, handle, limit) {
      const config = await this.getConfig(tenantId);
      if (!config.boughtTogether.enabled) return [];
      const product = await findProductByHandle(db, tenantId, handle);
      if (!product) throw ApiError.notFound("Product not found");
      const rows = await listStrategyRows(db, tenantId, product.id, "bought_together", limit ?? config.boughtTogether.limit);
      return rowsToRecs(db, tenantId, "bought_together", rows);
    },

    async home(tenantId, opts) {
      const config = await this.getConfig(tenantId);
      const limit = opts.limit ?? config.home.limit;
      const seen = new Set<string>();

      // Personalized: pull precomputed recs of products the session recently engaged with.
      if (opts.sessionId && config.personalized.enabled) {
        const viewed = await recentSessionProductIds(db, tenantId, opts.sessionId, {
          lookbackDays: config.personalized.lookbackDays,
          limit: Math.max(8, config.personalized.limit),
        });
        if (viewed.length > 0) {
          const personal: { productId: string; strategy: RecommendationStrategy; score: number }[] = [];
          for (const pid of viewed) {
            const related = await listStrategyRows(db, tenantId, pid, "related", config.personalized.limit);
            const bought = await listStrategyRows(db, tenantId, pid, "bought_together", config.personalized.limit);
            for (const r of [...related, ...bought]) {
              if (viewed.includes(r.recommendedProductId)) continue;
              if (seen.has(r.recommendedProductId)) continue;
              seen.add(r.recommendedProductId);
              personal.push({ productId: r.recommendedProductId, strategy: "personalized", score: r.score });
            }
            if (personal.length >= config.personalized.limit) break;
          }
          const recs = await hydrateRecommendations(
            db,
            tenantId,
            personal.sort((a, b) => b.score - a.score).slice(0, config.personalized.limit),
          );
          if (recs.length > 0) {
            const remaining = Math.max(0, limit - recs.length);
            if (remaining === 0 || !config.home.enabled) return recs;
            const popularRows = await listStrategyRows(db, tenantId, null, "popular", limit);
            const popularFresh: { productId: string; strategy: RecommendationStrategy; score: number }[] = [];
            for (const r of popularRows) {
              if (seen.has(r.recommendedProductId)) continue;
              seen.add(r.recommendedProductId);
              popularFresh.push({ productId: r.recommendedProductId, strategy: "popular", score: r.score });
            }
            const fill = await hydrateRecommendations(db, tenantId, popularFresh.slice(0, remaining));
            return [...recs, ...fill];
          }
        }
      }

      const popularRows = await listStrategyRows(db, tenantId, null, "popular", limit);
      return rowsToRecs(db, tenantId, "popular", popularRows);
    },
  };
}