import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPool } from "@beautyai/db";
import { makeTestApp, makeTestAppWith, setupTestDb, truncateAll } from "../../test/helpers.js";
import { createStubContentProvider } from "../../content/provider.js";
import type { ContentDraft } from "@beautyai/shared";

interface Owner {
  token: string;
  tenantId: string;
  slug: string;
}

describe("Phase 2 content engine", () => {
  let db: DbPool;
  let app: Express;
  let appWithoutProvider: Express;

  beforeAll(async () => {
    db = await setupTestDb();
    ({ app } = makeTestAppWith(db, {}, createStubContentProvider()));
    ({ app: appWithoutProvider } = makeTestApp(db));
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  let instance = 0;

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

  async function createProduct(owner: Owner, input: Record<string, unknown> = {}): Promise<string> {
    const handle = (input.handle as string | undefined) ?? `content-serum-${instance}`;
    const sku = `CONTENT${instance}-${Date.now().toString(36)}`;
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: input.title ?? "Content Serum",
        handle,
        status: "draft",
        tags: ["serum", "hydrating"],
        attributes: { "key_ingredient": ["hyaluronic acid"], "skin_type": "all" },
        variants: [{ title: "50ml", sku, priceAmount: 4000, inventoryQty: 5, isDefault: true }],
        ...input,
      });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  async function generate(owner: Owner, body: Record<string, unknown>): Promise<request.Response> {
    return request(app)
      .post("/api/v1/admin/content/generate")
      .set("Authorization", `Bearer ${owner.token}`)
      .send(body);
  }

  // ===== Provider configuration =====

  it("returns 503 when no content provider is configured", async () => {
    const owner = await registerTenant();
    const productId = await createProduct(owner);
    const res = await request(appWithoutProvider)
      .post("/api/v1/admin/content/generate")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ type: "product_description", targetIds: [productId] });
    expect(res.status).toBe(503);
  });

  it("rejects blog generation for now", async () => {
    const owner = await registerTenant();
    const productId = await createProduct(owner);
    const res = await generate(owner, { type: "blog", targetIds: [productId] });
    expect(res.status).toBe(400);
  });

  // ===== Brand tone =====

  it("brand tone starts null, upserts, and merges on partial update", async () => {
    const owner = await registerTenant();
    const getBefore = await request(app).get("/api/v1/admin/content/brand-tone").set("Authorization", `Bearer ${owner.token}`);
    expect(getBefore.status).toBe(200);
    expect(getBefore.body.data).toBeNull();

    const put = await request(app)
      .put("/api/v1/admin/content/brand-tone")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Glow Voice", voice: "warm and honest", forbiddenWords: ["miracle"], language: "en" });
    expect(put.status).toBe(200);
    expect(put.body.data.voice).toBe("warm and honest");

    const putVoiceOnly = await request(app)
      .put("/api/v1/admin/content/brand-tone")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ voice: "playful" });
    expect(putVoiceOnly.status).toBe(200);
    expect(putVoiceOnly.body.data.voice).toBe("playful");
    expect(putVoiceOnly.body.data.language).toBe("en");

    const getAfter = await request(app).get("/api/v1/admin/content/brand-tone").set("Authorization", `Bearer ${owner.token}`);
    expect(getAfter.body.data.forbiddenWords).toEqual(["miracle"]);
  });

  // ===== Generation + credits =====

  it("generates a description draft and consumes a credit", async () => {
    const owner = await registerTenant();
    const productId = await createProduct(owner);

    const res = await generate(owner, { type: "product_description", targetIds: [productId] });
    expect(res.status).toBe(200);
    expect(res.body.data.cached).toBe(0);
    const draft = res.body.data.drafts[0] as ContentDraft;
    expect(draft.status).toBe("draft");
    expect(draft.targetId).toBe(productId);
    expect(draft.body!.length).toBeGreaterThan(40);
    expect(draft.llmModel).toBe("stub");

    const credits = await request(app).get("/api/v1/admin/content/credits").set("Authorization", `Bearer ${owner.token}`);
    expect(credits.status).toBe(200);
    expect(credits.body.data.used).toBe(1);
    expect(credits.body.data.quotaLimit).toBe(-1);
    expect(credits.body.data.history[0].operation).toBe("content.generated");
    expect(credits.body.data.history[0].amount).toBe(-1);
  });

  it("reuses cached drafts unless regenerate is set", async () => {
    const owner = await registerTenant();
    const productId = await createProduct(owner);
    const first = await generate(owner, { type: "product_description", targetIds: [productId] });
    const firstDraftId = (first.body.data.drafts[0] as ContentDraft).id;

    const second = await generate(owner, { type: "product_description", targetIds: [productId] });
    expect(second.body.data.cached).toBe(1);
    expect((second.body.data.drafts[0] as ContentDraft).id).toBe(firstDraftId);

    const creditsAfter = await request(app).get("/api/v1/admin/content/credits").set("Authorization", `Bearer ${owner.token}`);
    expect(creditsAfter.body.data.used).toBe(1);

    const regenerated = await generate(owner, { type: "product_description", targetIds: [productId], regenerate: true });
    expect(regenerated.body.data.cached).toBe(0);
    expect((regenerated.body.data.drafts[0] as ContentDraft).id).not.toBe(firstDraftId);
    const creditsRegen = await request(app).get("/api/v1/admin/content/credits").set("Authorization", `Bearer ${owner.token}`);
    expect(creditsRegen.body.data.used).toBe(2);

    const list = await request(app)
      .get("/api/v1/admin/content/drafts?type=product_description")
      .set("Authorization", `Bearer ${owner.token}`);
    const statuses = (list.body.data as ContentDraft[]).map((d) => d.status);
    expect(statuses).toContain("draft");
    expect(statuses).toContain("rejected");
  });

  it("enforces meta validation lengths and records meta in the draft", async () => {
    const owner = await registerTenant();
    const productId = await createProduct(owner);
    const res = await generate(owner, { type: "meta", targetIds: [productId] });
    expect(res.status).toBe(200);
    const draft = res.body.data.drafts[0] as ContentDraft;
    expect(draft.metaTitle!.length).toBeLessThanOrEqual(60);
    expect(draft.metaDescription!.length).toBeLessThanOrEqual(160);
    expect(draft.body).toBeNull();
  });

  it("rejects bulk generation when the credit quota is exhausted (429)", async () => {
    const owner = await registerTenant();
    await db.query(
      `INSERT INTO feature_quotas (tenant_id, feature, used, quota_limit)
       VALUES ($1, 'content_credits', 1, 1)`,
      [owner.tenantId],
    );
    const productId = await createProduct(owner);
    const res = await generate(owner, { type: "product_description", targetIds: [productId] });
    expect(res.status).toBe(429);
  });

  it("bulk generation with an unlimited quota produces one draft per target", async () => {
    const owner = await registerTenant();
    const p1 = await createProduct(owner, { title: "Serum A", handle: `serum-a-${instance}` });
    const p2 = await createProduct(owner, { title: "Serum B", handle: `serum-b-${instance}` });
    const p3 = await createProduct(owner, { title: "Serum C", handle: `serum-c-${instance}` });
    const res = await generate(owner, { type: "product_description", targetIds: [p1, p2, p3] });
    expect(res.status).toBe(200);
    expect(res.body.data.drafts).toHaveLength(3);
    expect(res.body.data.cached).toBe(0);
    const credits = await request(app).get("/api/v1/admin/content/credits").set("Authorization", `Bearer ${owner.token}`);
    expect(credits.body.data.used).toBe(3);
  });

  // ===== Draft lifecycle =====

  it("edits create version history and restore reverts", async () => {
    const owner = await registerTenant();
    const productId = await createProduct(owner);
    const gen = await generate(owner, { type: "product_description", targetIds: [productId] });
    const draftId = (gen.body.data.drafts[0] as ContentDraft).id;
    const originalBody = (gen.body.data.drafts[0] as ContentDraft).body;

    const edit = await request(app)
      .patch(`/api/v1/admin/content/drafts/${draftId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ body: "Edited description body text for the storefront." });
    expect(edit.status).toBe(200);
    expect(edit.body.data.body).toBe("Edited description body text for the storefront.");

    const versions = await request(app)
      .get(`/api/v1/admin/content/drafts/${draftId}/versions`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(versions.body.data).toHaveLength(1);
    expect(versions.body.data[0].version).toBe(1);
    expect(versions.body.data[0].body).toBe(originalBody);

    const restore = await request(app)
      .post(`/api/v1/admin/content/drafts/${draftId}/versions/1/restore`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(restore.status).toBe(200);
    expect(restore.body.data.body).toBe(originalBody);
  });

  it("approve then publish writes to the product and seals the draft", async () => {
    const owner = await registerTenant();
    const productId = await createProduct(owner);
    const gen = await generate(owner, { type: "meta", targetIds: [productId] });
    const draftId = (gen.body.data.drafts[0] as ContentDraft).id;

    const publishTooEarly = await request(app)
      .post(`/api/v1/admin/content/drafts/${draftId}/publish`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(publishTooEarly.status).toBe(409);

    const approve = await request(app)
      .post(`/api/v1/admin/content/drafts/${draftId}/approve`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("approved");
    expect(approve.body.data.approvedAt).toBeTruthy();

    const publish = await request(app)
      .post(`/api/v1/admin/content/drafts/${draftId}/publish`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(publish.status).toBe(200);
    expect(publish.body.data.status).toBe("published");
    expect(publish.body.data.publishedAt).toBeTruthy();

    const { rows } = await db.query<{ meta_title: string | null }>(
      "SELECT meta_title FROM product_seo WHERE tenant_id = $1 AND product_id = $2",
      [owner.tenantId, productId],
    );
    expect(rows[0]!.meta_title).toBeTruthy();

    const rejectAfterPublish = await request(app)
      .post(`/api/v1/admin/content/drafts/${draftId}/reject`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(rejectAfterPublish.status).toBe(409);
  });

  it("scopes generation and draft reads to the tenant", async () => {
    const ownerA = await registerTenant("Tenant A");
    const ownerB = await registerTenant("Tenant B");
    const productA = await createProduct(ownerA);

    const cross = await generate(ownerB, { type: "product_description", targetIds: [productA] });
    expect(cross.status).toBe(404);

    const listB = await request(app).get("/api/v1/admin/content/drafts").set("Authorization", `Bearer ${ownerB.token}`);
    expect(listB.body.data).toHaveLength(0);

    const generateA = await generate(ownerA, { type: "product_description", targetIds: [productA] });
    expect(generateA.status).toBe(200);

    const readAasB = await request(app)
      .get(`/api/v1/admin/content/drafts/${(generateA.body.data.drafts[0] as ContentDraft).id}`)
      .set("Authorization", `Bearer ${ownerB.token}`);
    expect(readAasB.status).toBe(404);
  });

  it("requires merchant auth for content endpoints", async () => {
    const res = await request(app).get("/api/v1/admin/content/drafts");
    expect(res.status).toBe(401);
  });
});