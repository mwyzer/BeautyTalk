import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPool } from "@beautyai/db";
import { makeTestAppWith, setupTestDb, truncateAll } from "../../test/helpers.js";
import { createAuditService } from "./index.js";
import type { CrawlOptions, CrawlResult, PageSnapshot } from "../../audit/crawler.js";
import type { AuditIssue } from "@beautyai/shared";

interface Owner {
  token: string;
  tenantId: string;
  slug: string;
}

function page(overrides: Partial<PageSnapshot>): PageSnapshot {
  return {
    url: "http://fixture.test/products/serum",
    status: 200,
    title: "Serum",
    metaDescription: null,
    titleLength: 6,
    metaDescriptionLength: null,
    h1Count: 1,
    hasCanonical: false,
    isIndexable: true,
    wordCount: 400,
    imagesTotal: 1,
    imagesWithoutAlt: 1,
    brokenLinks: 0,
    hasProductSchema: false,
    internalLinks: [],
    loadTimeMs: 50,
    transferBytes: 10_000,
    ...overrides,
  };
}

interface FakeOpts extends Omit<CrawlOptions, "baseUrl"> {}

function fakeStorefront(snapshots: PageSnapshot[]) {
  return async (opts: FakeOpts): Promise<CrawlResult> => {
    for (let i = 0; i < snapshots.length; i += 1) {
      if (opts.onPage) await opts.onPage(snapshots[i]!, i, snapshots.length);
    }
    return { snapshots, robots: { disallow: [], allow: [], crawlDelayMs: null }, disallowed: [] };
  };
}

describe("Phase 3 SEO auditor", () => {
  let db: DbPool;
  let app: Express;
  let instance = 0;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
    instance += 1;
    const service = createAuditService({
      db,
      storefrontUrl: "http://fixture.test",
      crawl: fakeStorefront([
        page({}),
        page({ url: "http://fixture.test/", title: null, titleLength: null, h1Count: 0, wordCount: 30, hasProductSchema: false }),
      ]),
    });
    ({ app } = makeTestAppWith(db, {}, null, service));
  });

  async function registerTenant(storeName = "Glow Co."): Promise<Owner> {
    instance += 1;
    const res = await request(app).post("/api/v1/auth/register").send({
      storeName,
      email: `owner${instance}@example.com`,
      password: "Password123!",
      fullName: "Test Owner",
    });
    expect(res.status).toBe(201);
    const tenantId = res.body.tenant.id as string;
    const { rows } = await db.query<{ slug: string }>("SELECT slug FROM tenants WHERE id = $1", [tenantId]);
    return { token: res.body.tokens.accessToken as string, tenantId, slug: rows[0]!.slug };
  }

  async function createProduct(owner: Owner): Promise<void> {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Serum",
        handle: "serum",
        status: "active",
        tags: ["skincare"],
        attributes: { skin_type: "all" },
        variants: [{ title: "50ml", sku: `SRM${instance}-1`, priceAmount: 4000, inventoryQty: 5, isDefault: true }],
      });
    expect(res.status).toBe(201);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function runAudit(owner: Owner, body: Record<string, unknown> = {}): Promise<{ id: string; status: string }> {
    const res = await request(app)
      .post("/api/v1/admin/seo/audits")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Test crawl", crawlDepth: 2, ...body });
    expect(res.status).toBe(202);
    return res.body.data as { id: string; status: string };
  }

  it("crawls, detects issues, and stores a score", async () => {
    const owner = await registerTenant();
    await createProduct(owner);
    const audit = await runAudit(owner);

    const detail = await request(app).get(`/api/v1/admin/seo/audits/${audit.id}`).set("Authorization", `Bearer ${owner.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.audit.status).toBe("completed");
    expect(detail.body.data.audit.totalUrls).toBe(2);
    expect(detail.body.data.score).not.toBeNull();
    expect(detail.body.data.openIssues).toBeGreaterThan(0);

    const issues = await request(app).get(`/api/v1/admin/seo/audits/${audit.id}/issues`).set("Authorization", `Bearer ${owner.token}`);
    expect(issues.status).toBe(200);
    const types = issues.body.data.map((i: AuditIssue) => i.type) as string[];
    expect(types).toContain("missing-meta-description");
    expect(types).toContain("images-without-alt");

    const urls = await request(app).get(`/api/v1/admin/seo/audits/${audit.id}/urls`).set("Authorization", `Bearer ${owner.token}`);
    expect(urls.status).toBe(200);
    expect(urls.body.data).toHaveLength(2);
  });

  it("one-click fix updates product SEO and raises the score", async () => {
    const owner = await registerTenant();
    await createProduct(owner);
    const audit = await runAudit(owner);

    const issues = await request(app)
      .get(`/api/v1/admin/seo/audits/${audit.id}/issues?status=open`)
      .set("Authorization", `Bearer ${owner.token}`);
    const metaIssue = issues.body.data.find((i: AuditIssue) => i.type === "missing-meta-description" && i.url === "http://fixture.test/products/serum") as AuditIssue | undefined;
    expect(metaIssue).toBeDefined();

    const before = await request(app).get(`/api/v1/admin/seo/score`).set("Authorization", `Bearer ${owner.token}`);
    const beforeScore = before.body.data.latest.score as number;

    const fix = await request(app)
      .post(`/api/v1/admin/seo/audits/${audit.id}/issues/${metaIssue!.id}/fix`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(fix.status).toBe(200);
    expect(fix.body.data.status).toBe("fixed");

    const { rows } = await db.query<{ meta_description: string | null }>(
      `SELECT meta_description FROM product_seo ps
       JOIN products p ON p.id = ps.product_id
       WHERE p.handle = 'serum' AND ps.meta_description IS NOT NULL`,
    );
    expect(rows.length).toBeGreaterThan(0);

    const after = await request(app).get(`/api/v1/admin/seo/score`).set("Authorization", `Bearer ${owner.token}`);
    expect(after.body.data.latest.score).toBeGreaterThan(beforeScore);
    expect(after.body.data.history.length).toBeGreaterThanOrEqual(2);
  });

  it("dismisses issues and records the status change", async () => {
    const owner = await registerTenant();
    await createProduct(owner);
    const audit = await runAudit(owner);

    const issues = await request(app).get(`/api/v1/admin/seo/audits/${audit.id}/issues?status=open`).set("Authorization", `Bearer ${owner.token}`);
    const target = issues.body.data.find((i: AuditIssue) => i.type === "missing-canonical") as AuditIssue | undefined;
    expect(target).toBeDefined();

    const dismiss = await request(app)
      .post(`/api/v1/admin/seo/audits/${audit.id}/issues/${target!.id}/dismiss`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(dismiss.status).toBe(200);
    expect(dismiss.body.data.status).toBe("dismissed");

    const openAfter = await request(app)
      .get(`/api/v1/admin/seo/audits/${audit.id}/issues?status=dismissed`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(openAfter.body.data.map((i: AuditIssue) => i.id)).toContain(target!.id);
  });

  it("returns 404 for audits from another tenant", async () => {
    const owner = await registerTenant();
    const other = await registerTenant("Other Co.");
    const audit = await runAudit(owner);
    const res = await request(app).get(`/api/v1/admin/seo/audits/${audit.id}`).set("Authorization", `Bearer ${other.token}`);
    expect(res.status).toBe(404);
  });
});