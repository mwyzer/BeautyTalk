import type { Db, Queryable } from "@beautyai/db";
import type { Audit, AuditIssue, CrawlUrl, IssueFix, IssueStatus, IssueType, RecommendedFix, SeoScore } from "@beautyai/shared";

interface AuditRow {
  id: string;
  tenant_id: string;
  name: string | null;
  status: string;
  crawl_depth: number;
  exclude_patterns: string[];
  total_urls: number;
  progress: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

function toAudit(row: AuditRow): Audit {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    status: row.status as Audit["status"],
    crawlDepth: row.crawl_depth,
    excludePatterns: row.exclude_patterns,
    totalUrls: row.total_urls,
    progress: row.progress,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

interface CrawlUrlRow {
  id: string;
  audit_id: string;
  tenant_id: string;
  url: string;
  status: number | null;
  title: string | null;
  meta_description: string | null;
  meta_title_length: number | null;
  meta_description_length: number | null;
  has_h1: boolean | null;
  has_canonical: boolean | null;
  is_indexable: boolean | null;
  word_count: number | null;
  images_without_alt: number | null;
  broken_links: number | null;
  lighthouse_score: Record<string, unknown> | null;
  crawled_at: string;
}

function toCrawlUrl(row: CrawlUrlRow): CrawlUrl {
  return {
    id: row.id,
    auditId: row.audit_id,
    url: row.url,
    status: row.status,
    title: row.title,
    metaDescription: row.meta_description,
    metaTitleLength: row.meta_title_length,
    metaDescriptionLength: row.meta_description_length,
    hasH1: row.has_h1,
    hasCanonical: row.has_canonical,
    isIndexable: row.is_indexable,
    wordCount: row.word_count,
    imagesWithoutAlt: row.images_without_alt,
    brokenLinks: row.broken_links,
    lighthouseScore: row.lighthouse_score,
    crawledAt: row.crawled_at,
  };
}

interface AuditIssueRow {
  id: string;
  tenant_id: string;
  audit_id: string;
  type: string;
  url: string | null;
  severity: string;
  impact_score: number;
  status: string;
  recommended_fix: RecommendedFix | null;
  fixed_at: string | null;
  created_at: string;
}

function toIssue(row: AuditIssueRow): AuditIssue {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    auditId: row.audit_id,
    type: row.type as IssueType,
    url: row.url,
    severity: row.severity as AuditIssue["severity"],
    impactScore: row.impact_score,
    status: row.status as IssueStatus,
    recommendedFix: row.recommended_fix,
    fixedAt: row.fixed_at,
    createdAt: row.created_at,
  };
}

interface SeoScoreRow {
  id: string;
  tenant_id: string;
  audit_id: string | null;
  score: number;
  categories: Record<string, number>;
  created_at: string;
}

function toScore(row: SeoScoreRow): SeoScore {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    auditId: row.audit_id,
    score: row.score,
    categories: {
      metadata: row.categories.metadata ?? 0,
      content: row.categories.content ?? 0,
      links: row.categories.links ?? 0,
      schema: row.categories.schema ?? 0,
      indexability: row.categories.indexability ?? 0,
    },
    createdAt: row.created_at,
  };
}

// ===== Audits =====

export async function createAudit(
  db: Db,
  input: { tenantId: string; name: string | null; crawlDepth: number; excludePatterns: string[]; createdBy: string | null },
): Promise<Audit> {
  const { rows } = await db.query<AuditRow>(
    `INSERT INTO audits (tenant_id, name, crawl_depth, exclude_patterns, created_by, status)
     VALUES ($1, $2, $3, $4, $5, 'queued')
     RETURNING *`,
    [input.tenantId, input.name, input.crawlDepth, input.excludePatterns, input.createdBy],
  );
  return toAudit(rows[0]!);
}

