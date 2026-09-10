import { createHash, randomUUID } from "node:crypto";
import type { DbPool } from "@beautyai/db";
import type {
  AuthResponse,
  AuthTokens,
  LoginInput,
  RegisterInput,
  Tenant,
  User,
} from "@beautyai/shared";
import { createTenantSlug } from "@beautyai/shared";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import type { AppConfig } from "../../config/env.js";
import {
  findActiveMembership,
  findActiveMemberships,
  createMembership,
} from "../../repositories/memberships.repo.js";
import { createRefreshToken, findValidToken, revokeAllForUser, revokeToken } from "../../repositories/refresh-tokens.repo.js";
import { createTenant, findTenantBySlug, findTenantById } from "../../repositories/tenants.repo.js";
import { createUser, findById as findUserById, findByEmail, updateLastLogin, recordFailedAttempt, isLocked } from "../../repositories/users.repo.js";
import { writeAuditLog } from "../../repositories/audit-logs.repo.js";
import { ApiError } from "../../lib/http.js";
import {
  parseDurationToSeconds,
  signAccessToken,
  signRefreshToken,
  verifyRefreshTokenPayload,
} from "../../lib/token.js";
import type { Role } from "@beautyai/shared";

export interface AuthService {
  register(input: RegisterInput, ip?: string): Promise<AuthResponse>;
  login(input: LoginInput, ip?: string): Promise<AuthResponse>;
  refresh(refreshToken: string, ip?: string): Promise<AuthTokens>;
  logout(refreshToken: string, all: boolean): Promise<void>;
}

export function createAuthService(db: DbPool, config: AppConfig): AuthService {
  const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

  const issueTokens = async (userId: string, tenantId: string, role: Role): Promise<AuthTokens> => {
    const ctx = { userId, tenantId, role };
    const accessToken = signAccessToken(config.JWT_ACCESS_SECRET, config.JWT_ACCESS_TTL, ctx);
    const jti = randomUUID();
    const refreshToken = signRefreshToken(config.JWT_REFRESH_SECRET, config.JWT_REFRESH_TTL, ctx, jti);
    const expiresAt = new Date(Date.now() + parseDurationToSeconds(config.JWT_REFRESH_TTL) * 1000);
    await createRefreshToken(db, { userId, tenantId, tokenHash: hashToken(refreshToken), expiresAt });
    return {
      accessToken,
      refreshToken,
      expiresIn: parseDurationToSeconds(config.JWT_ACCESS_TTL),
    };
  };

  const toUser = (row: { id: string; email: string; full_name: string | null; status: string; last_login_at: Date | null; created_at: Date; updated_at: Date }): User => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    status: row.status as User["status"],
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });

  const toTenant = (row: { id: string; name: string; slug: string; custom_domain: string | null; currency: string; locale: string; status: string; created_at: Date }): Tenant => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    customDomain: row.custom_domain,
    currency: row.currency,
    locale: row.locale,
    status: row.status as Tenant["status"],
    createdAt: row.created_at.toISOString(),
  });

  const buildResponse = async (userId: string, tenantId: string, role: Role): Promise<AuthResponse> => {
    const [user, tenant, tokens] = await Promise.all([
      findUserById(db, userId),
      findTenantById(db, tenantId),
      issueTokens(userId, tenantId, role),
    ]);
    if (!user || !tenant) throw ApiError.unauthorized("Session no longer valid");
    return { tokens, user: toUser(user), tenant: toTenant(tenant) };
  };

  async function ensureUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    for (let i = 1; i < 20; i += 1) {
      const existing = await findTenantBySlug(db, slug);
      if (!existing) return slug;
      slug = `${baseSlug}-${i}`;
    }
    throw ApiError.conflict("Unable to allocate a unique store slug, please retry");
  }

  return {
    async register(input, ip) {
      const existing = await findByEmail(db, input.email);
      if (existing) throw ApiError.conflict("An account with this email already exists");

      const slug = await ensureUniqueSlug(createTenantSlug(input.storeName));
      const passwordHash = await argon2Hash(input.password);

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const tenant = await createTenant(client, { name: input.storeName, slug });
        const user = await createUser(client, {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
        });
        await createMembership(client, { tenantId: tenant.id, userId: user.id, role: "owner" });
        await writeAuditLog(client, {
          tenantId: tenant.id,
          userId: user.id,
          action: "tenant.created",
          resourceType: "tenant",
          resourceId: tenant.id,
          ip,
        });
        await client.query("COMMIT");
        const response = await buildResponse(user.id, tenant.id, "owner");
        await writeAuditLog(db, {
          tenantId: tenant.id,
          userId: user.id,
          action: "auth.login",
          after: { via: "register" },
          ip,
        });
        return response;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async login(input, ip) {
      const user = await findByEmail(db, input.email);
      if (!user || !user.password_hash) throw ApiError.unauthorized("Invalid email or password");
      if (await isLocked(db, user)) throw ApiError.rateLimited("This account is temporarily locked. Try again later.");
      const valid = await argon2Verify(user.password_hash, input.password);
      if (!valid) {
        await recordFailedAttempt(db, user.id);
        throw ApiError.unauthorized("Invalid email or password");
      }
      if (user.status !== "active") throw ApiError.forbidden("This account is disabled");

      const memberships = await findActiveMemberships(db, user.id);
      const membership = memberships[0];
      if (!membership) throw ApiError.forbidden("This account is not a member of any active store");

      await updateLastLogin(db, user.id);
      await writeAuditLog(db, {
        tenantId: membership.tenant_id,
        userId: user.id,
        action: "auth.login",
        ip,
      });
      return buildResponse(user.id, membership.tenant_id, membership.role as Role);
    },

    async refresh(refreshToken, ip) {
      let claims;
      try {
        claims = verifyRefreshTokenPayload(config.JWT_REFRESH_SECRET, refreshToken);
      } catch {
        throw ApiError.unauthorized("Invalid or expired refresh token");
      }

      const stored = await findValidToken(db, hashToken(refreshToken), new Date());
      if (!stored) throw ApiError.unauthorized("Refresh token has been revoked");
      if (stored.user_id !== claims.sub || stored.tenant_id !== claims.tenant_id) {
        throw ApiError.unauthorized("Refresh token mismatch");
      }

      const membership = await findActiveMembership(db, stored.user_id, stored.tenant_id);
      if (!membership) throw ApiError.forbidden("Membership is no longer active");
      const user = await findUserById(db, stored.user_id);
      if (!user || user.status !== "active") throw ApiError.forbidden("Account is disabled");

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await revokeToken(client, stored.id, new Date());
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      const tokens = await issueTokens(stored.user_id, stored.tenant_id, membership.role as Role);
      await writeAuditLog(db, {
        tenantId: stored.tenant_id,
        userId: stored.user_id,
        action: "auth.refresh",
        ip,
      });
      return tokens;
    },

    async logout(refreshToken, all) {
      let claims;
      try {
        claims = verifyRefreshTokenPayload(config.JWT_REFRESH_SECRET, refreshToken);
      } catch {
        return;
      }
      const now = new Date();
      if (all) {
        await revokeAllForUser(db, claims.sub, claims.tenant_id, now);
        return;
      }
      const stored = await findValidToken(db, hashToken(refreshToken), now);
      if (stored) await revokeToken(db, stored.id, now);
    },
  };
}