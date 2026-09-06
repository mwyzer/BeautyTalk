import { createHmac } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPool } from "@beautyai/db";
import { makeTestApp, setupTestDb, truncateAll } from "../../test/helpers.js";

interface Owner {
  token: string;
  userId: string;
  tenantId: string;
  slug: string;
}

function signWebhook(payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", "whsec_test_webhook_secret").update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function completedSessionEvent(opts: { tenantId: string; cartId: string; sessionId?: string }): string {
  return JSON.stringify({
    id: "evt_test_checkout_completed",
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: opts.sessionId ?? "cs_test_unique",
        object: "checkout.session",
        client_reference_id: opts.cartId,
        customer_email: "shopper@example.com",
        customer_details: { email: "shopper@example.com" },
        payment_intent: null,
        metadata: { tenant_id: opts.tenantId, cart_id: opts.cartId },
      },
    },
  });
}

function checkoutCompletedPayload(opts: { tenantId: string; cartId: string; sessionId?: string }): { payload: string; signature: string } {
  const payload = completedSessionEvent(opts);
  return { payload, signature: signWebhook(payload) };
}

describe("Phase 1 commerce core", () => {
  let db: DbPool;
  let app: Express;

  beforeAll(async () => {
    db = await setupTestDb();
    ({ app } = makeTestApp(db));
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
    const email = `owner${instance}@example.com`;
    const res = await request(app).post("/api/v1/auth/register").send({
      storeName,
      email,
      password: "Password123!",
      fullName: "Test Owner",
    });
    expect(res.status).toBe(201);
    const tenantId = res.body.tenant.id as string;
    const { rows } = await db.query<{ slug: string }>("SELECT slug FROM tenants WHERE id = $1", [tenantId]);
    return {
      token: res.body.tokens.accessToken as string,
      userId: res.body.user.id as string,
      tenantId,
      slug: rows[0]!.slug,
    };
  }

  async function createProduct(
    owner: Owner,
    input: Partial<Record<string, unknown>> = {},
  ): Promise<{ id: string; handle: string; variantId: string; priceAmount: number }> {
    const handle = (input.handle as string | undefined) ?? "test-serum";
    const sku = `${handle.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${instance}`;
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Test Serum",
        handle,
        status: "draft",
        tags: [],
        variants: [
          { title: "50ml", sku, priceAmount: 5000, inventoryQty: 10, isDefault: true },
        ],
        ...input,
      });
    expect(res.status).toBe(201);
    const p = res.body.data;
    return {
      id: p.id as string,
      handle: p.handle as string,
      variantId: (p.variants[0] as { id: string }).id,
      priceAmount: (p.variants[0] as { priceAmount: number }).priceAmount,
    };
  }

  async function createCart(owner: Owner): Promise<string> {
    const res = await request(app).post("/api/v1/carts").set("X-Tenant-Slug", owner.slug);
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  // ===== Public catalog =====

  it("requires a tenant slug for public routes", async () => {
    const res = await request(app).get("/api/v1/products");
    expect(res.status).toBe(404);
  });

  it("public product list exposes only active products with variants", async () => {
    const owner = await registerTenant();
    await createProduct(owner, { title: "Live Serum", handle: "live-serum", status: "active" });
    await createProduct(owner, { title: "Private Serum", handle: "private-serum", status: "draft" });

    const res = await request(app).get("/api/v1/products").set("X-Tenant-Slug", owner.slug);
    expect(res.status).toBe(200);
    const handles = res.body.data.map((p: { handle: string }) => p.handle);
    expect(handles).toContain("live-serum");
    expect(handles).not.toContain("private-serum");
    const live = res.body.data.find((p: { handle: string }) => p.handle === "live-serum");
    expect(live.variants).toHaveLength(1);
  });

  it("serves an active product by handle and 404s for drafts/archived", async () => {
    const owner = await registerTenant();
    const active = await createProduct(owner, { status: "active" });
    await createProduct(owner, { title: "Hidden", handle: "hidden", status: "archived" });

    const ok = await request(app).get(`/api/v1/products/${active.handle}`).set("X-Tenant-Slug", owner.slug);
    expect(ok.status).toBe(200);
    expect(ok.body.data.variants[0].priceAmount).toBe(active.priceAmount);

    const missing = await request(app).get("/api/v1/products/hidden").set("X-Tenant-Slug", owner.slug);
    expect(missing.status).toBe(404);
  });

  // ===== Admin catalog =====

  it("admin can create, update, publish, and archive products", async () => {
    const owner = await registerTenant();
    const product = await createProduct(owner, { status: "active" });

    const list = await request(app).get("/api/v1/admin/products").set("Authorization", `Bearer ${owner.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((p: { handle: string }) => p.handle === product.handle)).toBe(true);

    const patched = await request(app)
      .patch(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title: "Renamed Serum", tags: ["best-seller"] });
    expect(patched.status).toBe(200);
    expect(patched.body.data.title).toBe("Renamed Serum");
    expect(patched.body.data.tags).toEqual(["best-seller"]);

    const published = await request(app)
      .post(`/api/v1/admin/products/${product.id}/publish`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ status: "draft" });
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe("draft");

    const archived = await request(app)
      .delete(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(archived.status).toBe(204);

    const after = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(after.body.data.status).toBe("archived");
  });

  it("admin collections can group products and are tenant-scoped", async () => {
    const owner = await registerTenant();
    const product = await createProduct(owner, { status: "active" });

    const created = await request(app)
      .post("/api/v1/admin/collections")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title: "Bestsellers", handle: "bestsellers", published: true });
    expect(created.status).toBe(201);
    const collectionId = created.body.data.id as string;

    await request(app)
      .post(`/api/v1/admin/collections/${collectionId}/products/${product.id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(204);

    const publicDetail = await request(app)
      .get("/api/v1/collections/bestsellers")
      .set("X-Tenant-Slug", owner.slug);
    expect(publicDetail.status).toBe(200);
    const ids = publicDetail.body.data.products.map((p: { id: string }) => p.id);
    expect(ids).toContain(product.id);

    const publicList = await request(app).get("/api/v1/collections").set("X-Tenant-Slug", owner.slug);
    expect(publicList.status).toBe(200);
    expect(publicList.body.data.some((c: { handle: string }) => c.handle === "bestsellers")).toBe(true);
  });

  // ===== Carts =====

  it("cart flow tracks quantities, line totals, and removals", async () => {
    const owner = await registerTenant();
    const product = await createProduct(owner, { status: "active" });
    const cartId = await createCart(owner);

    const added = await request(app)
      .post(`/api/v1/carts/${cartId}/items`)
      .set("X-Tenant-Slug", owner.slug)
      .send({ variantId: product.variantId, quantity: 2 });
    expect(added.status).toBe(200);
    expect(added.body.data.items[0].lineTotalAmount).toBe(product.priceAmount * 2);
    expect(added.body.data.subtotalAmount).toBe(product.priceAmount * 2);

    const addedMore = await request(app)
      .post(`/api/v1/carts/${cartId}/items`)
      .set("X-Tenant-Slug", owner.slug)
      .send({ variantId: product.variantId, quantity: 1 });
    expect(addedMore.body.data.items[0].quantity).toBe(3);
    expect(addedMore.body.data.itemCount).toBe(3);

    const itemId = added.body.data.items[0].id as string;
    const updated = await request(app)
      .patch(`/api/v1/carts/${cartId}/items/${itemId}`)
      .set("X-Tenant-Slug", owner.slug)
      .send({ quantity: 1 });
    expect(updated.body.data.subtotalAmount).toBe(product.priceAmount);

    const removed = await request(app)
      .delete(`/api/v1/carts/${cartId}/items/${itemId}`)
      .set("X-Tenant-Slug", owner.slug);
    expect(removed.body.data.items).toHaveLength(0);
    expect(removed.body.data.subtotalAmount).toBe(0);
  });

  it("rejects cart quantities above stock and exposes carts only within their tenant", async () => {
    const owner = await registerTenant();
    const other = await registerTenant("Other Store");
    const product = await createProduct(owner, { status: "active" });
    const cartId = await createCart(owner);

    const overStock = await request(app)
      .post(`/api/v1/carts/${cartId}/items`)
      .set("X-Tenant-Slug", owner.slug)
      .send({ variantId: product.variantId, quantity: 99 });
    expect(overStock.status).toBe(409);

    const foreign = await request(app).get(`/api/v1/carts/${cartId}`).set("X-Tenant-Slug", other.slug);
    expect(foreign.status).toBe(404);
  });

  // ===== Checkout =====

  it("refuses checkout for an empty cart", async () => {
    const owner = await registerTenant();
    const cartId = await createCart(owner);
    const res = await request(app)
      .post("/api/v1/checkout/sessions")
      .set("X-Tenant-Slug", owner.slug)
      .send({ cartId });
    expect(res.status).toBe(400);
  });

  it("checkout is unavailable (503) when checkout URLs are not configured", async () => {
    const owner = await registerTenant();
    const product = await createProduct(owner, { status: "active" });
    const cartId = await createCart(owner);
    await request(app)
      .post(`/api/v1/carts/${cartId}/items`)
      .set("X-Tenant-Slug", owner.slug)
      .send({ variantId: product.variantId, quantity: 1 });

    const res = await request(app)
      .post("/api/v1/checkout/sessions")
      .set("X-Tenant-Slug", owner.slug)
      .send({ cartId });
    expect(res.status).toBe(503);
  });

  it("checkout is unavailable (503) with URLs configured but no Stripe keys", async () => {
    const { app: urlApp } = makeTestApp(db, {
      CHECKOUT_SUCCESS_URL: "http://store.test/checkout/success",
      CHECKOUT_CANCEL_URL: "http://store.test/checkout/cancel",
    });
    const ownerRes = await request(urlApp).post("/api/v1/auth/register").send({
      storeName: "Url Store",
      email: "url@example.com",
      password: "Password123!",
      fullName: "Url Owner",
    });
    const token = ownerRes.body.tokens.accessToken as string;
    const tenantId = ownerRes.body.tenant.id as string;
    const { rows } = await db.query<{ slug: string }>("SELECT slug FROM tenants WHERE id = $1", [tenantId]);

    const productRes = await request(urlApp)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Url Serum",
        status: "active",
        tags: [],
        variants: [{ title: "50ml", sku: "URL-50", priceAmount: 3000, inventoryQty: 5, isDefault: true }],
      });
    const variantId = productRes.body.data.variants[0].id as string;

    const cartRes = await request(urlApp).post("/api/v1/carts").set("X-Tenant-Slug", rows[0]!.slug).expect(201);
    const cartId = cartRes.body.data.id as string;
    await request(urlApp)
      .post(`/api/v1/carts/${cartId}/items`)
      .set("X-Tenant-Slug", rows[0]!.slug)
      .send({ variantId, quantity: 1 })
      .expect(200);

    const res = await request(urlApp)
      .post("/api/v1/checkout/sessions")
      .set("X-Tenant-Slug", rows[0]!.slug)
      .send({ cartId });
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).toMatch(/stripe/i);
  });

  // ===== Webhook → order =====

  it("rejects webhooks without a signature header", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(completedSessionEvent({ tenantId: "00000000-0000-0000-0000-000000000000", cartId: "00000000-0000-0000-0000-000000000000" }));
    expect(res.status).toBe(400);
  });

  it("creates a paid order from a signed checkout.session.completed event (idempotent)", async () => {
    const owner = await registerTenant();
    const product = await createProduct(owner, { status: "active" });
    const other = await createProduct(owner, { title: "Second Serum", handle: "second-serum", status: "active" });
    const cartId = await createCart(owner);
    await request(app)
      .post(`/api/v1/carts/${cartId}/items`)
      .set("X-Tenant-Slug", owner.slug)
      .send({ variantId: product.variantId, quantity: 2 })
      .expect(200);
    await request(app)
      .post(`/api/v1/carts/${cartId}/items`)
      .set("X-Tenant-Slug", owner.slug)
      .send({ variantId: other.variantId, quantity: 1 })
      .expect(200);

    const sessionId = "cs_test_order_1";
    const { payload, signature } = checkoutCompletedPayload({ tenantId: owner.tenantId, cartId, sessionId });

    for (let i = 0; i < 2; i += 1) {
      const hook = await request(app)
        .post("/api/v1/webhooks/stripe")
        .set("Content-Type", "application/json")
        .set("stripe-signature", signature)
        .send(payload);
      expect(hook.status).toBe(200);
    }

    const orders = await request(app).get("/api/v1/admin/orders").set("Authorization", `Bearer ${owner.token}`);
    expect(orders.status).toBe(200);
    expect(orders.body.data).toHaveLength(1);
    const order = orders.body.data[0];
    expect(order.status).toBe("paid");
    expect(order.total_amount).toBe(product.priceAmount * 2 + other.priceAmount);

    const confirm = await request(app)
      .get(`/api/v1/checkout/confirm/${sessionId}`)
      .set("X-Tenant-Slug", owner.slug);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe("complete");
    expect(confirm.body.data.order.id).toBe(order.id);

    const { rows } = await db.query<{ status: string }>("SELECT status FROM carts WHERE id = $1", [cartId]);
    expect(rows[0]!.status).toBe("converted");
  });

  it("fulfill, cancel, and refund lifecycle with guards", async () => {
    const owner = await registerTenant();
    const product = await createProduct(owner, { status: "active" });
    const cartId = await createCart(owner);
    await request(app)
      .post(`/api/v1/carts/${cartId}/items`)
      .set("X-Tenant-Slug", owner.slug)
      .send({ variantId: product.variantId, quantity: 1 })
      .expect(200);
    const { payload, signature } = checkoutCompletedPayload({ tenantId: owner.tenantId, cartId, sessionId: "cs_test_order_2" });
    await request(app).post("/api/v1/webhooks/stripe").set("Content-Type", "application/json").set("stripe-signature", signature).send(payload).expect(200);

    const orders = await request(app).get("/api/v1/admin/orders").set("Authorization", `Bearer ${owner.token}`);
    const orderId = orders.body.data[0].id as string;

    const fulfilled = await request(app)
      .post(`/api/v1/admin/orders/${orderId}/fulfill`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ carrier: "fedex", trackingNumber: "TRK-123" });
    expect(fulfilled.status).toBe(200);
    expect(fulfilled.body.data.status).toBe("fulfilled");
    expect(fulfilled.body.data.shipments[0].trackingNumber).toBe("TRK-123");

    const cancelled = await request(app)
      .post(`/api/v1/admin/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("cancelled");

    const cancelAgain = await request(app)
      .post(`/api/v1/admin/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(cancelAgain.status).toBe(409);

    const refundCancelled = await request(app)
      .post(`/api/v1/admin/orders/${orderId}/refund`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ reason: "test" });
    expect(refundCancelled.status).toBe(409);

    // A fresh paid order can be refunded.
    const cartId2 = await createCart(owner);
    await request(app)
      .post(`/api/v1/carts/${cartId2}/items`)
      .set("X-Tenant-Slug", owner.slug)
      .send({ variantId: product.variantId, quantity: 1 })
      .expect(200);
    const { payload: payload2, signature: signature2 } = checkoutCompletedPayload({ tenantId: owner.tenantId, cartId: cartId2, sessionId: "cs_test_order_3" });
    await request(app).post("/api/v1/webhooks/stripe").set("Content-Type", "application/json").set("stripe-signature", signature2).send(payload2).expect(200);
    const orders2 = await request(app).get("/api/v1/admin/orders").set("Authorization", `Bearer ${owner.token}`);
    const refundable = orders2.body.data.find((o: { status: string }) => o.status === "paid") as { id: string };
    const refunded = await request(app)
      .post(`/api/v1/admin/orders/${refundable.id}/refund`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ reason: "customer requested" });
    expect(refunded.status).toBe(200);
    expect(refunded.body.data.status).toBe("refunded");
  });

  // ===== Customers =====

  it("customer register/login, self-service account, addresses, and admin visibility", async () => {
    const owner = await registerTenant();

    const registered = await request(app)
      .post("/api/v1/customers/register")
      .set("X-Tenant-Slug", owner.slug)
      .send({ email: "shopper@example.com", password: "Customer123!", firstName: "Fay", lastName: "Lane" });
    expect(registered.status).toBe(201);
    const customerToken = registered.body.data.accessToken as string;
    const customerId = registered.body.data.customer.id as string;

    const account = await request(app).get("/api/v1/me/account").set("Authorization", `Bearer ${customerToken}`);
    expect(account.status).toBe(200);
    expect(account.body.data.email).toBe("shopper@example.com");
    expect(account.body.data.firstName).toBe("Fay");

    const addr = await request(app)
      .post("/api/v1/me/addresses")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ address1: "1 Rose Lane", city: "Austin", zip: "78701", country: "US", isDefault: true });
    expect(addr.status).toBe(201);
    const addresses = await request(app).get("/api/v1/me/addresses").set("Authorization", `Bearer ${customerToken}`);
    expect(addresses.body.data).toHaveLength(1);

    const emptyOrders = await request(app).get("/api/v1/me/orders").set("Authorization", `Bearer ${customerToken}`);
    expect(emptyOrders.body.data).toHaveLength(0);

    const adminList = await request(app).get("/api/v1/admin/customers").set("Authorization", `Bearer ${owner.token}`);
    expect(adminList.status).toBe(200);
    const row = adminList.body.data.find((c: { id: string }) => c.id === customerId);
    expect(row).toBeDefined();
    expect(row.ordersCount).toBe(0);

    // Token types are not interchangeable.
    const merchantWithCustomerToken = await request(app).get("/api/v1/me").set("Authorization", `Bearer ${customerToken}`);
    expect(merchantWithCustomerToken.status).toBe(401);
    const customerWithMerchantToken = await request(app).get("/api/v1/me/account").set("Authorization", `Bearer ${owner.token}`);
    expect(customerWithMerchantToken.status).toBe(401);

    // Login round-trip.
    const login = await request(app)
      .post("/api/v1/customers/login")
      .set("X-Tenant-Slug", owner.slug)
      .send({ email: "shopper@example.com", password: "Customer123!" });
    expect(login.status).toBe(200);
    expect(login.body.data.customer.id).toBe(customerId);
  });
});