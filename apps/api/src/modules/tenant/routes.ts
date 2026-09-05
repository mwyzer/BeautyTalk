import { Router } from "express";
import type { Db } from "@beautyai/db";
import { ApiError } from "../../lib/http.js";
import { findTenantById } from "../../repositories/tenants.repo.js";
import { findActiveMemberships } from "../../repositories/memberships.repo.js";

export function createTenantRouter(db: Db): Router {
  const router = Router();

  router.get("/me", async (req, res) => {
    const ctx = req.ctx!;
    const memberships = await findActiveMemberships(db, ctx.userId);
    res.json({ user_id: ctx.userId, memberships });
  });

  router.get("/tenant", async (req, res) => {
    const tenant = await findTenantById(db, req.ctx!.tenantId);
    if (!tenant) throw ApiError.notFound("Tenant not found");
    res.json({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      custom_domain: tenant.custom_domain,
      currency: tenant.currency,
      locale: tenant.locale,
      status: tenant.status,
      created_at: tenant.created_at,
    });
  });

  return router;
}