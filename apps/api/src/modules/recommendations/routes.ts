import { Router } from "express";
import type { Db } from "@beautyai/db";
import { recEventSchema, recStrategyConfigSchema } from "@beautyai/shared";
import { resolveTenant } from "../../middleware/tenant.js";
import { validateBody } from "../../middleware/validate.js";
import type { RecommendationService } from "./service.js";
import type { RecJobClient } from "../../jobs/recQueue.js";

function parseLimit(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : fallback;
}

/** POST /events — tenant-scoped event capture. Mounted at /events. */
export function createPublicEventsRouter(db: Db, service: RecommendationService): Router {
  const router = Router();
  router.use(resolveTenant(db));

  router.post("/", validateBody(recEventSchema), async (req, res) => {
    const created = await service.recordEvent(req.tenant!.id, req.body);
    res.status(201).json({ data: created });
  });

  return router;
}

/**
 * GET /:handle/related and GET /:handle/bought-together.
 * Mounted at /products alongside the existing catalog products router.
 */
export function createPublicProductRecsRouter(db: Db, service: RecommendationService): Router {
  const router = Router();
  router.use(resolveTenant(db));

  router.get("/:handle/related", async (req, res) => {
    const tenantId = req.tenant!.id;
    const recs = await service.related(tenantId, String(req.params.handle), parseLimit(req.query.limit, 8));
    res.json({ data: recs });
  });

  router.get("/:handle/bought-together", async (req, res) => {
    const tenantId = req.tenant!.id;
    const recs = await service.boughtTogether(tenantId, String(req.params.handle), parseLimit(req.query.limit, 4));
    res.json({ data: recs });
  });

  return router;
}

/** GET /recommended — homepage personalization. Mounted at /home. */
export function createPublicHomeRouter(db: Db, service: RecommendationService): Router {
  const router = Router();
  router.use(resolveTenant(db));

  router.get("/recommended", async (req, res) => {
    const tenantId = req.tenant!.id;
    const sessionId = typeof req.query.sessionId === "string" && req.query.sessionId.trim() ? req.query.sessionId.trim() : undefined;
    const recs = await service.home(tenantId, { limit: parseLimit(req.query.limit, 8), sessionId });
    res.json({ data: recs });
  });

  return router;
}

/** Admin strategy config + refresh. Mounted at /admin/recommendations. */
export function createAdminRecommendationsRouter(deps: { service: RecommendationService; jobs?: RecJobClient | null }): Router {
  const router = Router();
  const { service, jobs } = deps;

  router.get("/strategies", async (req, res) => {
    res.json({ data: await service.getConfig(req.ctx!.tenantId) });
  });

  router.put("/strategies", validateBody(recStrategyConfigSchema), async (req, res) => {
    const config = await service.updateConfig(req.ctx!.tenantId, req.body);
    res.json({ data: config });
  });

  router.post("/refresh", async (req, res) => {
    const tenantId = req.ctx!.tenantId;
    const jobId = jobs ? await jobs.enqueue({ tenantId }) : undefined;
    if (jobId) {
      res.json({ data: { ok: true, queued: true, jobId } });
      return;
    }
    const result = await service.refresh(tenantId);
    res.json({ data: result });
  });

  return router;
}