export async function findAudit(db: Db, tenantId: string, id: string): Promise<Audit | null> {
  const { rows } = await db.query<AuditRow>(`SELECT * FROM audits WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return rows[0] ? toAudit(rows[0]) : null;
}

export async function listAudits(
  db: Db,
  tenantId: string,
  input: { page: number; limit: number },
): Promise<{ data: Audit[]; total: number }> {
  const offset = (input.page - 1) * input.limit;
  const { rows } = await db.query<AuditRow>(
    `SELECT * FROM audits WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [tenantId, input.limit, offset],
  );
  const { rows: count } = await db.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM audits WHERE tenant_id = $1`,
    [tenantId],
  );
  return { data: rows.map(toAudit), total: Number(count[0]?.c ?? 0) };
}

export async function updateAuditStatus(db: Db, tenantId: string, id: string, status: Audit["status"]): Promise<void> {
  await db.query(`UPDATE audits SET status = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, status]);
}

export async function markAuditRunning(db: Db, tenantId: string, id: string): Promise<void> {
  await db.query(
    `UPDATE audits SET status = 'running', started_at = COALESCE(started_at, now())
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
}

export async function markAuditCompleted(db: Db, tenantId: string, id: string, totalUrls: number): Promise<void> {
  await db.query(
    `UPDATE audits SET status = 'completed', total_urls = $3, progress = $3, completed_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, totalUrls],
  );
}

export async function markAuditFailed(db: Db, tenantId: string, id: string): Promise<void> {
  await db.query(
    `UPDATE audits SET status = 'failed', completed_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
}

export async function bumpAuditProgress(db: Db, tenantId: string, id: string, done: number, total: number): Promise<void> {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  await db.query(
    `UPDATE audits SET progress = GREATEST(progress, $3), total_urls = GREATEST(total_urls, $4)
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, percent, total],
  );
}

// ===== Crawl URLs =====

export async function upsertCrawlUrl(
  db: Db,
  input: {
    tenantId: string;
    auditId: string;
    url: string;
    status: number | null;
    title: string | null;
    metaDescription: string | null;
    metaTitleLength: number | null;
    metaDescriptionLength: number | null;
    hasH1: boolean | null;
    hasCanonical: boolean | null;
    isIndexable: boolean | null;
    wordCount: number | null;
    imagesWithoutAlt: number | null;
    brokenLinks: number | null;
    lighthouseScore: Record<string, unknown> | null;
  },
): Promise<CrawlUrl> {
  const { rows } = await db.query<CrawlUrlRow>(
    `INSERT INTO crawl_urls (
       audit_id, tenant_id, url, status, title, meta_description,
       meta_title_length, meta_description_length, has_h1, has_canonical,
       is_indexable, word_count, images_without_alt, broken_links, lighthouse_score
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (audit_id, url) DO UPDATE SET
       status = EXCLUDED.status,
       title = EXCLUDED.title,
       meta_description = EXCLUDED.meta_description,
       meta_title_length = EXCLUDED.meta_title_length,
       meta_description_length = EXCLUDED.meta_description_length,
       has_h1 = EXCLUDED.has_h1,
       has_canonical = EXCLUDED.has_canonical,
       is_indexable = EXCLUDED.is_indexable,
       word_count = EXCLUDED.word_count,
       images_without_alt = EXCLUDED.images_without_alt,
       broken_links = EXCLUDED.broken_links,
       lighthouse_score = EXCLUDED.lighthouse_score,
       crawled_at = now()
     RETURNING *`,
    [
      input.auditId,
      input.tenantId,
      input.url,
      input.status,
      input.title,
      input.metaDescription,
      input.metaTitleLength,
      input.metaDescriptionLength,
      input.hasH1,
      input.hasCanonical,
      input.isIndexable,
      input.wordCount,
      input.imagesWithoutAlt,
      input.brokenLinks,
      input.lighthouseScore,
    ],
  );
  return toCrawlUrl(rows[0]!);
}

