import type { DbPool, Queryable } from "@beautyai/db";
import type { ContentDraft, ContentType, ContentVersion, ContentGenerateInput } from "@beautyai/shared";
import type { ContentProvider, ToneInput } from "../../content/types.js";
import { ApiError } from "../../lib/http.js";
import { writeAuditLog } from "../../repositories/audit-logs.repo.js";
import {
  addLedgerEntry,
  applyDraftToProduct,
  createContentDraft,
  getBrandTone,
  getFeatureQuota,
  listLedgerEntries,
  listContentDrafts,
  findActiveDraft,
  findContentDraft,
  findVersion,
  listDraftVersions,
  loadProductAttributes,
  markDraftsSuperseded,
  setDraftStatus,
  updateContentDraft,
  upsertBrandTone,
} from "./content.repo.js";
import type { BrandTone } from "@beautyai/shared";

export const CONTENT_CREDIT_FEATURE = "content_credits";
const DEFAULT_CREDIT_LIMIT = -1;

const DEFAULT_TONE: ToneInput = {
  voice: null,
  forbiddenWords: [],
  preferredTerms: {},
  samplePhrases: [],
  language: "en",
};

async function inTx<T>(db: DbPool, fn: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface ContentServiceDeps {
  db: DbPool;
  provider: ContentProvider | null;
}

export interface GenerateResult {
  drafts: ContentDraft[];
  cached: number;
}

export interface ContentService {
  canGenerate(): boolean;
  generate(input: { tenantId: string; userId: string; body: ContentGenerateInput }): Promise<GenerateResult>;
  listDrafts(input: { tenantId: string; status?: string; type?: string; page: number; limit: number }): Promise<{ data: ContentDraft[]; total: number }>;
  getDraft(tenantId: string, id: string): Promise<ContentDraft>;
  editDraft(input: { tenantId: string; id: string; patch: { title?: string | null; body?: string | null; metaTitle?: string | null; metaDescription?: string | null; changeSummary?: string | null }; userId: string }): Promise<ContentDraft>;
  approveDraft(tenantId: string, id: string): Promise<ContentDraft>;
  rejectDraft(tenantId: string, id: string): Promise<ContentDraft>;
  publishDraft(input: { tenantId: string; id: string; userId: string }): Promise<ContentDraft>;
  restoreVersion(tenantId: string, id: string, version: number): Promise<ContentDraft>;
  listVersions(tenantId: string, id: string): Promise<ContentVersion[]>;
  getTone(tenantId: string): Promise<BrandTone | null>;
  upsertTone(tenantId: string, patch: Parameters<typeof upsertBrandTone>[2]): Promise<BrandTone>;
  getCredits(tenantId: string): Promise<{ feature: string; used: number; quotaLimit: number; history: Awaited<ReturnType<typeof listLedgerEntries>>["data"] }>;
}

function toneOf(brandTone: BrandTone | null): ToneInput {
  return brandTone
    ? {
        voice: brandTone.voice,
        forbiddenWords: brandTone.forbiddenWords,
        preferredTerms: brandTone.preferredTerms,
        samplePhrases: brandTone.samplePhrases,
        language: brandTone.language,
      }
    : DEFAULT_TONE;
}

async function reserveCredits(db: Queryable, tenantId: string, amount: number): Promise<{ used: number; quotaLimit: number }> {
  if (amount <= 0) return { used: 0, quotaLimit: DEFAULT_CREDIT_LIMIT };
  const { rows } = await db.query<{ used: number; quota_limit: number }>(
    `INSERT INTO feature_quotas (tenant_id, feature, used, quota_limit, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (tenant_id, feature) DO UPDATE
       SET used = feature_quotas.used + $3, updated_at = now()
     WHERE feature_quotas.quota_limit < 0 OR feature_quotas.used + $3 <= feature_quotas.quota_limit
     RETURNING used, quota_limit`,
    [tenantId, CONTENT_CREDIT_FEATURE, amount, DEFAULT_CREDIT_LIMIT],
  );
  if (!rows[0]) throw ApiError.rateLimited(`Content credit quota exceeded for ${CONTENT_CREDIT_FEATURE}`);
  return { used: rows[0].used, quotaLimit: rows[0].quota_limit };
}

async function releaseCredits(db: Queryable, tenantId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await db.query(
    `UPDATE feature_quotas SET used = GREATEST(0, used - $3), updated_at = now()
     WHERE tenant_id = $1 AND feature = $2`,
    [tenantId, CONTENT_CREDIT_FEATURE, amount],
  );
}

function snapshot(payload: Record<string, unknown>): Record<string, unknown> {
  return payload;
}

export function createContentService({ db, provider }: ContentServiceDeps): ContentService {
  const requireProvider = (): ContentProvider => {
    if (!provider) {
      throw ApiError.serviceUnavailable("Content generation is not configured (OPENAI_API_KEY missing)");
    }
    return provider;
  };

  const generateOne = async (input: {
    tenantId: string;
    userId: string;
    type: Exclude<ContentType, "blog">;
    targetId: string;
    regenerate: boolean;
  }): Promise<{ draft: ContentDraft; cached: boolean }> => {
    const providerClient = requireProvider();
    const product = await loadProductAttributes(db, input.tenantId, input.targetId);
    if (!product) throw ApiError.notFound("Product not found");

    if (!input.regenerate) {
      const existing = await findActiveDraft(db, input.tenantId, input.type, input.targetId);
      if (existing) return { draft: existing, cached: true };
    }

    const brandTone = await getBrandTone(db, input.tenantId);
    const tone = toneOf(brandTone);
    const promptInput = { product, tone };

    let draft: ContentDraft;
    if (input.type === "meta") {
      const { meta, model } = await providerClient.generateProductMeta(promptInput);
      draft = await inTx(db, async (client) => {
        const created = await createContentDraft(client, {
          tenantId: input.tenantId,
          type: "meta",
          targetType: "product",
          targetId: product.id,
          title: null,
          body: null,
          metaTitle: meta.metaTitle,
          metaDescription: meta.metaDescription,
          llmModel: model,
          promptSnapshot: snapshot({ productId: product.id, type: input.type, regenerated: input.regenerate }),
          createdBy: input.userId,
        });
        await markDraftsSuperseded(client, input.tenantId, "meta", product.id, created.id);
        await addLedgerEntry(client, {
          tenantId: input.tenantId,
          userId: input.userId,
          operation: "content.generated",
          amount: -1,
          metadata: { type: input.type, draft_id: created.id, product_id: product.id },
        });
        return created;
      });
    } else {
      const { text, model } = await providerClient.generateProductDescription(promptInput);
      draft = await inTx(db, async (client) => {
        const created = await createContentDraft(client, {
          tenantId: input.tenantId,
          type: "product_description",
          targetType: "product",
          targetId: product.id,
          title: null,
          body: text,
          metaTitle: null,
          metaDescription: null,
          llmModel: model,
          promptSnapshot: snapshot({ productId: product.id, type: input.type, regenerated: input.regenerate }),
          createdBy: input.userId,
        });
        await markDraftsSuperseded(client, input.tenantId, "product_description", product.id, created.id);
        await addLedgerEntry(client, {
          tenantId: input.tenantId,
          userId: input.userId,
          operation: "content.generated",
          amount: -1,
          metadata: { type: input.type, draft_id: created.id, product_id: product.id },
        });
        return created;
      });
    }
    return { draft, cached: false };
  };

  return {
    canGenerate: () => provider !== null,

    async generate({ tenantId, userId, body }) {
      requireProvider();
      if (body.type === "blog") throw ApiError.badRequest("blog generation is not supported yet");
      const type = body.type as Exclude<ContentType, "blog">;

      const targets = await Promise.all(
        body.targetIds.map(async (targetId) => {
          const product = await loadProductAttributes(db, tenantId, targetId);
          if (!product) throw ApiError.notFound("Product not found");
          return product;
        }),
      );

      const cachedTargets = new Set<string>();
      if (!body.regenerate) {
        for (const p of targets) {
          if (await findActiveDraft(db, tenantId, type, p.id)) cachedTargets.add(p.id);
        }
      }

      const needed = targets.length - cachedTargets.size;
      let reserved = needed;
      if (needed > 0) await reserveCredits(db, tenantId, needed);

      const drafts: ContentDraft[] = [];
      try {
        for (const target of targets) {
          if (cachedTargets.has(target.id)) {
            const cached = await findActiveDraft(db, tenantId, type, target.id);
            if (cached) drafts.push(cached);
            continue;
          }
          const { draft } = await generateOne({
            tenantId,
            userId,
            type,
            targetId: target.id,
            regenerate: body.regenerate,
          });
          reserved -= 1;
          drafts.push(draft);
        }
      } catch (err) {
        if (reserved > 0) await releaseCredits(db, tenantId, reserved);
        throw err;
      }
      return { drafts, cached: cachedTargets.size };
    },

    async listDrafts({ tenantId, status, type, page, limit }) {
      return listContentDrafts(db, tenantId, {
        status: (status as never) || undefined,
        type: (type as never) || undefined,
        page,
        limit,
      });
    },

    async getDraft(tenantId, id) {
      const draft = await findContentDraft(db, tenantId, id);
      if (!draft) throw ApiError.notFound("Draft not found");
      return draft;
    },

    async editDraft({ tenantId, id, patch, userId }) {
      const updated = await updateContentDraft(db, {
        tenantId,
        id,
        patch,
        createdBy: userId,
      });
      if (!updated) throw ApiError.notFound("Draft not found");
      return updated;
    },

    async approveDraft(tenantId, id) {
      const draft = await findContentDraft(db, tenantId, id);
      if (!draft) throw ApiError.notFound("Draft not found");
      if (draft.status === "published") throw ApiError.conflict("Published drafts cannot be approved");
      const hasContent = Boolean(draft.body || draft.metaTitle || draft.metaDescription);
      if (!hasContent) throw ApiError.badRequest("Draft has no content to approve");
      const updated = await setDraftStatus(db, tenantId, id, "approved", { approvedAt: true });
      return updated!;
    },

    async rejectDraft(tenantId, id) {
      const draft = await findContentDraft(db, tenantId, id);
      if (!draft) throw ApiError.notFound("Draft not found");
      if (draft.status === "published") throw ApiError.conflict("Published drafts cannot be rejected");
      const updated = await setDraftStatus(db, tenantId, id, "rejected");
      return updated!;
    },

    async publishDraft({ tenantId, id, userId }) {
      const draft = await findContentDraft(db, tenantId, id);
      if (!draft) throw ApiError.notFound("Draft not found");
      if (draft.status !== "approved") throw ApiError.conflict("Only approved drafts can be published");
      const published = await inTx(db, async (client) => {
        if (draft.targetType === "product" && draft.targetId) {
          await applyDraftToProduct(client, {
            tenantId,
            productId: draft.targetId!,
            body: draft.body,
            metaTitle: draft.metaTitle,
            metaDescription: draft.metaDescription,
          });
        }
        await addLedgerEntry(client, {
          tenantId,
          userId,
          operation: "content.published",
          amount: 0,
          metadata: { draft_id: draft.id },
        });
        const updated = await setDraftStatus(client, tenantId, id, "published", { publishedAt: true });
        return updated!;
      });
      await writeAuditLog(db, {
        tenantId,
        userId,
        action: "content.publish",
        resourceType: "content_draft",
        resourceId: draft.id,
        after: { targetType: draft.targetType, targetId: draft.targetId },
      });
      return published;
    },

    async restoreVersion(tenantId, id, version) {
      const draft = await findContentDraft(db, tenantId, id);
      if (!draft) throw ApiError.notFound("Draft not found");
      const stored = await findVersion(db, tenantId, id, version);
      if (!stored) throw ApiError.notFound("Version not found");
      const updated = await updateContentDraft(db, {
        tenantId,
        id,
        patch: {
          title: stored.metaTitle,
          body: stored.body,
          metaTitle: stored.metaTitle,
          metaDescription: stored.metaDescription,
          changeSummary: `restored from version ${stored.version}`,
        },
        createdBy: draft.createdBy,
      });
      if (!updated) throw ApiError.notFound("Draft not found");
      return updated;
    },

    async listVersions(tenantId, id) {
      const draft = await findContentDraft(db, tenantId, id);
      if (!draft) throw ApiError.notFound("Draft not found");
      return listDraftVersions(db, tenantId, id);
    },

    async getTone(tenantId) {
      return getBrandTone(db, tenantId);
    },

    async upsertTone(tenantId, patch) {
      return upsertBrandTone(db, tenantId, patch);
    },

    async getCredits(tenantId) {
      const quota = await getFeatureQuota(db, tenantId, CONTENT_CREDIT_FEATURE);
      const { data: history } = await listLedgerEntries(db, tenantId, { page: 1, limit: 50 });
      return {
        feature: CONTENT_CREDIT_FEATURE,
        used: quota?.used ?? 0,
        quotaLimit: quota?.quota_limit ?? DEFAULT_CREDIT_LIMIT,
        history,
      };
    },
  };
}