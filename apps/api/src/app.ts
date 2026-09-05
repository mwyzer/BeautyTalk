import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { DbPool } from "@beautyai/db";
import type { AppConfig } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./lib/http.js";
import { authenticate, requireRoles } from "./middleware/auth.js";
import { createAuthRouter, createAuthService } from "./modules/auth/index.js";
import { createTenantRouter } from "./modules/tenant/routes.js";
import { createAdminUsersRouter } from "./modules/users/routes.js";

export interface AppDeps {
  db: DbPool;
  config: AppConfig;
}

export function createApp({ db, config }: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));

  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    const headerId = req.headers["x-request-id"];
    req.id = (typeof headerId === "string" && headerId) || randomUUID();
    res.setHeader("X-Request-Id", req.id);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "beautyai-api", time: new Date().toISOString() });
  });

  const auth = createAuthService(db, config);
  const authRouter = createAuthRouter(auth);
  const tenantRouter = createTenantRouter(db);
  const adminUsersRouter = createAdminUsersRouter(db);

  const api = express.Router();
  api.use("/auth", authRouter);

  api.use(authenticate(config));
  api.use("/", tenantRouter);
  api.use("/admin/users", requireRoles("owner", "editor"), adminUsersRouter);

  app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}