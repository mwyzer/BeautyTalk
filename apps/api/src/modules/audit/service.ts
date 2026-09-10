import type { Db } from "@beautyai/db";
import type { Audit, AuditIssue, CrawlUrl, IssueFix, IssueType, SeoScore, CreateAuditInput } from "@beautyai/shared";
import { crawl, type CrawlOptions, type PageSnapshot } from "../../audit/crawler.js";
import { computeAuditScore, computeUrlScore, detectIssues, categoryForType, type DetectedIssue, type UrlScore } from "../../audit/rules.js";
import { ApiError } from "../../lib/http.js";
import { writeAuditLog } from "../../repositories/audit-logs.repo.js";
import {
  applyProductSeoFix,
  bumpAuditProgress,
  countOpenIssues,
  createAudit,
  findAudit,
  findIssue,
  findProductByHandle,
  getProductSeo,
  insertIssue,
  insertIssueFix,
  insertSeoScore,
  latestSeoScore,
  listAudits,
  listCrawlUrlUrls,
  listCrawlUrls,
  listIssues,
  listOpenIssues,
  markAuditCompleted,
  markAuditFailed,
  markAuditRunning,
  scoreHistory,
  setIssueStatus,
  setProductImageAlt,
  updateAuditStatus,
  upsertCrawlUrl,
} from "./audit.repo.js";

export interface AuditServiceDeps {
  db: Db;
  storefrontUrl: string;
  crawl: (opts: Omit<CrawlOptions, "baseUrl">) => ReturnType<typeof crawl>;
}

export interface AuditDepsWithCrawl extends Partial<AuditServiceDeps> {
  db: Db;
  storefrontUrl: string;
}

export interface AuditService {
  startAudit(input: { tenantId: string; userId: string | null; body: CreateAuditInput }): Promise<Audit>;
  queueAudit(input: { tenantId: string; userId: string | null; body: CreateAuditInput }): Promise<Audit>;
  runAudit(tenantId: string, auditId: string): Promise<Audit>;
  listAudits(tenantId: string, page: number, limit: number): Promise<{ data: Audit[]; total: number }>;
  getAudit(tenantId: string, auditId: string): Promise<{ audit: Audit; score: SeoScore | null; openIssues: number }>;
  listIssues(tenantId: string, auditId: string, opts: { status?: string; severity?: string; page: number; limit: number }): Promise<{ data: AuditIssue[]; total: number }>;
  listCrawlUrls(tenantId: string, auditId: string, page: number, limit: number): Promise<{ data: CrawlUrl[]; total: number }>;
  latestScore(tenantId: string): Promise<SeoScore | null>;
  scoreHistory(tenantId: string, limit: number): Promise<SeoScore[]>;
  recomputeScore(tenantId: string, auditId: string): Promise<SeoScore>;
  fixIssue(input: { tenantId: string; auditId: string; issueId: string; userId: string | null }): Promise<AuditIssue>;
  dismissIssue(input: { tenantId: string; auditId: string; issueId: string; userId: string | null }): Promise<AuditIssue>;
}

const PRODUCT_ISSUES: IssueType[] = ["missing-title", "meta-title-too-long", "meta-title-too-short", "missing-meta-description", "meta-description-too-long", "images-without-alt"];

function productHandleFromUrl(url: string): string | null {
  const match = /\/products\/([a-z0-9-]+)(?:\/|\?|$)/i.exec(url);
  return match?.[1] ?? null;
}

