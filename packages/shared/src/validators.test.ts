import { describe, expect, it } from "vitest";
import { createTenantSlug, loginSchema, registerSchema } from "./index.js";

describe("validators", () => {
  it("accepts a valid registration", () => {
    const parsed = registerSchema.safeParse({
      storeName: "Glow Co.",
      email: "Demo@Glow.Co ",
      password: "Password123!",
      fullName: "Maya Demo",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email).toBe("demo@glow.co");
    }
  });

  it("rejects a short password", () => {
    const parsed = registerSchema.safeParse({
      storeName: "Glow Co.",
      email: "demo@glow.co",
      password: "short",
      fullName: "Maya",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const parsed = loginSchema.safeParse({ email: "not-an-email", password: "Password123!" });
    expect(parsed.success).toBe(false);
  });

  it("creates a URL-safe slug from a store name", () => {
    expect(createTenantSlug("Glow Co.")).toBe("glow-co");
    expect(createTenantSlug("  Luxé ★ Labs  ")).toBe("lux-labs");
  });

  it("falls back to a time-based slug for unusable input", () => {
    const slug = createTenantSlug("!!!!");
    expect(slug).toMatch(/^store-/);
  });
});