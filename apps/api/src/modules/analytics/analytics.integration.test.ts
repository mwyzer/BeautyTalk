import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPool } from "@beautyai/db";
import { makeTestAppWith, setupTestDb, truncateAll } from "../../test/helpers.js";
import { createStubAnalyticsFetcher } from "../../analytics/stub.js";

interface Owner {
  token: string;
  tenantId: string;
}

describe("Phase 4 Marketing Analytics", () => {
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
    ({ app } = makeTestAppWith(db, {}, null, null, createStubAnalyticsFetcher()));
  });

  async function registerTenant(): Promise<Owner> {
    instance += 1;
    const res = await request(app).post("/api/v1/auth/register").send({
      storeName: "Glow Co.",
      email: `owner${instance}@example.com`,
      password: "Password123!",
      fullName: "Test Owner",
    });
    expect(res.status).toBe(201);
    return { token: res.body.tokens.accessToken as string, tenantId: res.body.tenant.id as string };
  }

  async function connect(owner: Owner, provider: string): Promise<void> {
    const res = await request(app)
      .post("/api/v1/admin/analytics/connections")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ provider, demo: true });
    expect(res.status).toBe(200);
  }

  const RANGE = { startDate: "2026-01-10", endDate: "2026-01-31" };

  async function sync(owner: Owner, providers: string[]): Promise<void> {
    const res = await request(app)
      .post("/api/v1/admin/analytics/syncs")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ providers, ...RANGE });
    expect(res.status).toBe(200);
    const results = res.body.data.results as Array<{ provider: string; queued: boolean; sync?: { status: string } }>;
    expect(results.map((r) => r.provider).sort()).toEqual([...providers].sort());
    expect(results.every((r) => !r.queued && r.sync?.status === "completed")).toBe(true);
  }

  it("stores demo connections with encrypted tokens", async () => {
    const owner = await registerTenant();
    const res = await request(app)
      .post("/api/v1/admin/analytics/connections")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ provider: "ga4", demo: true });
    expect(res.status).toBe(200);
    const conn = res.body.data as { provider: string; status: string; accountId: string | null };
    expect(conn.provider).toBe("ga4");
    expect(conn.status).toBe("connected");
    expect(conn.accountId).toBe("demo-property");

    const { rows } = await db.query<{ access_token_enc: string | null }>(
      "SELECT access_token_enc FROM analytics_connections WHERE tenant_id = $1 AND provider = 'ga4'",
      [owner.tenantId],
    );
    expect(rows[0]?.access_token_enc).toBeTruthy();
    expect(rows[0]!.access_token_enc).not.toContain("stub-access-token");
  });

  it("rejects real connects when Google OAuth is not configured", async () => {
    const owner = await registerTenant();
    const res = await request(app)
      .post("/api/v1/admin/analytics/connections")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ provider: "gsc", code: "abc" });
    expect(res.status).toBe(503);
  });

  it("syncs GSC/GA4/Ads demo data and exposes reports + overview", async () => {
    const owner = await registerTenant();
    await connect(owner, "gsc");
    await connect(owner, "ga4");
    await connect(owner, "ads");
    await sync(owner, ["gsc", "ga4", "ads"]);

    const list = await request(app).get("/api/v1/admin/analytics/connections").set("Authorization", `Bearer ${owner.token}`);
    expect(list.status).toBe(200);
    expect((list.body.data as Array<{ provider: string }>).length).toBe(3);

    const syncRes = await request(app).get("/api/v1/admin/analytics/syncs").set("Authorization", `Bearer ${owner.token}`);
    expect(syncRes.status).toBe(200);
    const syncs = syncRes.body.data as Array<{ provider: string; status: string; recordsProcessed: number }>;
    expect(syncs).toHaveLength(3);
    for (const s of syncs) {
      expect(s.status).toBe("completed");
      expect(s.recordsProcessed).toBeGreaterThan(0);
    }

    const gsc = await request(app).get("/api/v1/admin/analytics/reports/gsc?startDate=2026-01-01&endDate=2026-01-31").set("Authorization", `Bearer ${owner.token}`);
    expect(gsc.status).toBe(200);
    const gscRows = gsc.body.data.rows as Array<{ query: string | null; clicks: number; impressions: number }>;
    expect(gscRows.length).toBeGreaterThan(0);
    expect(gscRows.some((r) => r.clicks > 0)).toBe(true);

    const ga4 = await request(app).get("/api/v1/admin/analytics/reports/ga4?startDate=2026-01-01&endDate=2026-01-31").set("Authorization", `Bearer ${owner.token}`);
    expect(ga4.status).toBe(200);
    const ga4Rows = ga4.body.data.rows as Array<{ sessions: number; source: string | null }>;
    expect(ga4Rows.length).toBeGreaterThan(0);
    expect(ga4Rows.some((r) => r.sessions > 0)).toBe(true);

    const ads = await request(app).get("/api/v1/admin/analytics/reports/ads?startDate=2026-01-01&endDate=2026-01-31").set("Authorization", `Bearer ${owner.token}`);
    expect(ads.status).toBe(200);
    const adsRows = ads.body.data.rows as Array<{ campaignName: string | null; cost: number; roas: number }>;
    expect(adsRows.length).toBeGreaterThan(0);

    const overview = await request(app).get("/api/v1/admin/analytics/overview?startDate=2026-01-01&endDate=2026-01-31").set("Authorization", `Bearer ${owner.token}`);
    expect(overview.status).toBe(200);
    const ov = overview.body.data as {
      kpis: { organicClicks: number; sessions: number; adSpend: number; roas: number };
      series: Array<{ date: string }>;
    };
    expect(ov.kpis.organicClicks).toBeGreaterThan(0);
    expect(ov.kpis.sessions).toBeGreaterThan(0);
    expect(ov.kpis.adSpend).toBeGreaterThan(0);
    expect(ov.kpis.roas).toBeGreaterThan(0);
    expect(ov.series.length).toBeGreaterThan(0);
  });

  it("keeps analytics data isolated per tenant", async () => {
    const ownerA = await registerTenant();
    await connect(ownerA, "ga4");
    await sync(ownerA, ["ga4"]);
    const { rows: aBefore } = await db.query<{ c: string }>("SELECT count(*)::text AS c FROM ga4_data WHERE tenant_id = $1", [ownerA.tenantId]);
    const countBefore = Number(aBefore[0]!.c);

    const ownerB = await registerTenant();
    await connect(ownerB, "ga4");
    await sync(ownerB, ["ga4"]);

    const { rows: aAfter } = await db.query<{ c: string }>("SELECT count(*)::text AS c FROM ga4_data WHERE tenant_id = $1", [ownerA.tenantId]);
    const { rows: bCount } = await db.query<{ c: string }>("SELECT count(*)::text AS c FROM ga4_data WHERE tenant_id = $1", [ownerB.tenantId]);

    expect(Number(aAfter[0]!.c)).toBe(countBefore);
    expect(Number(bCount[0]!.c)).toBe(countBefore);
  });

  it("disconnect purges that provider's data", async () => {
    const owner = await registerTenant();
    await connect(owner, "ga4");
    await sync(owner, ["ga4"]);
    const { rows: before } = await db.query<{ c: string }>("SELECT count(*)::text AS c FROM ga4_data WHERE tenant_id = $1", [owner.tenantId]);
    expect(Number(before[0]!.c)).toBeGreaterThan(0);

    const del = await request(app)
      .delete("/api/v1/admin/analytics/connections/ga4")
      .set("Authorization", `Bearer ${owner.token}`);
    expect(del.status).toBe(200);

    const { rows: after } = await db.query<{ c: string }>("SELECT count(*)::text AS c FROM ga4_data WHERE tenant_id = $1", [owner.tenantId]);
    expect(Number(after[0]!.c)).toBe(0);

    const list = await request(app).get("/api/v1/admin/analytics/connections").set("Authorization", `Bearer ${owner.token}`);
    const conns = list.body.data as Array<{ provider: string }>;
    expect(conns.some((c) => c.provider === "ga4")).toBe(false);
  });
});