export async function listCrawlUrls(
  db: Db,
  tenantId: string,
  auditId: string,
  input: { page: number; limit: number },
): Promise<{ data: CrawlUrl[]; total: number }> {
  const offset = (input.page - 1) * input.limit;
  const { rows } = await db.query<CrawlUrlRow>(
    `SELECT * FROM crawl_urls WHERE tenant_id = $1 AND audit_id = $2
     ORDER BY crawled_at DESC
     LIMIT $3 OFFSET $4`,
    [tenantId, auditId, input.limit, offset],
  );
  const { rows: count } = await db.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM crawl_urls WHERE tenant_id = $1 AND audit_id = $2`,
    [tenantId, auditId],
  );
  return { data: rows.map(toCrawlUrl), total: Number(count[0]?.c ?? 0) };
}

// ===== Issues =====

export async function insertIssue(
  db: Queryable,
  input: { tenantId: string; auditId: string; type: IssueType; url: string; severity: AuditIssue["severity"]; impactScore: number; recommendedFix: RecommendedFix | null },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_issues (tenant_id, audit_id, type, url, severity, impact_score, recommended_fix, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'open')
     ON CONFLICT (audit_id, url, type) DO UPDATE SET
       severity = EXCLUDED.severity,
       impact_score = EXCLUDED.impact_score,
       recommended_fix = EXCLUDED.recommended_fix,
       status = 'open'`,
    [input.tenantId, input.auditId, input.type, input.url, input.severity, input.impactScore, JSON.stringify(input.recommendedFix)],
  );
}

export async function listIssues(
  db: Db,
  tenantId: string,
  input: { auditId: string; status?: string; severity?: string; page: number; limit: number },
): Promise<{ data: AuditIssue[]; total: number }> {
  const offset = (input.page - 1) * input.limit;
  const conditions = ["tenant_id = $1", "audit_id = $2"];
  const values: Array<string | number> = [tenantId, input.auditId];
  if (input.status) {
    values.push(input.status);
    conditions.push(`status = $${values.length}`);
  }
  if (input.severity) {
    values.push(input.severity);
    conditions.push(`severity = $${values.length}`);
  }
  const where = conditions.join(" AND ");
  const { rows } = await db.query<AuditIssueRow>(
    `SELECT * FROM audit_issues WHERE ${where}
     ORDER BY impact_score DESC, created_at DESC
     LIMIT ${input.limit} OFFSET ${offset}`,
    values,
  );
  const { rows: count } = await db.query<{ c: string }>(`SELECT count(*)::text AS c FROM audit_issues WHERE ${where}`, values);
  return { data: rows.map(toIssue), total: Number(count[0]?.c ?? 0) };
}

export async function findIssue(db: Db, tenantId: string, auditId: string, id: string): Promise<AuditIssue | null> {
  const { rows } = await db.query<AuditIssueRow>(
    `SELECT * FROM audit_issues WHERE tenant_id = $1 AND audit_id = $2 AND id = $3`,
    [tenantId, auditId, id],
  );
  return rows[0] ? toIssue(rows[0]) : null;
}

export async function setIssueStatus(db: Db, tenantId: string, issueId: string, status: IssueStatus): Promise<AuditIssue | null> {
  const { rows } = await db.query<AuditIssueRow>(
    `UPDATE audit_issues SET
       status = $3::issue_status,
       fixed_at = CASE
         WHEN $3::text = 'fixed' THEN now()
         WHEN $3::text = 'dismissed' THEN NULL
         ELSE fixed_at
       END
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenantId, issueId, status],
  );
  return rows[0] ? toIssue(rows[0]) : null;
}

export async function countOpenIssues(db: Db, tenantId: string, auditId: string): Promise<number> {
  const { rows } = await db.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM audit_issues WHERE tenant_id = $1 AND audit_id = $2 AND status = 'open'`,
    [tenantId, auditId],
  );
  return Number(rows[0]?.c ?? 0);
}

export async function openIssueImpactByUrl(
  db: Db,
  tenantId: string,
  auditId: string,
): Promise<Array<{ url: string; impactScore: number }>> {
  const { rows } = await db.query<{ url: string; impact_sum: string }>(
    `SELECT url, sum(impact_score)::text AS impact_sum
     FROM audit_issues
     WHERE tenant_id = $1 AND audit_id = $2 AND status = 'open' AND url IS NOT NULL
     GROUP BY url`,
    [tenantId, auditId],
  );
  return rows.map((r) => ({ url: r.url, impactScore: Number(r.impact_sum ?? 0) }));
}

export async function listCrawlUrlUrls(db: Db, tenantId: string, auditId: string): Promise<string[]> {
  const { rows } = await db.query<{ url: string }>(
    `SELECT url FROM crawl_urls WHERE tenant_id = $1 AND audit_id = $2`,
    [tenantId, auditId],
  );
  return rows.map((r) => r.url);
}

