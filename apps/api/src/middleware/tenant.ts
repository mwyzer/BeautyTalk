import type { NextFunction, Request, Response } from "express";
import type { Db } from "@beautyai/db";
import type { Tenant } from "@beautyai/shared";
import { ApiError } from "../lib/http.js";
import { findTenantBySlug } from "../repositories/tenants.repo.js";

export type PublicTenant = Tenant;

export function resolveTenant(db: Db) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.headers["x-tenant-slug"];
      const slug = (typeof header === "string" ? header : req.query.slug) as string | undefined;
      if (!slug) {
        next(ApiError.notFound("Store not found"));
        return;
      }
      const tenant = await findTenantBySlug(db, slug);
      if (!tenant || tenant.status !== "active") {
        next(ApiError.notFound("Store not found"));
        return;
      }
      req.tenant = {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        customDomain: tenant.custom_domain ?? null,
        currency: tenant.currency ?? "usd",
        locale: tenant.locale ?? "en",
        status: tenant.status as Tenant["status"],
        createdAt: tenant.created_at.toISOString(),
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}