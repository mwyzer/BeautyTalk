import { Router } from "express";
import type { Db } from "@beautyai/db";
import { fraudConfigSchema, fraudResolveSchema, type FraudFlagStatus } from "@beautyai/shared";
import { requireRoles } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { writeAuditLog } from "../../repositories/audit-logs.repo.js";
import type { FraudService } from "./service.js";
import type { FraudJobClient } from "../../jobs/fraudQueue.js";

const FRAUD_FLAG_STATUSES: FraudFlagStatus[] = ["open", "cleared", "blocked"];

function parsePagination(req: { query: Record<string, unknown> }): { page: number; limit: number } {
  return {
    page: Math.max(1, Number(req.query.page ?? 1) || 1),
    limit: Math.min(100, Math.max(1, Number(req.query.limit ?? 25) || 25)),
  };
}

/** Fraud detection + review queue. Mounted at /admin/fraud (JWT + owner/editor). */
export function createAdminFraudRouter(deps: { db: Db; service: FraudService; jobs?: FraudJobClient | null }): Router {
  const router = Router();
  const { db, service, jobs } = deps;

  router.get("/config", async (req, res) => {
    res.json({ data: await service.getConfig(req.ctx!.tenantId) });
  });

  router.put("/config", validateBody(fraudConfigSchema), async (req, res) => {
    const config = await service.updateConfig(req.ctx!.tenantId, req.body);
    res.json({ data: config });
  });

  router.post("/scan", async (req, res) => {
    const tenantId = req.ctx!.tenantId;
    const jobId = jobs ? await jobs.enqueue({ tenantId }) : undefined;
    if (jobId) {
      res.json({ data: { ok: true, queued: true, jobId } });
      return;
    }
    const result = await service.scan(tenantId);
    res.json({ data: result });
  });

  router.get("/overview", async (req, res) => {
    res.json({ data: await service.overview(req.ctx!.tenantId) });
  });

  router.get("/flags", async (req, res) => {
    const tenantId = req.ctx!.tenantId;
    const { page, limit } = parsePagination(req);
    const status = typeof req.query.status === "string" && FRAUD_FLAG_STATUSES.includes(req.query.status as FraudFlagStatus)
      ? (req.query.status as FraudFlagStatus)
      : undefined;
    const { data, total } = await service.listFlags(tenantId, { status, page, limit });
    res.json({ data, meta: { page, limit, total } });
  });

  router.post("/flags/:id/resolve", requireRoles("owner"), validateBody(fraudResolveSchema), async (req, res) => {
    const ctx = req.ctx!;
    const flag = await service.resolveFlag(ctx.tenantId, String(req.params.id), req.body.status, ctx.userId, req.body.notes ?? null);
    await writeAuditLog(db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: `fraud.${req.body.status}`,
      resourceType: "fraud_flag",
      resourceId: flag.id,
      after: { orderId: flag.orderId, notes: req.body.notes ?? null },
    });
    res.json({ data: flag });
  });

  router.get("/flags/:id", async (req, res) => {
    res.json({ data: await service.flagDetail(req.ctx!.tenantId, String(req.params.id)) });
  });

  return router;
}