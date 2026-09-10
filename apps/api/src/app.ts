import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { DbPool } from "@beautyai/db";
import type { AppConfig } from "./config/env.js";
import { createPayments } from "./payments/stripe.js";
import { errorHandler, notFoundHandler, ApiError } from "./lib/http.js";
import { authenticate, requireRoles } from "./middleware/auth.js";
import { createAuthRouter, createAuthService } from "./modules/auth/index.js";
import { createAdminUsersRouter } from "./modules/users/routes.js";
import { createPublicProductsRouter, createPublicCollectionsRouter, createAdminCatalogRouter } from "./modules/catalog/index.js";
import { createCartsRouter } from "./modules/carts/routes.js";
import { createCheckoutRouter, createCheckoutService, createStripeWebhookRouter } from "./modules/checkout/index.js";
import { createAdminOrdersRouter } from "./modules/orders/index.js";
import { createCustomerAuthRouter, createCustomerAccountRouter, createCustomerAdminRouter, createCustomerAuthService } from "./modules/customers/index.js";
import { createContentService, createAdminContentRouter, createContentProvider } from "./modules/content/index.js";
import { createAuditService, createAdminAuditRouter, type AuditService } from "./modules/audit/index.js";
import type { ContentProvider } from "./content/types.js";
import type { ContentJobClient } from "./jobs/contentQueue.js";
import type { AuditJobClient } from "./jobs/crawlQueue.js";
import { findActiveMemberships } from "./repositories/memberships.repo.js";
import { findTenantById } from "./repositories/tenants.repo.js";

export interface AppDeps {
  db: DbPool;
  config: AppConfig;
  contentProvider?: ContentProvider | null;
  jobs?: ContentJobClient | null;
  auditJobs?: AuditJobClient | null;
  auditService?: AuditService | null;
}

export function createApp({ db, config, contentProvider, jobs, auditJobs, auditService }: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));

  app.use((req, res, next) => {
    const headerId = req.headers["x-request-id"];
    req.id = (typeof headerId === "string" && headerId) || randomUUID();
    res.setHeader("X-Request-Id", req.id);
    next();
  });

  const payments = createPayments(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET, config.STRIPE_API_VERSION);
  const checkout = createCheckoutService(db, payments, config);

  // Raw body parser for verified webhooks only (must register before express.json()).
  app.use("/api/v1/webhooks", express.raw({ type: "application/json" }), createStripeWebhookRouter(checkout, payments, config));

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "beautyai-api", time: new Date().toISOString() });
  });

  const auth = createAuthService(db, config);
  const customerAuth = createCustomerAuthService(db, config);
  const merchantAuthenticate = authenticate(config);
  const content = createContentService({ db, provider: contentProvider === undefined ? createContentProvider(config) : contentProvider });
  const audit = auditService ?? createAuditService({ db, storefrontUrl: config.STOREFRONT_URL ?? "http://localhost:4321" });

  const api = express.Router();
  api.use("/auth", createAuthRouter(auth));

  // Public storefront API (tenant resolved from the X-Tenant-Slug header).
  api.use("/products", createPublicProductsRouter(db));
  api.use("/collections", createPublicCollectionsRouter(db));
  api.use("/carts", createCartsRouter(db));
  api.use("/checkout", createCheckoutRouter(db, checkout));

  // Customer auth endpoints (tenant-scoped, customer JWT).
  api.use("/customers", createCustomerAuthRouter(db, customerAuth));

  // Merchant session endpoints (exact-path so customer /me/* routes are unaffected).
  api.get("/me", merchantAuthenticate, async (req, res) => {
    const ctx = req.ctx!;
    const memberships = await findActiveMemberships(db, ctx.userId);
    res.json({ user_id: ctx.userId, memberships });
  });
  api.get("/tenant", merchantAuthenticate, async (req, res) => {
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

  // Merchant admin API (JWT + RBAC).
  api.use("/admin", merchantAuthenticate, requireRoles("owner", "editor"), createAdminCatalogRouter(db));
  api.use("/admin/users", merchantAuthenticate, requireRoles("owner", "editor"), createAdminUsersRouter(db));
  api.use("/admin/orders", merchantAuthenticate, requireRoles("owner", "editor"), createAdminOrdersRouter(db, payments));
  api.use("/admin/customers", merchantAuthenticate, requireRoles("owner", "editor"), createCustomerAdminRouter(db));
  api.use("/admin/content", merchantAuthenticate, requireRoles("owner", "editor"), createAdminContentRouter({ db, service: content, jobs }));
  api.use("/admin/seo", merchantAuthenticate, requireRoles("owner", "editor"), createAdminAuditRouter({ db, service: audit, jobs: auditJobs }));

  // Customer self-service (customer JWT). Mounted after merchant /me so GET /me stays merchant-only.
  api.use("/me", createCustomerAccountRouter(db, config));

  app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}