export function createAuditService(deps: AuditDepsWithCrawl): AuditService {
  const crawler = deps.crawl ?? (async (opts) => crawl({ ...opts, baseUrl: deps.storefrontUrl }));

  async function persistPage(db: Db, tenantId: string, auditId: string, snapshot: PageSnapshot, index: number, total: number): Promise<UrlScore> {
    const urlScore = computeUrlScore(snapshot, detectIssues(snapshot));
    await upsertCrawlUrl(db, {
      tenantId,
      auditId,
      url: snapshot.url,
      status: snapshot.status,
      title: snapshot.title,
      metaDescription: snapshot.metaDescription,
      metaTitleLength: snapshot.titleLength,
      metaDescriptionLength: snapshot.metaDescriptionLength,
      hasH1: snapshot.h1Count > 0,
      hasCanonical: snapshot.hasCanonical,
      isIndexable: snapshot.isIndexable,
      wordCount: snapshot.wordCount,
      imagesWithoutAlt: snapshot.imagesWithoutAlt,
      brokenLinks: snapshot.brokenLinks,
      lighthouseScore: snapshot.status !== null ? { loadTimeMs: snapshot.loadTimeMs, transferBytes: snapshot.transferBytes } : null,
    });
    for (const issue of urlScore.issues) {
      await insertIssue(db, {
        tenantId,
        auditId,
        type: issue.type,
        url: snapshot.url,
        severity: issue.severity,
        impactScore: issue.impactScore,
        recommendedFix: issue.recommendedFix,
      });
    }
    await bumpAuditProgress(db, tenantId, auditId, index, total);
    return urlScore;
  }

  async function runCrawl(tenantId: string, auditId: string, crawlDepth: number): Promise<UrlScore[]> {
    const urlScores: UrlScore[] = [];
    const result = await crawler({
      maxUrls: 250,
      maxDepth: crawlDepth,
      politenessMs: 250,
      timeoutMs: 8_000,
      userAgent: "BeautyAI-SEO-Auditor/1.0 (+BeautyAI bot, admin-triggered crawl)",
      excludePatterns: [],
      linkCheckBudget: 200,
      onPage: async (snapshot, index, total) => {
        urlScores.push(await persistPage(deps.db, tenantId, auditId, snapshot, index, total));
      },
    });
    return urlScores.length > 0 ? urlScores : [];
  }

  return {
    async queueAudit({ tenantId, userId, body }) {
      const audit = await createAudit(deps.db, {
        tenantId,
        name: body.name ?? null,
        crawlDepth: body.crawlDepth ?? 3,
        excludePatterns: body.excludePatterns ?? [],
        createdBy: userId,
      });
      await writeAuditLog(deps.db, {
        tenantId,
        userId: userId ?? undefined,
        action: "audit.start",
        resourceType: "audit",
        resourceId: audit.id,
        after: { name: audit.name, crawlDepth: audit.crawlDepth },
      });
      return audit;
    },

    async startAudit({ tenantId, userId, body }) {
      const audit = await this.queueAudit({ tenantId, userId, body });
      try {
        await this.runAudit(tenantId, audit.id);
      } catch (err) {
        await markAuditFailed(deps.db, tenantId, audit.id);
        throw err;
      }
      return audit;
    },

    async runAudit(tenantId, auditId) {
      const audit = await findAudit(deps.db, tenantId, auditId);
      if (!audit) throw ApiError.notFound("Audit not found");
      await markAuditRunning(deps.db, tenantId, auditId);
      try {
        const urlScores = await runCrawl(tenantId, auditId, audit.crawlDepth);
        const summary = computeAuditScore(urlScores);
        await insertSeoScore(deps.db, {
          tenantId,
          auditId,
          score: summary.score,
          categories: summary.categories,
        });
        await markAuditCompleted(deps.db, tenantId, auditId, summary.urlCount);
        return (await findAudit(deps.db, tenantId, auditId))!;
      } catch (err) {
        await markAuditFailed(deps.db, tenantId, auditId);
        if (err instanceof ApiError) throw err;
        throw new Error("Crawl failed: " + (err instanceof Error ? err.message : String(err)));
      }
    },

    async listAudits(tenantId, page, limit) {
      return listAudits(deps.db, tenantId, { page, limit });
    },

    async getAudit(tenantId, auditId) {
      const audit = await findAudit(deps.db, tenantId, auditId);
      if (!audit) throw ApiError.notFound("Audit not found");
      const score = await latestSeoScore(deps.db, tenantId);
      const openIssues = await countOpenIssues(deps.db, tenantId, auditId);
      return { audit, score, openIssues };
    },

    async listIssues(tenantId, auditId, opts) {
      return listIssues(deps.db, tenantId, { auditId, status: opts.status, severity: opts.severity, page: opts.page, limit: opts.limit });
    },

    async listCrawlUrls(tenantId, auditId, page, limit) {
      return listCrawlUrls(deps.db, tenantId, auditId, { page, limit });
    },

    async latestScore(tenantId) {
      return latestSeoScore(deps.db, tenantId);
    },

    async scoreHistory(tenantId, limit) {
      return scoreHistory(deps.db, tenantId, limit);
    },

    async recomputeScore(tenantId, auditId) {
      const audit = await findAudit(deps.db, tenantId, auditId);
      if (!audit) throw ApiError.notFound("Audit not found");
      const urls = await listCrawlUrlUrls(deps.db, tenantId, auditId);
      const zeroCategories: SeoScore["categories"] = { metadata: 0, content: 0, links: 0, schema: 0, indexability: 0 };
      if (urls.length === 0) {
        return insertSeoScore(deps.db, { tenantId, auditId, score: 0, categories: zeroCategories });
      }
      const openIssues = await listOpenIssues(deps.db, tenantId, auditId);
      const byUrl = new Map<string, Partial<SeoScore["categories"]>>();
      for (const issue of openIssues) {
        const category = categoryForType(issue.type as never);
        const urlMap = byUrl.get(issue.url ?? "") ?? {};
        urlMap[category] = (urlMap[category] ?? 0) + issue.impactScore;
        byUrl.set(issue.url ?? "", urlMap);
      }
      const categories: SeoScore["categories"] = { metadata: 0, content: 0, links: 0, schema: 0, indexability: 0 };
      let scoreSum = 0;
      let weightSum = 0;
      const keys = Object.keys(categories) as Array<keyof SeoScore["categories"]>;
      for (const url of urls) {
        const weight = /\/products\/[a-z0-9-]+/i.test(url) ? 2 : 1;
        const urlMap = byUrl.get(url) ?? {};
        let urlScore = 100;
        for (const category of keys) {
          const impact = urlMap[category] ?? 0;
          categories[category] = (categories[category] ?? 0) + Math.max(0, 100 - impact);
          urlScore -= impact;
        }
        scoreSum += Math.max(0, urlScore) * weight;
        weightSum += weight;
      }
      for (const category of keys) {
        categories[category] = Math.round((categories[category] ?? 0) / urls.length);
      }
      return insertSeoScore(deps.db, {
        tenantId,
        auditId,
        score: Math.round(scoreSum / weightSum),
        categories,
      });
    },

    async fixIssue({ tenantId, auditId, issueId, userId }) {
      const issue = await findIssue(deps.db, tenantId, auditId, issueId);
      if (!issue) throw ApiError.notFound("Issue not found");
      if (issue.status === "fixed") return issue;
      if (!PRODUCT_ISSUES.includes(issue.type)) throw ApiError.conflict("This issue type is not auto-fixable");

      const handle = issue.url ? productHandleFromUrl(issue.url) : null;
      if (!handle) throw ApiError.conflict("This issue is not attached to a product page");
      const product = await findProductByHandle(deps.db, tenantId, handle);
      if (!product) throw ApiError.conflict(`Product "${handle}" not found`);

      const before = await getProductSeo(deps.db, tenantId, product.id);
      const after: Record<string, unknown> = { ...(before ?? {}) };

      if (issue.type === "images-without-alt") {
        const updated = await setProductImageAlt(deps.db, tenantId, product.id, product.title);
        await insertIssueFix(deps.db, {
          tenantId,
          issueId: issue.id,
          type: issue.type,
          before,
          after: { imagesUpdated: updated },
          result: `Set alt text on ${product.title} images`,
          createdBy: userId,
        });
      } else {
        const fix = issue.recommendedFix?.fields ?? {};
        const metaTitle = (fix.metaTitle as string | undefined) ?? (before?.meta_title ?? undefined);
        const metaDesc = (fix.metaDescription as string | undefined) ?? (before?.meta_description ?? undefined);
        await applyProductSeoFix(deps.db, {
          tenantId,
          productId: product.id,
          metaTitle: metaTitle ?? "",
          metaDescription: metaDesc ?? "",
        });
        after.meta_title = metaTitle ?? null;
        after.meta_description = metaDesc ?? null;
        await insertIssueFix(deps.db, {
          tenantId,
          issueId: issue.id,
          type: issue.type,
          before,
          after,
          result: `Applied metadata fix to ${product.title}`,
          createdBy: userId,
        });
      }

      const updated = await setIssueStatus(deps.db, tenantId, issue.id, "fixed");
      await writeAuditLog(deps.db, {
        tenantId,
        userId: userId ?? undefined,
        action: "audit.issue_fix",
        resourceType: "audit_issue",
        resourceId: issue.id,
        after: { type: issue.type, url: issue.url },
      });
      await this.recomputeScore(tenantId, auditId);
      return updated!;
    },

    async dismissIssue({ tenantId, auditId, issueId, userId }) {
      const issue = await findIssue(deps.db, tenantId, auditId, issueId);
      if (!issue) throw ApiError.notFound("Issue not found");
      const updated = await setIssueStatus(deps.db, tenantId, issue.id, "dismissed");
      await writeAuditLog(deps.db, {
        tenantId,
        userId: userId ?? undefined,
        action: "audit.issue_dismiss",
        resourceType: "audit_issue",
        resourceId: issue.id,
      });
      await this.recomputeScore(tenantId, auditId);
      return updated!;
    },
  };
}