export async function listOpenIssues(db: Db, tenantId: string, auditId: string): Promise<Array<{ url: string; type: string; impactScore: number }>> {
  const { rows } = await db.query<{ url: string; type: string; impact_score: number }>(
    `SELECT url, type, impact_score FROM audit_issues
     WHERE tenant_id = $1 AND audit_id = $2 AND status = 'open' AND url IS NOT NULL`,
    [tenantId, auditId],
  );
  return rows.map((r) => ({ url: r.url, type: r.type, impactScore: r.impact_score }));
}

// ===== Scores =====

export async function insertSeoScore(
  db: Db,
  input: { tenantId: string; auditId: string; score: number; categories: SeoScore["categories"] },
): Promise<SeoScore> {
  const { rows } = await db.query<SeoScoreRow>(
    `INSERT INTO seo_scores (tenant_id, audit_id, score, categories)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, created_at) DO NOTHING
     RETURNING *`,
    [input.tenantId, input.auditId, input.score, JSON.stringify(input.categories)],
  );
  if (rows[0]) return toScore(rows[0]);
  const latest = await latestSeoScore(db, input.tenantId);
  return latest!;
}

export async function latestSeoScore(db: Db, tenantId: string): Promise<SeoScore | null> {
  const { rows } = await db.query<SeoScoreRow>(
    `SELECT * FROM seo_scores WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [tenantId],
  );
  return rows[0] ? toScore(rows[0]) : null;
}

export async function scoreHistory(db: Db, tenantId: string, limit: number): Promise<SeoScore[]> {
  const { rows } = await db.query<SeoScoreRow>(
    `SELECT * FROM seo_scores WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT $2`,
    [tenantId, limit],
  );
  return rows.map(toScore);
}

// ===== Fixes =====

export async function insertIssueFix(
  db: Db,
  input: { tenantId: string; issueId: string; type: IssueType; before: Record<string, unknown> | null; after: Record<string, unknown> | null; result: string; createdBy: string | null },
): Promise<IssueFix> {
  const { rows } = await db.query<{
    id: string;
    tenant_id: string;
    issue_id: string;
    type: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    result: string | null;
    created_at: string;
  }>(
    `INSERT INTO issue_fixes (tenant_id, issue_id, type, before, after, result, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.tenantId,
      input.issueId,
      input.type,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.result,
      input.createdBy,
    ],
  );
  const row = rows[0]!;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    issueId: row.issue_id,
    type: row.type as IssueType,
    before: row.before,
    after: row.after,
    result: row.result,
    createdAt: row.created_at,
  };
}

// ===== Auto-fix targets (product metadata / image alt) =====

export async function findProductByHandle(db: Db, tenantId: string, handle: string): Promise<{ id: string; title: string } | null> {
  const { rows } = await db.query<{ id: string; title: string }>(
    `SELECT id, title FROM products WHERE tenant_id = $1 AND handle = $2 AND status <> 'archived'`,
    [tenantId, handle],
  );
  return rows[0] ?? null;
}

export async function getProductSeo(db: Db, tenantId: string, productId: string): Promise<{ meta_title: string | null; meta_description: string | null } | null> {
  const { rows } = await db.query<{ meta_title: string | null; meta_description: string | null }>(
    `SELECT meta_title, meta_description FROM product_seo WHERE tenant_id = $1 AND product_id = $2`,
    [tenantId, productId],
  );
  return rows[0] ?? null;
}

export async function applyProductSeoFix(
  db: Db,
  input: { tenantId: string; productId: string; metaTitle: string; metaDescription: string },
): Promise<void> {
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

export async function setProductImageAlt(db: Db, tenantId: string, productId: string, alt: string): Promise<number> {
  const { rows } = await db.query<{ c: string }>(
    `UPDATE product_images SET alt = $3, updated_at = now()
     WHERE tenant_id = $1 AND product_id = $2 AND (alt IS NULL OR trim(alt) = '')
     RETURNING 1`,
    [tenantId, productId, alt],
  );
  return rows.length;
}