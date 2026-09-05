import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPool } from "@beautyai/db";
import { signAccessToken } from "../lib/token.js";
import { makeTestApp, setupTestDb, truncateAll } from "./helpers.js";
import { createUser } from "../repositories/users.repo.js";
import { createMembership } from "../repositories/memberships.repo.js";

describe("tenant isolation", () => {
  let db: DbPool;
  let app: Express;
  let config: ReturnType<typeof makeTestApp>["config"];

  beforeAll(async () => {
    db = await setupTestDb();
    ({ app, config } = makeTestApp(db));
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  async function registerTenant(brand: { storeName: string; email: string; password: string; fullName: string }) {
    const res = await request(app).post("/api/v1/auth/register").send(brand);
    expect(res.status).toBe(201);
    return {
      token: res.body.tokens.accessToken as string,
      userId: res.body.user.id as string,
      tenantId: res.body.tenant.id as string,
    };
  }

  it("each tenant sees only its own users in the members list", async () => {
    const a = await registerTenant({
      storeName: "Glow Co.",
      email: "a@glow.co",
      password: "Password123!",
      fullName: "A Owner",
    });
    const b = await registerTenant({
      storeName: "Luxe Labs",
      email: "b@luxe.test",
      password: "Password123!",
      fullName: "B Owner",
    });

    const aList = await request(app).get("/api/v1/admin/users").set("Authorization", `Bearer ${a.token}`);
    expect(aList.status).toBe(200);
    expect(aList.body.data).toHaveLength(1);
    expect(aList.body.data[0].email).toBe("a@glow.co");

    const bList = await request(app).get("/api/v1/admin/users").set("Authorization", `Bearer ${b.token}`);
    expect(bList.status).toBe(200);
    expect(bList.body.data).toHaveLength(1);
    expect(bList.body.data[0].email).toBe("b@luxe.test");
  });

  it("returning 404 (not 403) when querying a user id from another tenant", async () => {
    const a = await registerTenant({ storeName: "Glow Co.", email: "a@glow.co", password: "Password123!", fullName: "A" });
    const b = await registerTenant({ storeName: "Luxe Labs", email: "b@luxe.test", password: "Password123!", fullName: "B" });

    const res = await request(app)
      .get(`/api/v1/admin/users/${b.userId}`)
      .set("Authorization", `Bearer ${a.token}`);
    expect(res.status).toBe(404);
  });

  it("resolves a user id within the same tenant", async () => {
    const a = await registerTenant({ storeName: "Glow Co.", email: "a@glow.co", password: "Password123!", fullName: "A" });
    const res = await request(app)
      .get(`/api/v1/admin/users/${a.userId}`)
      .set("Authorization", `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("a@glow.co");
  });

  it("a viewer token cannot access owner/editor routes", async () => {
    const a = await registerTenant({ storeName: "Glow Co.", email: "a@glow.co", password: "Password123!", fullName: "A" });
    const viewer = await createUser(db, { email: "viewer@glow.co", passwordHash: null, fullName: "Viewer" });
    await createMembership(db, { tenantId: a.tenantId, userId: viewer.id, role: "viewer" });

    const viewerToken = signAccessToken(config.JWT_ACCESS_SECRET, "15m", {
      userId: viewer.id,
      tenantId: a.tenantId,
      role: "viewer",
    });

    const res = await request(app).get("/api/v1/admin/users").set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it("queries are always scoped to the token's tenant", async () => {
    const a = await registerTenant({ storeName: "Glow Co.", email: "a@glow.co", password: "Password123!", fullName: "A" });
    const b = await registerTenant({ storeName: "Luxe Labs", email: "b@luxe.test", password: "Password123!", fullName: "B" });

    const res = await request(app)
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${b.token}`);
    // Data is keyed to the token's tenant (B) regardless of what other tenants exist.
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].email).toBe("b@luxe.test");

    const { rows } = await db.query("SELECT count(*) AS n FROM tenants");
    expect(Number(rows[0]!.n)).toBe(2);

    void a;
  });

  it("tenant endpoint returns only the authenticated tenant", async () => {
    const a = await registerTenant({ storeName: "Glow Co.", email: "a@glow.co", password: "Password123!", fullName: "A" });
    await registerTenant({ storeName: "Luxe Labs", email: "b@luxe.test", password: "Password123!", fullName: "B" });

    const res = await request(app).get("/api/v1/tenant").set("Authorization", `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("glow-co");
  });
});