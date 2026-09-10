import { describe, expect, it } from "vitest";
import { deriveStubSeed, makeTokenCipher } from "./crypto.js";

describe("analytics crypto", () => {
  it("round-trips OAuth tokens with authenticated encryption", () => {
    const cipher = makeTokenCipher("super-secret-signing-key-123456");
    const token = "ya29.abc-123-ish-refresh-token-value";
    const enc = cipher.encrypt(token);
    expect(enc).not.toContain(token);
    expect(cipher.decrypt(enc)).toBe(token);
  });

  it("produces unique ciphertext per encryption (random IV)", () => {
    const cipher = makeTokenCipher("another-secret-key-123456");
    expect(cipher.encrypt("same")).not.toBe(cipher.encrypt("same"));
  });

  it("rejects tampered payloads", () => {
    const cipher = makeTokenCipher("tamper-check-key-1234567");
    const enc = cipher.encrypt("guarded");
    const parts = enc.split(".");
    expect(() => cipher.decrypt(`${parts[0]!}.${parts[1]!}.AA==`)).toThrow();
  });

  it("derives deterministic stub sequences per seed", () => {
    const a = deriveStubSeed("demo-customer", "ads", "2026-01-01");
    const b = deriveStubSeed("demo-customer", "ads", "2026-01-01");
    const samples = Array.from({ length: 10 }, () => a());
    expect(Array.from({ length: 10 }, () => b())).toEqual(samples);
    const c = deriveStubSeed("demo-customer", "ads", "2026-01-02");
    expect(Array.from({ length: 10 }, () => c())).not.toEqual(samples);
  });
});