import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPool } from "@beautyai/db";
import { makeTestAppWith, setupTestDb, truncateAll } from "../../test/helpers.js";

interface Owner {
  token: string;
  tenantId: string;
  slug: string;
}

describe("Phase 5 recommendations", () => {
  let db: DbPool;
  let app: Express;

  beforeAll(async () => {
    db = await setupTestDb();
    ({ app } = makeTestAppWith(db));
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
      email: `recowner${instance}@example.com`,
      password: "Password123!",
      fullName: "Test Owner",
    });
    expect(res.status).toBe(201);
    const tenantId = res.body.tenant.id as string;
    const { rows } = await db.query<{ slug: string }>("SELECT slug FROM tenants WHERE id = $1", [tenantId]);
    return { token: res.body.tokens.accessToken as string, tenantId, slug: rows[0]!.slug };
  }

  async function createProduct(
    owner: Owner,
    input: Record<string, unknown> = {},
  ): Promise<{ id: string; handle: string; variantId: string }> {
    const handle = (input.handle as string | undefined) ?? `rec-product-${instance}`;
    const sku = `REC${instance}-${Date.now().toString(36)}`;
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: input.title ?? "Rec Product",
        handle,
        status: "active",
        tags: input.tags ?? [],
        variants: [{ title: "50ml", sku, priceAmount: 5000, inventoryQty: 10, isDefault: true }],
        ...input,
      });
    expect(res.status).toBe(201);
    const p = res.body.data;
    return { id: p.id as string, handle: p.handle as string, variantId: (p.variants[0] as { id: string }).id };
  }

  async function createCollection(owner: Owner, title: string): Promise<string> {
    const res = await request(app)
      .post("/api/v1/admin/collections")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title, handle: title.toLowerCase().replace(/\s+/g, "-"), published: true });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  async function addProductToCollection(owner: Owner, collectionId: string, productId: string): Promise<void> {
    const res = await request(app)
      .post(`/api/v1/admin/collections/${collectionId}/products/${productId}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(res.status).toBe(204);
  }

  async function insertOrder(owner: Owner, items: { variantId: string; productId: string; quantity: number }[]): Promise<void> {
    const orderId = (await db.query<{ id: string }>("SELECT gen_random_uuid() AS id")).rows[0]!.id;
    await db.query(
      `INSERT INTO orders (id, tenant_id, status, email, subtotal_amount, total_amount, placed_at)
       VALUES ($1, $2, 'paid', 'test@example.com', $3, $3, now())`,
      [orderId, owner.tenantId, items.reduce((sum, i) => sum + 5000 * i.quantity, 0)],
    );
    for (const item of items) {
      await db.query(
        `INSERT INTO order_items (tenant_id, order_id, variant_id, product_title, variant_title, sku, unit_price_amount, quantity, line_total_amount)
         VALUES ($1, $2, $3, 'Rec Product', '50ml', 'SKU', 5000, $4, $4 * 5000)`,
        [owner.tenantId, orderId, item.variantId, item.quantity],
      );
    }
  }

  // ===== Strategy configuration =====

  it("strategy config starts with defaults, merges partial updates, and persists", async () => {
    const owner = await registerTenant();
    const getRes = await request(app).get("/api/v1/admin/recommendations/strategies").set("Authorization", `Bearer ${owner.token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.related.enabled).toBe(true);
    expect(getRes.body.data.related.limit).toBe(8);
    expect(getRes.body.data.boughtTogether.minPairs).toBe(1);

    const putRes = await request(app)
      .put("/api/v1/admin/recommendations/strategies")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ related: { enabled: false }, boughtTogether: { minPairs: 5 } });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.related.enabled).toBe(false);
    expect(putRes.body.data.boughtTogether.minPairs).toBe(5);
    expect(putRes.body.data.home.windowDays).toBe(90);

    const verify = await request(app).get("/api/v1/admin/recommendations/strategies").set("Authorization", `Bearer ${owner.token}`);
    expect(verify.body.data.related.enabled).toBe(false);
    expect(verify.body.data.boughtTogether.minPairs).toBe(5);
  });

  // ===== Event capture =====

  it("POST /events validates inputs and captures product_view with sessionId", async () => {
    const owner = await registerTenant();
    const product = await createProduct(owner);

    const badEvent = await request(app)
      .post("/api/v1/events")
      .set("X-Tenant-Slug", owner.slug)
      .send({ event: "click", sessionId: "s1" });
    expect(badEvent.status).toBe(422);

    const noProduct = await request(app)
      .post("/api/v1/events")
      .set("X-Tenant-Slug", owner.slug)
      .send({ event: "product_view", sessionId: "s1" });
    expect(noProduct.status).toBe(422);

    const ok = await request(app)
      .post("/api/v1/events")
      .set("X-Tenant-Slug", owner.slug)
      .send({ event: "product_view", productHandle: product.handle, sessionId: "s1" });
    expect(ok.status).toBe(201);
    expect(ok.body.data.event).toBe("product_view");
    expect(ok.body.data.productId).toBe(product.id);
  });

  // ===== Refresh + public recommendations =====

  it("refresh populates product_recommendations and public endpoints return products", async () => {
    const owner = await registerTenant();
    const productA = await createProduct(owner, { title: "Serum A", handle: "serum-a" });
    const productB = await createProduct(owner, { title: "Serum B", handle: "serum-b" });
    const productC = await createProduct(owner, { title: "Moisturizer C", handle: "moisturizer-c" });

    const col = await createCollection(owner, "Skincare");
    await addProductToCollection(owner, col, productA.id);
    await addProductToCollection(owner, col, productB.id);

    await insertOrder(owner, [
      { variantId: productA.variantId, productId: productA.id, quantity: 2 },
      { variantId: productB.variantId, productId: productB.id, quantity: 1 },
    ]);

    const refreshRes = await request(app)
      .post("/api/v1/admin/recommendations/refresh")
      .set("Authorization", `Bearer ${owner.token}`);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.ok).toBe(true);
    expect(refreshRes.body.data.queued).toBe(false);
    expect(refreshRes.body.data.counts.related).toBeGreaterThanOrEqual(1);
    expect(refreshRes.body.data.counts.boughtTogether).toBeGreaterThanOrEqual(1);

    const related = await request(app).get("/api/v1/products/serum-a/related").set("X-Tenant-Slug", owner.slug);
    expect(related.status).toBe(200);
    expect(related.body.data.length).toBeGreaterThanOrEqual(1);
    expect(related.body.data.some((r: { product: { handle: string } }) => r.product.handle === "serum-b")).toBe(true);

    const bought = await request(app).get("/api/v1/products/serum-a/bought-together").set("X-Tenant-Slug", owner.slug);
    expect(bought.status).toBe(200);
    expect(bought.body.data.some((r: { product: { handle: string } }) => r.product.handle === "serum-b")).toBe(true);

    const home = await request(app).get("/api/v1/home/recommended?limit=4").set("X-Tenant-Slug", owner.slug);
    expect(home.status).toBe(200);
    expect(home.body.data.length).toBeGreaterThanOrEqual(1);
    expect(home.body.data.every((r: { strategy: string }) => r.strategy === "popular")).toBe(true);
  });

  // ===== Personalization via sessionId =====

  it("home/recommended uses recent events to personalize results", async () => {
    const owner = await registerTenant();
    const productA = await createProduct(owner, { title: "Face Wash", handle: "face-wash" });
    const productB = await createProduct(owner, { title: "Toner", handle: "toner" });
    const col = await createCollection(owner, "Face");
    await addProductToCollection(owner, col, productA.id);
    await addProductToCollection(owner, col, productB.id);

    await request(app)
      .post("/api/v1/events")
      .set("X-Tenant-Slug", owner.slug)
      .send({ event: "product_view", productHandle: "face-wash", sessionId: "sid-1" });

    await request(app)
      .post("/api/v1/admin/recommendations/refresh")
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    const home = await request(app).get("/api/v1/home/recommended?limit=4&sessionId=sid-1").set("X-Tenant-Slug", owner.slug);
    expect(home.status).toBe(200);
    expect(home.body.data.length).toBeGreaterThanOrEqual(1);
    const strategies = home.body.data.map((r: { strategy: string }) => r.strategy);
    expect(strategies).toContain("personalized");
    expect(home.body.data.some((r: { product: { handle: string } }) => r.product.handle === "toner")).toBe(true);
  });

  // ===== Tenant isolation =====

  it("refresh for tenant A does not affect tenant B", async () => {
    const ownerA = await registerTenant("Tenant A");
    const ownerB = await registerTenant("Tenant B");
    const productA = await createProduct(ownerA, { title: "A Serum", handle: "a-serum" });
    const colA = await createCollection(ownerA, "Skincare");
    await addProductToCollection(ownerA, colA, productA.id);

    await request(app)
      .post("/api/v1/admin/recommendations/refresh")
      .set("Authorization", `Bearer ${ownerA.token}`)
      .expect(200);

    const productB = await createProduct(ownerB, { title: "B Serum", handle: "b-serum" });
    const recsB = await request(app).get("/api/v1/products/b-serum/related").set("X-Tenant-Slug", ownerB.slug);
    expect(recsB.status).toBe(200);
    expect(recsB.body.data).toHaveLength(0);

    const homeB = await request(app).get("/api/v1/home/recommended?limit=4").set("X-Tenant-Slug", ownerB.slug);
    expect(homeB.body.data).toHaveLength(0);
  });

  // ===== Auth guards =====

  it("admin recommendation endpoints require authentication", async () => {
    const res = await request(app).get("/api/v1/admin/recommendations/strategies");
    expect(res.status).toBe(401);
  });
});