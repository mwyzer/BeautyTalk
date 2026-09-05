import jwt, { type SignOptions } from "jsonwebtoken";
import type { AuthContext, Role } from "@beautyai/shared";

export interface TokenClaims {
  sub: string; // user id (merchant) or customer id
  tenant_id: string;
  role?: Role;
  type: "access" | "refresh" | "customer";
  jti?: string;
}

export function parseDurationToSeconds(input: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(input.trim());
  if (!match) throw new Error(`Invalid duration: ${input}`);
  const value = Number(match[1]);
  const unit = match[2];
  if (!unit) throw new Error(`Invalid duration: ${input}`);
  const factors: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const factor = factors[unit];
  if (factor === undefined) throw new Error(`Invalid duration unit: ${unit}`);
  return value * factor;
}

export function signAccessToken(
  secret: string,
  ttl: string,
  ctx: AuthContext,
): string {
  const payload: TokenClaims = { sub: ctx.userId, tenant_id: ctx.tenantId, role: ctx.role, type: "access" };
  const options: SignOptions = { expiresIn: ttl as SignOptions["expiresIn"] };
  return jwt.sign(payload, secret, options);
}

export function signRefreshToken(
  secret: string,
  ttl: string,
  ctx: AuthContext,
  jti: string,
): string {
  const payload: TokenClaims = { sub: ctx.userId, tenant_id: ctx.tenantId, role: ctx.role, type: "refresh", jti };
  const options: SignOptions = { expiresIn: ttl as SignOptions["expiresIn"] };
  return jwt.sign(payload, secret, options);
}

export function verifyAccessToken(secret: string, token: string): AuthContext {
  const payload = jwt.verify(token, secret) as TokenClaims;
  if (payload.type !== "access" || !payload.sub || !payload.tenant_id) {
    throw new Error("Invalid access token payload");
  }
  return { userId: payload.sub, tenantId: payload.tenant_id, role: payload.role };
}

export function signCustomerToken(secret: string, ttl: string, customerId: string, tenantId: string): string {
  const payload: TokenClaims = { sub: customerId, tenant_id: tenantId, type: "customer" };
  const options: SignOptions = { expiresIn: ttl as SignOptions["expiresIn"] };
  return jwt.sign(payload, secret, options);
}

export function verifyCustomerToken(secret: string, token: string): { customerId: string; tenantId: string } {
  const payload = jwt.verify(token, secret) as TokenClaims;
  if (payload.type !== "customer" || !payload.sub || !payload.tenant_id) {
    throw new Error("Invalid customer token");
  }
  return { customerId: payload.sub, tenantId: payload.tenant_id };
}

export function verifyRefreshTokenPayload(secret: string, token: string): TokenClaims & { jti: string } {
  const payload = jwt.verify(token, secret) as TokenClaims;
  if (payload.type !== "refresh" || !payload.sub || !payload.tenant_id || !payload.jti) {
    throw new Error("Invalid refresh token payload");
  }
  return payload as TokenClaims & { jti: string };
}