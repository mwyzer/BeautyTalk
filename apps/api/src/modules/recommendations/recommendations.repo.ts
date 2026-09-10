import type { Db, DbPool } from "@beautyai/db";
import type { RecommendationStrategy, RecStrategyConfig } from "@beautyai/shared";

export interface RecScoreRow {
  sourceId: string;
  recId: string;
  score: number;
}

export interface PopularRow {
  productId: string;
  score: number;
}

export interface RecommendationRow {
  recommendedProductId: string;
  score: number;
  rank: number;
}

// ===== Strategy config =====

export async function getRecStrategyRaw(db: Db, tenantId: string): Promise<RecStrategyConfig | null> {
  const { rows } = await db.query<{ config: RecStrategyConfig | null }>(
    "SELECT config FROM rec_strategies WHERE tenant_id = $1",
    [tenantId],
  );
  return rows[0]?.config ?? null;
}

export async function upsertRecStrategy(db: Db, tenantId: string, config: RecStrategyConfig): Promise<void> {
  await db.query(
    `INSERT INTO rec_strategies (tenant_id, config, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (tenant_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
    [tenantId, JSON.stringify(config)],
  );
}

// ===== Event capture =====

export async function resolveProductIdByVariant(db: Db, tenantId: string, variantId: string): Promise<string | null> {
  const { rows } = await db.query<{ product_id: string }>(
    "SELECT product_id FROM variants WHERE tenant_id = $1 AND id = $2",
    [tenantId, variantId],
  );
  return rows[0]?.product_id ?? null;
}

export interface InsertCustomerEventInput {
  tenantId: string;
  sessionId: string;
  eventType: "product_view" | "add_to_cart";
  productId: string;
  variantId?: string;
  quantity?: number;
}

export async function insertCustomerEvent(db: Db, input: InsertCustomerEventInput): Promise<{ id: string; createdAt: string }> {
  const { rows } = await db.query<{ id: string; created_at: Date }>(
    `INSERT INTO customer_events (tenant_id, session_id, event_type, product_id, variant_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [
      input.tenantId,
      input.sessionId,
      input.eventType,
      input.productId,
      input.variantId ?? null,
      JSON.stringify(
        input.quantity !== undefined ? { quantity: input.quantity } : {},
      ),
    ],
  );
  const row = rows[0]!;
  return { id: row.id, createdAt: row.created_at.toISOString() };
}

export async function recentSessionProductIds(
  db: Db,
  tenantId: string,
  sessionId: string,
  opts: { lookbackDays: number; limit: number },
): Promise<string[]> {
  const { rows } = await db.query<{ product_id: string }>(
    `SELECT product_id
     FROM customer_events
     WHERE tenant_id = $1 AND session_id = $2
       AND event_type IN ('product_view', 'add_to_cart')
       AND product_id IS NOT NULL
       AND created_at >= now() - ($3::int * interval '1 day')
     GROUP BY product_id
     ORDER BY max(created_at) DESC
     LIMIT $4`,
    [tenantId, sessionId, opts.lookbackDays, opts.limit],
  );
  return rows.map((r) => r.product_id);
}

// ===== Offline computation =====

export async function computePopular(
  db: Db,
  tenantId: string,
  opts: { windowDays: number; limit: number },
): Promise<PopularRow[]> {
  const { rows } = await db.query<{ product_id: string; weight: string }>(
    `WITH sales AS (
       SELECT v.product_id, sum(oi.quantity) AS units
       FROM order_items oi
       JOIN variants v ON v.id = oi.variant_id
       JOIN orders o ON o.id = oi.order_id
       WHERE o.tenant_id = $1
         AND o.status NOT IN ('cancelled', 'refunded')
         AND o.placed_at >= now() - ($2::int * interval '1 day')
       GROUP BY v.product_id
     ),
     views AS (
       SELECT product_id, count(*) AS n
       FROM customer_events
       WHERE tenant_id = $1
         AND event_type = 'product_view'
         AND product_id IS NOT NULL
         AND created_at >= now() - ($2::int * interval '1 day')
       GROUP BY product_id
     ),
     weighted AS (
       SELECT COALESCE(s.product_id, vw.product_id) AS product_id,
              COALESCE(s.units, 0) + COALESCE(vw.n, 0) AS weight
       FROM sales s
       FULL OUTER JOIN views vw ON vw.product_id = s.product_id
     )
     SELECT w.product_id, (w.weight::numeric / NULLIF(max(w.weight) OVER (), 0))::text AS weight
     FROM weighted w
     JOIN products p ON p.id = w.product_id AND p.tenant_id = $1 AND p.status = 'active'
     WHERE w.weight > 0
     ORDER BY w.weight DESC
     LIMIT $3`,
    [tenantId, opts.windowDays, opts.limit],
  );
  return rows.map((r) => ({ productId: r.product_id, score: Number(r.weight) }));
}

export async function computeBoughtTogether(
  db: Db,
  tenantId: string,
  opts: { minPairs: number; limit: number },
): Promise<RecScoreRow[]> {
  const { rows } = await db.query<{ source_id: string; rec_id: string; pairs: string }>(
    `SELECT av.product_id AS source_id, bv.product_id AS rec_id, count(*) AS pairs
     FROM order_items a
     JOIN order_items b ON b.order_id = a.order_id AND b.variant_id <> a.variant_id
     JOIN variants av ON av.id = a.variant_id
     JOIN variants bv ON bv.id = b.variant_id
     JOIN orders o ON o.id = a.order_id AND o.tenant_id = $1
     WHERE av.product_id <> bv.product_id
       AND o.status NOT IN ('cancelled', 'refunded')
       AND av.product_id IN (SELECT id FROM products WHERE tenant_id = $1 AND status = 'active')
       AND bv.product_id IN (SELECT id FROM products WHERE tenant_id = $1 AND status = 'active')
     GROUP BY av.product_id, bv.product_id
     HAVING count(*) >= $2`,
    [tenantId, opts.minPairs],
  );

  const maxPairs = rows.reduce((max, r) => Math.max(max, Number(r.pairs)), 0);
  const bySource = new Map<string, number>();
  for (const r of rows) bySource.set(r.source_id, (bySource.get(r.source_id) ?? 0) + 1);

  const out: RecScoreRow[] = [];
  for (const r of rows) {
    const rank = bySource.get(r.source_id) ?? 0;
    if (rank > opts.limit) continue;
    out.push({ sourceId: r.source_id, recId: r.rec_id, score: maxPairs ? Number(r.pairs) / maxPairs : 0 });
  }
  return out.sort((a, b) => b.score - a.score);
}

export async function computeRelated(
  db: Db,
  tenantId: string,
  opts: { weightCollection: number; weightTag: number; limit: number },
): Promise<RecScoreRow[]> {
  const { rows } = await db.query<{ source_id: string; rec_id: string; score: string; rn: string }>(
    `WITH active AS (
       SELECT id, tags FROM products WHERE tenant_id = $1 AND status = 'active'
     ),
     shared AS (
       SELECT a.product_id AS source_id, b.product_id AS rec_id, count(*) AS shared_collections
       FROM product_collection a
       JOIN product_collection b ON b.collection_id = a.collection_id AND b.product_id <> a.product_id
       WHERE a.product_id IN (SELECT id FROM active) AND b.product_id IN (SELECT id FROM active)
       GROUP BY a.product_id, b.product_id
     ),
     tagged AS (
       SELECT a.id AS source_id, b.id AS rec_id,
              (SELECT count(*) FROM unnest(a.tags) t WHERE t = ANY(b.tags)) AS shared_tags
       FROM active a
       JOIN active b ON a.id <> b.id
       WHERE a.tags && b.tags
     ),
     scored AS (
       SELECT s.source_id, s.rec_id, s.shared_collections, 0::bigint AS shared_tags
       FROM shared s
       UNION ALL
       SELECT t.source_id, t.rec_id, 0::bigint AS shared_collections, t.shared_tags
       FROM tagged t
     )
     SELECT source_id, rec_id,
            ((($2::numeric * max(shared_collections)) + ($3::numeric * max(shared_tags)))
              / NULLIF($2::numeric + $3::numeric, 0))::text AS score,
            row_number() OVER (PARTITION BY source_id ORDER BY
              (($2::numeric * max(shared_collections)) + ($3::numeric * max(shared_tags)))
              / NULLIF($2::numeric + $3::numeric, 0) DESC, rec_id)::text AS rn
     FROM scored
     GROUP BY source_id, rec_id
     HAVING max(shared_collections) + max(shared_tags) > 0`,
    [tenantId, opts.weightCollection, opts.weightTag],
  );

  return rows
    .filter((r) => Number(r.rn) <= opts.limit)
    .map((r) => ({ sourceId: r.source_id, recId: r.rec_id, score: Number(r.score) }));
}

// ===== Precomputed table =====

export async function replaceRecommendations(
  db: DbPool,
  tenantId: string,
  rows: { sourceProductId: string | null; recommendedProductId: string; strategy: RecommendationStrategy; score: number; rank: number }[],
): Promise<Date> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM product_recommendations WHERE tenant_id = $1", [tenantId]);
    if (rows.length > 0) {
      const values: unknown[] = [];
      const tuples: string[] = [];
      for (const r of rows) {
        values.push(tenantId, r.sourceProductId, r.recommendedProductId, r.strategy, r.score, r.rank);
        tuples.push(`($${values.length - 5}, $${values.length - 4}, $${values.length - 3}, $${values.length - 2}, $${values.length - 1}, $${values.length})`);
      }
      await client.query(
        `INSERT INTO product_recommendations
           (tenant_id, source_product_id, recommended_product_id, strategy, score, rank)
         VALUES ${tuples.join(", ")}`,
        values,
      );
    }
    const { rows: ts } = await client.query<{ generated_at: Date }>(
      "SELECT max(generated_at) AS generated_at FROM product_recommendations WHERE tenant_id = $1",
      [tenantId],
    );
    await client.query("COMMIT");
    return rows.length > 0 ? (ts[0]?.generated_at ?? new Date()) : new Date();
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listStrategyRows(
  db: Db,
  tenantId: string,
  sourceProductId: string | null,
  strategy: RecommendationStrategy,
  limit: number,
): Promise<RecommendationRow[]> {
  const { rows } = await db.query<{ recommended_product_id: string; score: string; rank: number }>(
    `SELECT r.recommended_product_id, r.score::text AS score, r.rank
     FROM product_recommendations r
     JOIN products p ON p.id = r.recommended_product_id AND p.tenant_id = r.tenant_id AND p.status = 'active'
     WHERE r.tenant_id = $1 AND r.strategy = $3
        AND r.source_product_id IS NOT DISTINCT FROM $2
        AND NOT (r.source_product_id IS NOT DISTINCT FROM r.recommended_product_id)
     ORDER BY r.rank ASC, r.score DESC
     LIMIT $4`,
    [tenantId, sourceProductId, strategy, limit],
  );
  return rows.map((r) => ({ recommendedProductId: r.recommended_product_id, score: Number(r.score), rank: r.rank }));
}

export async function recommendationCounts(db: Db, tenantId: string): Promise<Record<string, number>> {
  const { rows } = await db.query<{ strategy: string; n: number }>(
    "SELECT strategy, count(*)::int AS n FROM product_recommendations WHERE tenant_id = $1 GROUP BY strategy",
    [tenantId],
  );
  return Object.fromEntries(rows.map((r) => [r.strategy, r.n]));
}