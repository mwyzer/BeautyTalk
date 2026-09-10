import { describe, expect, it } from "vitest";
import { createContentJobClient } from "./contentQueue.js";
import { createConfig } from "../config/env.js";

describe("content job queue", () => {
  const base = {
    DATABASE_URL: process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? "postgres://localhost:5432/beautyai_test",
    JWT_ACCESS_SECRET: "test_access_secret_at_least_16_chars",
    JWT_REFRESH_SECRET: "test_refresh_secret_at_least_16_chars",
    JWT_CUSTOMER_SECRET: "test_customer_secret_at_least_16_chars",
  };

  it("returns null without REDIS_URL (sync fallback)", () => {
    expect(createContentJobClient(createConfig(base))).toBeNull();
  });

  it("returns a client when REDIS_URL is present", () => {
    const client = createContentJobClient(createConfig({ ...base, REDIS_URL: "redis://localhost:6379" }));
    expect(client).not.toBeNull();
    expect(typeof client!.enqueue).toBe("function");
  });
});