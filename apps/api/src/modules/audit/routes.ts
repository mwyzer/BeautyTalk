import { Router } from "express";
import type { DbPool } from "@beautyai/db";
import { createAuditSchema } from "@beautyai/shared";
import { validateBody } from "../../middleware/validate.js";
import type { AuditService } from "./service.js";
import type { AuditJobClient } from "../../jobs/crawlQueue.js";

interface AdminAuditDeps {
  db: DbPool;
  service: AuditService;
  jobs?: AuditJobClient | null;
}

export function createAdminAuditRouter(deps: AdminAuditDeps): Router {
  const router = Router();
  const { service } = deps;

  // ===== Audits =====

  router.post("/audits", validateBody(createAuditSchema), async (req, res) => {
    const ctx = req.ctx!;
    if (deps.jobs) {
      const audit = await service.queueAudit({ tenantId: ctx.tenantId, userId: ctx.userId, body: req.body });
      await deps.jobs.enqueue({ tenantId: ctx.tenantId, auditId: audit.id });
      res.status(202).json({ data: audit, queued: true });
      return;
    }
    const audit = await service.startAudit({ tenantId: ctx.tenantId, userId: ctx.userId, body: req.body });
    res.status(202).json({ data: audit });
  });

  router.get("/audits", async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const result = await service.listAudits(req.ctx!.tenantId, page, limit);
    res.json({ data: result.data, meta: { page, limit, total: result.total } });
  });

  router.get("/audits/:id", async (req, res) => {
    const result = await service.getAudit(req.ctx!.tenantId, String(req.params.id));
    res.json({ data: result });
  });

  router.get("/audits/:id/issues", async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const severity = typeof req.query.severity === "string" ? req.query.severity : undefined;
    const result = await service.listIssues(req.ctx!.tenantId, String(req.params.id), { page, limit, status, severity });
    res.json({ data: result.data, meta: { page, limit, total: result.total } });
  });

  router.get("/audits/:id/urls", async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const result = await service.listCrawlUrls(req.ctx!.tenantId, String(req.params.id), page, limit);
    res.json({ data: result.data, meta: { page, limit, total: result.total } });
  });

  // ===== Issues / fix queue =====

  router.post("/audits/:auditId/issues/:issueId/fix", async (req, res) => {
    const issue = await service.fixIssue({
      tenantId: req.ctx!.tenantId,
      auditId: String(req.params.auditId),
      issueId: String(req.params.issueId),
      userId: req.ctx!.userId,
    });
    res.json({ data: issue });
  });

  router.post("/audits/:auditId/issues/:issueId/dismiss", async (req, res) => {
    const issue = await service.dismissIssue({
      tenantId: req.ctx!.tenantId,
      auditId: String(req.params.auditId),
      issueId: String(req.params.issueId),
      userId: req.ctx!.userId,
    });
    res.json({ data: issue });
  });

  // ===== Scores =====

  router.get("/score", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 30), 100);
    const latest = await service.latestScore(req.ctx!.tenantId);
    const history = await service.scoreHistory(req.ctx!.tenantId, limit);
    res.json({ data: { latest, history } });
  });

  return router;
}