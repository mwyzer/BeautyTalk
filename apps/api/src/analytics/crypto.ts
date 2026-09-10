import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

export interface TokenCipher {
  encrypt(value: string): string;
  decrypt(payload: string): string;
}

/**
 * AES-256-GCM authenticated encryption for stored provider tokens.
 * The key is derived from the configured secret via SHA-256 so any
 * reasonably-sized secret works without a separate key-management step.
 */
export function makeTokenCipher(secret: string): TokenCipher {
  const key = createHash("sha256").update(secret).digest();
  return {
    encrypt(value: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
    },
    decrypt(payload: string): string {
      const [ivB64, tagB64, dataB64] = payload.split(".");
      if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted payload");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
      decipher.setAuthTag(Buffer.from(tagB64, "base64"));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
      return decrypted.toString("utf8");
    },
  };
}

export function deriveStubSeed(...parts: string[]): () => number {
  const seedStr = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}