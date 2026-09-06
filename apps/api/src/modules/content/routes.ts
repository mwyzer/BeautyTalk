import { Router } from "express";
import type { DbPool } from "@beautyai/db";
import { brandToneUpdateSchema, contentGenerateSchema, draftUpdateSchema } from "@beautyai/shared";
import { validateBody } from "../../middleware/validate.js";
import { ApiError } from "../../lib/http.js";
import type { ContentService } from "./service.js";
import type { ContentJobClient } from "../../jobs/contentQueue.js";

interface AdminContentDeps {
  db: DbPool;
  service: ContentService;
  jobs?: ContentJobClient | null;
}

export function createAdminContentRouter(deps: AdminContentDeps): Router {
  const router = Router();
  const service = deps.service;

  // ===== Brand tone =====

  router.get("/brand-tone", async (req, res) => {
    const tone = await service.getTone(req.ctx!.tenantId);
    res.json({ data: tone });
  });

  router.put("/brand-tone", validateBody(brandToneUpdateSchema), async (req, res) => {
    const tone = await service.upsertTone(req.ctx!.tenantId, req.body);
    res.json({ data: tone });
  });

  // ===== Credits / quotas =====

  router.get("/credits", async (req, res) => {
    res.json({ data: await service.getCredits(req.ctx!.tenantId) });
  });

  // ===== Generation =====

  router.post("/generate", validateBody(contentGenerateSchema), async (req, res) => {
    const ctx = req.ctx!;
    if (!service.canGenerate()) throw ApiError.serviceUnavailable("Content generation is not configured (OPENAI_API_KEY missing)");
    const jobId = deps.jobs ? await deps.jobs.enqueue({ tenantId: ctx.tenantId, userId: ctx.userId, body: req.body }) : undefined;
    if (jobId) {
      res.status(202).json({ data: { queued: true, jobId } });
      return;
    }
    const result = await service.generate({ tenantId: ctx.tenantId, userId: ctx.userId, body: req.body });
    res.json({ data: result });
  });

  // ===== Drafts =====

  router.get("/drafts", async (req, res) => {
    const tenantId = req.ctx!.tenantId;
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 25);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const { data, total } = await service.listDrafts({ tenantId, status, type, page, limit });
    res.json({ data, meta: { page, limit, total } });
  });

  router.get("/drafts/:id", async (req, res) => {
    const draft = await service.getDraft(req.ctx!.tenantId, String(req.params.id));
    res.json({ data: draft });
  });

  router.patch("/drafts/:id", validateBody(draftUpdateSchema), async (req, res) => {
    const draft = await service.editDraft({
      tenantId: req.ctx!.tenantId,
      id: String(req.params.id),
      patch: req.body,
      userId: req.ctx!.userId,
    });
    res.json({ data: draft });
  });

  router.post("/drafts/:id/approve", async (req, res) => {
    const draft = await service.approveDraft(req.ctx!.tenantId, String(req.params.id));
    res.json({ data: draft });
  });

  router.post("/drafts/:id/reject", async (req, res) => {
    const draft = await service.rejectDraft(req.ctx!.tenantId, String(req.params.id));
    res.json({ data: draft });
  });

  router.post("/drafts/:id/publish", async (req, res) => {
    const draft = await service.publishDraft({
      tenantId: req.ctx!.tenantId,
      id: String(req.params.id),
      userId: req.ctx!.userId,
    });
    res.json({ data: draft });
  });

  router.get("/drafts/:id/versions", async (req, res) => {
    const versions = await service.listVersions(req.ctx!.tenantId, String(req.params.id));
    res.json({ data: versions });
  });

  router.post("/drafts/:id/versions/:version/restore", async (req, res) => {
    const draft = await service.restoreVersion(req.ctx!.tenantId, String(req.params.id), Number(req.params.version));
    res.json({ data: draft });
  });

  return router;
}