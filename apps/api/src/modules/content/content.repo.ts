import type { Db, Queryable } from "@beautyai/db";
import type { BrandTone, ContentDraft, ContentType, ContentVersion, CreditLedgerEntry, DraftStatus } from "@beautyai/shared";

interface ToneRow {
  id: string;
  tenant_id: string;
  name: string | null;
  voice: string | null;
  forbidden_words: string[];
  preferred_terms: Record<string, string>;
  sample_phrases: string[];
  language: string;
  updated_at: Date;
}

interface DraftRow {
  id: string;
  tenant_id: string;
  type: ContentType;
  target_type: string | null;
  target_id: string | null;
  title: string | null;
  body: string | null;
  meta_title: string | null;
  meta_description: string | null;
  status: DraftStatus;
  llm_model: string | null;
  prompt_snapshot: Record<string, unknown> | null;
  created_by: string | null;
  approved_at: Date | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  draft_id: string;
  version: number;
  body: string | null;
  meta_title: string | null;
  meta_description: string | null;
  change_summary: string | null;
  created_by: string | null;
  created_at: Date;
}

interface LedgerRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  operation: string;
  amount: number;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface QuotaRow {
  feature: string;
  used: number;
  quota_limit: number;
  period_start: Date;
}

export function toBrandTone(row: ToneRow): BrandTone {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    voice: row.voice,
    forbiddenWords: row.forbidden_words,
    preferredTerms: row.preferred_terms ?? {},
    samplePhrases: row.sample_phrases,
    language: row.language,
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toContentDraft(row: DraftRow): ContentDraft {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    targetType: row.target_type,
    targetId: row.target_id,
    title: row.title,
    body: row.body,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    status: row.status,
    llmModel: row.llm_model,
    promptSnapshot: row.prompt_snapshot,
    createdBy: row.created_by,
    approvedAt: row.approved_at?.toISOString() ?? null,
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toContentVersion(row: VersionRow): ContentVersion {
  return {
    id: row.id,
    draftId: row.draft_id,
    version: row.version,
    body: row.body,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    changeSummary: row.change_summary,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

// ===== Brand tone =====

export async function getBrandTone(db: Db, tenantId: string): Promise<BrandTone | null> {
  const { rows } = await db.query<ToneRow>("SELECT * FROM brand_tones WHERE tenant_id = $1", [tenantId]);
  return rows[0] ? toBrandTone(rows[0]) : null;
}

export async function upsertBrandTone(db: Queryable, tenantId: string, input: Partial<Pick<BrandTone, "name" | "voice" | "forbiddenWords" | "preferredTerms" | "samplePhrases" | "language">>): Promise<BrandTone> {
  const { rows } = await db.query<ToneRow>(
    `INSERT INTO brand_tones (tenant_id, name, voice, forbidden_words, preferred_terms, sample_phrases, language, updated_at)
     VALUES ($1, $2, $3, COALESCE($4, '{}'::text[]), $5, COALESCE($6, '{}'::text[]), COALESCE($7, 'en'::text), now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       name = CASE WHEN $2 IS NULL THEN brand_tones.name ELSE EXCLUDED.name END,
       voice = CASE WHEN $3 IS NULL THEN brand_tones.voice ELSE EXCLUDED.voice END,
       forbidden_words = CASE WHEN $4 IS NULL THEN brand_tones.forbidden_words ELSE EXCLUDED.forbidden_words END,
       preferred_terms = CASE WHEN $5 IS NULL THEN brand_tones.preferred_terms ELSE EXCLUDED.preferred_terms END,
       sample_phrases = CASE WHEN $6 IS NULL THEN brand_tones.sample_phrases ELSE EXCLUDED.sample_phrases END,
       language = CASE WHEN $7 IS NULL THEN brand_tones.language ELSE EXCLUDED.language END,
       updated_at = now()
     RETURNING *`,
    [tenantId, input.name, input.voice, input.forbiddenWords, input.preferredTerms, input.samplePhrases, input.language],
  );
  const row = rows[0];
  return toBrandTone(row!);
}

// ===== Quota & credit ledger =====

export async function getFeatureQuota(db: Db, tenantId: string, feature: string): Promise<QuotaRow | null> {
  const { rows } = await db.query<QuotaRow>(
    `SELECT feature, used, quota_limit, period_start FROM feature_quotas WHERE tenant_id = $1 AND feature = $2`,
    [tenantId, feature],
  );
  return rows[0] ?? null;
}

export async function addLedgerEntry(
  db: Queryable,
  input: { tenantId: string; userId: string | null; operation: string; amount: number; metadata?: Record<string, unknown> | null },
): Promise<CreditLedgerEntry> {
  const { rows } = await db.query<LedgerRow>(
    `INSERT INTO credit_ledger (tenant_id, user_id, operation, amount, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.tenantId, input.userId, input.operation, input.amount, input.metadata ?? null],
  );
  const row = rows[0]!;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    operation: row.operation,
    amount: row.amount,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listLedgerEntries(db: Db, tenantId: string, opts: { page: number; limit: number }): Promise<{ data: CreditLedgerEntry[]; total: number }> {
  const offset = (opts.page - 1) * opts.limit;
  const { rows } = await db.query<LedgerRow>(
    `SELECT * FROM credit_ledger WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [tenantId, opts.limit, offset],
  );
  const { rows: countRows } = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM credit_ledger WHERE tenant_id = $1`,
    [tenantId],
  );
  return {
    data: rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      operation: r.operation,
      amount: r.amount,
      metadata: r.metadata,
      createdAt: r.created_at.toISOString(),
    })),
    total: Number(countRows[0]!.total),
  };
}

// ===== Content drafts =====

export interface CreateDraftInput {
  tenantId: string;
  type: ContentType;
  targetType: string | null;
  targetId: string | null;
  title: string | null;
  body: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  llmModel: string | null;
  promptSnapshot: Record<string, unknown> | null;
  createdBy: string | null;
}

export async function createContentDraft(db: Queryable, input: CreateDraftInput): Promise<ContentDraft> {
  const { rows } = await db.query<DraftRow>(
    `INSERT INTO content_drafts
       (tenant_id, type, target_type, target_id, title, body, meta_title, meta_description, llm_model, prompt_snapshot, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [input.tenantId, input.type, input.targetType, input.targetId, input.title, input.body, input.metaTitle, input.metaDescription, input.llmModel, input.promptSnapshot, input.createdBy],
  );
  const row = rows[0];
  return toContentDraft(row!);
}

export async function findActiveDraft(db: Db, tenantId: string, type: ContentType, targetId: string): Promise<ContentDraft | null> {
  const { rows } = await db.query<DraftRow>(
    `SELECT * FROM content_drafts
     WHERE tenant_id = $1 AND type = $2 AND target_id = $3 AND status IN ('draft', 'approved')
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, type, targetId],
  );
  return rows[0] ? toContentDraft(rows[0]) : null;
}

export async function markDraftsSuperseded(db: Queryable, tenantId: string, type: ContentType, targetId: string, exceptId: string): Promise<void> {
  await db.query(
    `UPDATE content_drafts SET status = 'rejected', updated_at = now()
     WHERE tenant_id = $1 AND type = $2 AND target_id = $3 AND id <> $4 AND status IN ('draft', 'approved')`,
    [tenantId, type, targetId, exceptId],
  );
}

export async function listContentDrafts(
  db: Db,
  tenantId: string,
  opts: { status?: DraftStatus; type?: ContentType; page: number; limit: number },
): Promise<{ data: ContentDraft[]; total: number }> {
  const where: string[] = ["tenant_id = $1"];
  const params: unknown[] = [tenantId];
  if (opts.status) {
    params.push(opts.status);
    where.push(`status = $${params.length}`);
  }
  if (opts.type) {
    params.push(opts.type);
    where.push(`type = $${params.length}`);
  }
  const offset = (opts.page - 1) * opts.limit;
  params.push(opts.limit, offset);
  const filter = where.join(" AND ");
  const { rows } = await db.query<DraftRow>(
    `SELECT * FROM content_drafts WHERE ${filter} ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const { rows: countRows } = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM content_drafts WHERE ${filter}`,
    params.slice(0, params.length - 2),
  );
  return { data: rows.map(toContentDraft), total: Number(countRows[0]!.total) };
}

export async function findContentDraft(db: Queryable, tenantId: string, id: string): Promise<ContentDraft | null> {
  const { rows } = await db.query<DraftRow>("SELECT * FROM content_drafts WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  return rows[0] ? toContentDraft(rows[0]) : null;
}

export async function updateContentDraft(
  db: Queryable,
  input: {
    tenantId: string;
    id: string;
    patch: { title?: string | null; body?: string | null; metaTitle?: string | null; metaDescription?: string | null; changeSummary?: string | null };
    createdBy: string | null;
  },
): Promise<ContentDraft | null> {
  const existing = await findContentDraft(db, input.tenantId, input.id);
  if (!existing) return null;
  if (existing.status === "published") return existing;

  const title = input.patch.title !== undefined ? input.patch.title : existing.title;
  const body = input.patch.body !== undefined ? input.patch.body : existing.body;
  const metaTitle = input.patch.metaTitle !== undefined ? input.patch.metaTitle : existing.metaTitle;
  const metaDescription = input.patch.metaDescription !== undefined ? input.patch.metaDescription : existing.metaDescription;

  await insertVersion(db, {
    draftId: existing.id,
    body: existing.body,
    metaTitle: existing.metaTitle,
    metaDescription: existing.metaDescription,
    changeSummary: input.patch.changeSummary ?? "manual edit",
    createdBy: input.createdBy,
  });

  const nextStatus: DraftStatus = existing.status === "rejected" ? "draft" : existing.status;
  const { rows } = await db.query<DraftRow>(
    `UPDATE content_drafts
     SET title = $3, body = $4, meta_title = $5, meta_description = $6, status = $7, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [input.tenantId, input.id, title, body, metaTitle, metaDescription, nextStatus],
  );
  return rows[0] ? toContentDraft(rows[0]) : null;
}

// ===== Draft lifecycle =====

export async function setDraftStatus(
  db: Queryable,
  tenantId: string,
  id: string,
  status: DraftStatus,
  opts: { approvedAt?: boolean; publishedAt?: boolean } = {},
): Promise<ContentDraft | null> {
  const sets = ["status = $3", "updated_at = now()"];
  const params: unknown[] = [tenantId, id, status];
  if (opts.approvedAt) {
    sets.push("approved_at = now()");
  }
  if (opts.publishedAt) {
    sets.push("published_at = now()");
  }
  const { rows } = await db.query<DraftRow>(
    `UPDATE content_drafts SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return rows[0] ? toContentDraft(rows[0]) : null;
}

// ===== Versions =====

export async function insertVersion(
  db: Queryable,
  input: { draftId: string; body: string | null; metaTitle: string | null; metaDescription: string | null; changeSummary: string | null; createdBy: string | null },
): Promise<ContentVersion> {
  const { rows } = await db.query<VersionRow>(
    `INSERT INTO content_versions (draft_id, version, body, meta_title, meta_description, change_summary, created_by)
     VALUES ($1, (SELECT COALESCE(MAX(version), 0) + 1 FROM content_versions WHERE draft_id = $1), $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.draftId, input.body, input.metaTitle, input.metaDescription, input.changeSummary, input.createdBy],
  );
  const row = rows[0];
  return toContentVersion(row!);
}

export async function listDraftVersions(db: Db, tenantId: string, draftId: string): Promise<ContentVersion[]> {
  const { rows } = await db.query<VersionRow>(
    `SELECT v.* FROM content_versions v
     JOIN content_drafts d ON d.id = v.draft_id
     WHERE d.tenant_id = $1 AND v.draft_id = $2
     ORDER BY v.version DESC`,
    [tenantId, draftId],
  );
  return rows.map(toContentVersion);
}

export async function findVersion(db: Db, tenantId: string, draftId: string, version: number): Promise<ContentVersion | null> {
  const { rows } = await db.query<VersionRow>(
    `SELECT v.* FROM content_versions v
     JOIN content_drafts d ON d.id = v.draft_id
     WHERE d.tenant_id = $1 AND v.draft_id = $2 AND v.version = $3`,
    [tenantId, draftId, version],
  );
  return rows[0] ? toContentVersion(rows[0]) : null;
}

// ===== Product projection (publishing) =====

export async function applyDraftToProduct(
  db: Queryable,
  input: { tenantId: string; productId: string; body: string | null; metaTitle: string | null; metaDescription: string | null },
): Promise<void> {
  await db.query(
    `UPDATE products SET description = COALESCE($3, description), body_html = COALESCE($3, body_html), updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, input.productId, input.body],
  );
  if (input.metaTitle !== null || input.metaDescription !== null) {
    await db.query(
      `INSERT INTO product_seo (tenant_id, product_id, meta_title, meta_description, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, product_id) DO UPDATE SET
         meta_title = COALESCE(EXCLUDED.meta_title, product_seo.meta_title),
         meta_description = COALESCE(EXCLUDED.meta_description, product_seo.meta_description),
         updated_at = now()`,
      [input.tenantId, input.productId, input.metaTitle, input.metaDescription],
    );
  }
}

export async function loadProductAttributes(
  db: Db,
  tenantId: string,
  productId: string,
): Promise<{ id: string; title: string; productType: string | null; vendor: string | null; tags: string[]; attributes: Record<string, unknown>; existingDescription: string | null; existingBodyHtml: string | null } | null> {
  const { rows } = await db.query<{
    id: string;
    title: string;
    product_type: string | null;
    vendor: string | null;
    tags: string[];
    attributes: Record<string, unknown>;
    description: string | null;
    body_html: string | null;
  }>(
    `SELECT id, title, product_type, vendor, tags, attributes, description, body_html
     FROM products WHERE tenant_id = $1 AND id = $2 AND status <> 'archived'`,
    [tenantId, productId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    title: r.title,
    productType: r.product_type,
    vendor: r.vendor,
    tags: r.tags,
    attributes: r.attributes ?? {},
    existingDescription: r.description,
    existingBodyHtml: r.body_html,
  };
}