import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPool } from "@beautyai/db";
import { makeTestAppWith, setupTestDb, truncateAll } from "../../test/helpers.js";

interface Owner {
  token: string;
  tenantId: string;
}

describe("Phase 6 fraud detection", () => {
  let db: DbPool;
  let app: Express;
  let instance = 0;
  let orderSeq = 1000;

  beforeAll(async () => {
    db = await setupTestDb();
    ({ app } = makeTestAppWith(db));
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
    orderSeq = 1000;
  });

  async function registerTenant(storeName = "Glow Co."): Promise<Owner> {
    instance += 1;
    const res = await request(app).post("/api/v1/auth/register").send({
      storeName,
      email: `fraudowner${instance}@example.com`,
      password: "Password123!",
      fullName: "Fraud Owner",
    });
    expect(res.status).toBe(201);
    return { token: res.body.tokens.accessToken as string, tenantId: res.body.tenant.id as string };
  }

  async function insertCustomer(
    tenantId: string,
    createdAt: string | null = null,
    email = `fraud-c${instance}@customer.test`,
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO customers (tenant_id, email, first_name, last_name, created_at)
       VALUES ($1, $2, 'Fraud', 'Customer', COALESCE($3::timestamptz, now()))
       RETURNING id`,
      [tenantId, email, createdAt],
    );
    return rows[0]!.id;
  }

  async function insertAddress(
    tenantId: string,
    customerId: string,
    input: { label: string; address1: string; city: string; zip: string; country: string; isDefault?: boolean },
  ): Promise<void> {
    await db.query(
      `INSERT INTO customer_addresses (tenant_id, customer_id, label, address1, city, zip, country, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, customerId, input.label, input.address1, input.city, input.zip, input.country, input.isDefault ?? false],
    );
  }

  async function insertOrder(
    tenantId: string,
    customerId: string,
    opts: { status?: string; placedAt?: Date } = {},
  ): Promise<string> {
    orderSeq += 1;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO orders (tenant_id, customer_id, number, status, email, subtotal_amount, total_amount, placed_at)
       VALUES ($1, $2, $3, $4, 'fraud@customer.test', 5000, 5000, $5)
       RETURNING id`,
      [tenantId, customerId, orderSeq, opts.status ?? "paid", opts.placedAt ?? new Date()],
    );
    return rows[0]!.id;
  }

  async function latestFlags(owner: Owner): Promise<{ id: string; rules: string[]; riskScore: number; status: string; orderId: string }[]> {
    const res = await request(app).get("/api/v1/admin/fraud/flags?limit=100").set("Authorization", `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    return res.body.data;
  }

  const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3_600_000);
  const daysAgo = (d: number): Date => new Date(Date.now() - d * 86_400_000);

  // ===== Rule configuration =====

  it("config starts with defaults, merges partial updates, and persists", async () => {
    const owner = await registerTenant();

    const getRes = await request(app).get("/api/v1/admin/fraud/config").set("Authorization", `Bearer ${owner.token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.minRiskScore).toBe(40);
    expect(getRes.body.data.velocity.enabled).toBe(true);
    expect(getRes.body.data.velocity.orders).toBe(3);
    expect(getRes.body.data.newAccountBurst.accountAgeDays).toBe(7);

    const putRes = await request(app)
      .put("/api/v1/admin/fraud/config")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ minRiskScore: 80, velocity: { orders: 2 }, addressMismatch: { enabled: false } });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.minRiskScore).toBe(80);
    expect(putRes.body.data.velocity.orders).toBe(2);
    expect(putRes.body.data.addressMismatch.enabled).toBe(false);
    expect(putRes.body.data.refundAbuse.refundRatio).toBe(0.5);

    const verify = await request(app).get("/api/v1/admin/fraud/config").set("Authorization", `Bearer ${owner.token}`);
    expect(verify.body.data.minRiskScore).toBe(80);
    expect(verify.body.data.velocity.orders).toBe(2);
  });

  // ===== Rules =====

  it("flags order velocity when a customer places many orders in a short window", async () => {
    const owner = await registerTenant();
    const customerId = await insertCustomer(owner.tenantId);
    await insertOrder(owner.tenantId, customerId, { placedAt: hoursAgo(2) });
    await insertOrder(owner.tenantId, customerId, { placedAt: hoursAgo(1) });
    await insertOrder(owner.tenantId, customerId, { placedAt: new Date() });

    const res = await request(app).post("/api/v1/admin/fraud/scan").set("Authorization", `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.queued).toBe(false);
    expect(res.body.data.scannedOrders).toBe(3);
    expect(res.body.data.flagsCreated).toBe(3);

    const flags = await latestFlags(owner);
    expect(flags).toHaveLength(3);
    expect(flags.every((f) => f.rules.includes("velocity"))).toBe(true);
    expect(flags.every((f) => f.riskScore >= 40)).toBe(true);
  });

  it("flags non-refunded orders of customers with a high refund ratio", async () => {
    const owner = await registerTenant();
    const customerId = await insertCustomer(owner.tenantId);
    await insertOrder(owner.tenantId, customerId, { status: "refunded", placedAt: daysAgo(10) });
    await insertOrder(owner.tenantId, customerId, { status: "refunded", placedAt: daysAgo(9) });
    await insertOrder(owner.tenantId, customerId, { status: "paid", placedAt: daysAgo(8) });

    const res = await request(app).post("/api/v1/admin/fraud/scan").set("Authorization", `Bearer ${owner.token}`);
    expect(res.body.data.flagsCreated).toBe(1);

    const flags = await latestFlags(owner);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.rules).toEqual(["refund_abuse"]);
    expect(flags[0]!.riskScore).toBe(50);
  });

  it("flags orders from customers with mismatched billing/shipping addresses", async () => {
    const owner = await registerTenant();
    const customerId = await insertCustomer(owner.tenantId);
    await insertAddress(owner.tenantId, customerId, { label: "Home", address1: "12 Maple Ave", city: "Portland", zip: "97201", country: "US", isDefault: true });
    await insertAddress(owner.tenantId, customerId, { label: "Shipping", address1: "201 Cedar St", city: "Austin", zip: "78701", country: "US" });
    await insertOrder(owner.tenantId, customerId);

    const res = await request(app).post("/api/v1/admin/fraud/scan").set("Authorization", `Bearer ${owner.token}`);
    expect(res.body.data.flagsCreated).toBe(1);

    const flags = await latestFlags(owner);
    expect(flags[0]!.rules).toEqual(["address_mismatch"]);
    expect(flags[0]!.riskScore).toBe(40);
  });

  it("flags new-account bursts: fresh account placing many orders in a day", async () => {
    const owner = await registerTenant();
    const customerId = await insertCustomer(owner.tenantId, daysAgo(2).toISOString());
    await insertOrder(owner.tenantId, customerId, { placedAt: hoursAgo(12) });
    await insertOrder(owner.tenantId, customerId, { placedAt: hoursAgo(6) });
    await insertOrder(owner.tenantId, customerId, { placedAt: new Date() });

    const res = await request(app).post("/api/v1/admin/fraud/scan").set("Authorization", `Bearer ${owner.token}`);
    expect(res.body.data.flagsCreated).toBe(3);

    const flags = await latestFlags(owner);
    expect(flags.every((f) => f.rules.includes("new_account_burst"))).toBe(true);
  });

  // ===== Review queue =====

  it("rescan is idempotent and overview tracks counts", async () => {
    const owner = await registerTenant();
    const customerId = await insertCustomer(owner.tenantId);
    await insertOrder(owner.tenantId, customerId, { placedAt: hoursAgo(1) });
    await insertOrder(owner.tenantId, customerId, { placedAt: new Date() });

    const first = await request(app).post("/api/v1/admin/fraud/scan").set("Authorization", `Bearer ${owner.token}`);
    expect(first.body.data.flagsCreated).toBe(0);

    await insertOrder(owner.tenantId, customerId, { placedAt: hoursAgo(2) });
    const second = await request(app).post("/api/v1/admin/fraud/scan").set("Authorization", `Bearer ${owner.token}`);
    expect(second.body.data.flagsCreated).toBe(3);

    const third = await request(app).post("/api/v1/admin/fraud/scan").set("Authorization", `Bearer ${owner.token}`);
    expect(third.body.data.flagsCreated).toBe(0);

    const overview = await request(app).get("/api/v1/admin/fraud/overview").set("Authorization", `Bearer ${owner.token}`);
    expect(overview.body.data.open).toBe(3);
    expect(overview.body.data.total).toBe(3);

    const openList = await request(app).get("/api/v1/admin/fraud/flags?status=open").set("Authorization", `Bearer ${owner.token}`);
    expect(openList.body.meta.total).toBe(3);
  });

  it("owner can resolve a flag and it writes an audit log", async () => {
    const owner = await registerTenant();
    const customerId = await insertCustomer(owner.tenantId);
    await insertOrder(owner.tenantId, customerId);
    await insertAddress(owner.tenantId, customerId, { label: "Home", address1: "1 A St", city: "Portland", zip: "97201", country: "US", isDefault: true });
    await insertAddress(owner.tenantId, customerId, { label: "Shipping", address1: "2 B St", city: "Austin", zip: "78701", country: "US" });
    await request(app).post("/api/v1/admin/fraud/scan").set("Authorization", `Bearer ${owner.token}`).expect(200);

    const [flag] = await latestFlags(owner);
    const detail = await request(app).get(`/api/v1/admin/fraud/flags/${flag!.id}`).set("Authorization", `Bearer ${owner.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.orderNumber).toBeGreaterThan(1000);

    const resolve = await request(app)
      .post(`/api/v1/admin/fraud/flags/${flag!.id}/resolve`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ status: "cleared", notes: "Gentle leak, shipping address is legit." });
    expect(resolve.status).toBe(200);
    expect(resolve.body.data.status).toBe("cleared");
    expect(resolve.body.data.notes).toBe("Gentle leak, shipping address is legit.");

    const { rows } = await db.query<{ n: string }>("SELECT COUNT(*)::text n FROM audit_logs WHERE action = 'fraud.cleared'");
    expect(Number(rows[0]!.n)).toBe(1);

    const overview = await request(app).get("/api/v1/admin/fraud/overview").set("Authorization", `Bearer ${owner.token}`);
    expect(overview.body.data.open).toBe(0);
    expect(overview.body.data.cleared).toBe(1);
  });

  // ===== Isolation + guards =====

  it("keeps flags isolated per tenant and returns 404 for foreign flags", async () => {
    const ownerA = await registerTenant("Tenant A");
    const ownerB = await registerTenant("Tenant B");

    const customerA = await insertCustomer(ownerA.tenantId);
    await insertOrder(ownerA.tenantId, customerA);
    await insertAddress(ownerA.tenantId, customerA, { label: "Home", address1: "1 A St", city: "Portland", zip: "97201", country: "US", isDefault: true });
    await insertAddress(ownerA.tenantId, customerA, { label: "Shipping", address1: "2 B St", city: "Austin", zip: "78701", country: "US" });
    await request(app).post("/api/v1/admin/fraud/scan").set("Authorization", `Bearer ${ownerA.token}`).expect(200);

    const flagsA = await latestFlags(ownerA);
    expect(flagsA).toHaveLength(1);

    const listB = await request(app).get("/api/v1/admin/fraud/flags").set("Authorization", `Bearer ${ownerB.token}`);
    expect(listB.body.data).toHaveLength(0);

    const detailB = await request(app).get(`/api/v1/admin/fraud/flags/${flagsA[0]!.id}`).set("Authorization", `Bearer ${ownerB.token}`);
    expect(detailB.status).toBe(404);
  });

  it("requires authentication for admin fraud endpoints", async () => {
    const res = await request(app).get("/api/v1/admin/fraud/config");
    expect(res.status).toBe(401);
  });
});