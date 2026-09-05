import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPool } from "@beautyai/db";
import { makeTestApp, setupTestDb, truncateAll } from "../../test/helpers.js";

const demoUser = {
  storeName: "Glow Co.",
  email: "demo@glow.co",
  password: "Password123!",
  fullName: "Maya Demo",
};

describe("auth", () => {
  let db: DbPool;
  let app: Express;

  beforeAll(async () => {
    db = await setupTestDb();
    app = makeTestApp(db).app;
  });

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it("registers a tenant + owner and returns tokens", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(demoUser);
    expect(res.status).toBe(201);
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tokens.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe("demo@glow.co");
    expect(res.body.tenant.slug).toBe("glow-co");
    expect(res.body.tenant.id).toBeTruthy();
  });

  it("rejects duplicate email registration", async () => {
    await request(app).post("/api/v1/auth/register").send(demoUser).expect(201);
    const res = await request(app).post("/api/v1/auth/register").send(demoUser);
    expect(res.status).toBe(409);
  });

  it("rejects invalid registration payloads", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      storeName: "Glow Co.",
      email: "bademail",
      password: "short",
      fullName: "",
    });
    expect(res.status).toBe(422);
    expect(res.body.status).toBe(422);
    expect(res.body.errors).toHaveProperty("email");
  });

  it("logs in with valid credentials", async () => {
    await request(app).post("/api/v1/auth/register").send(demoUser).expect(201);
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: demoUser.email, password: demoUser.password });
    expect(res.status).toBe(200);
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tenant.name).toBe("Glow Co.");
  });

  it("rejects login with a wrong password", async () => {
    await request(app).post("/api/v1/auth/register").send(demoUser).expect(201);
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: demoUser.email, password: "WrongPassword!" });
    expect(res.status).toBe(401);
  });

  it("returns the current session with a valid access token", async () => {
    const reg = await request(app).post("/api/v1/auth/register").send(demoUser).expect(201);
    const token = reg.body.tokens.accessToken as string;
    const res = await request(app).get("/api/v1/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(reg.body.user.id);
    expect(res.body.memberships[0].role).toBe("owner");
  });

  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/v1/me");
    expect(res.status).toBe(401);
  });

  it("rejects requests with an invalid token", async () => {
    const res = await request(app).get("/api/v1/me").set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
  });

  it("refreshes tokens and rotates the refresh token", async () => {
    const reg = await request(app).post("/api/v1/auth/register").send(demoUser).expect(201);
    const refreshToken = reg.body.tokens.refreshToken as string;

    const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const newRefresh = res.body.refreshToken as string;
    expect(newRefresh).not.toBe(refreshToken);

    const reuse = await request(app).post("/api/v1/auth/refresh").send({ refreshToken });
    expect(reuse.status).toBe(401);

    const valid = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: newRefresh });
    expect(valid.status).toBe(200);
  });

  it("revokes the refresh token on logout", async () => {
    const reg = await request(app).post("/api/v1/auth/register").send(demoUser).expect(201);
    const refreshToken = reg.body.tokens.refreshToken as string;

    await request(app).post("/api/v1/auth/logout").send({ refreshToken }).expect(204);

    const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken });
    expect(res.status).toBe(401);
  });
});