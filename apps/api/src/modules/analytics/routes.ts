import { Router } from "express";
import { analyticsConnectSchema, analyticsReportQuerySchema, analyticsSyncSchema, ANALYTICS_PROVIDERS } from "@beautyai/shared";
import { validateBody } from "../../middleware/validate.js";
import { ApiError } from "../../lib/http.js";
import type { AnalyticsService } from "./service.js";
import type { AnalyticsJobClient } from "../../jobs/analyticsQueue.js";

interface AnalyticsDeps {
  service: AnalyticsService;
  jobs?: AnalyticsJobClient | null;
}

export function createAdminAnalyticsRouter(deps: AnalyticsDeps): Router {
  const router = Router();
  const { service, jobs } = deps;

  // ===== OAuth =====

  router.get("/oauth/:provider", async (req, res) => {
    const provider = String(req.params.provider);
    if (!ANALYTICS_PROVIDERS.includes(provider as (typeof ANALYTICS_PROVIDERS)[number])) {
      throw ApiError.badRequest(`Unknown provider: ${provider}`);
    }
    const { url, configured } = service.oauthStart(provider as (typeof ANALYTICS_PROVIDERS)[number]);
    res.json({ data: { provider, url, configured } });
  });

  // ===== Connections =====

  router.post("/connections", validateBody(analyticsConnectSchema), async (req, res) => {
    const connection = await service.connect(req.ctx!.tenantId, req.body);
    res.json({ data: connection });
  });

  router.get("/connections", async (req, res) => {
    res.json({ data: await service.listConnections(req.ctx!.tenantId) });
  });

  router.delete("/connections/:provider", async (req, res) => {
    const provider = String(req.params.provider);
    if (!ANALYTICS_PROVIDERS.includes(provider as (typeof ANALYTICS_PROVIDERS)[number])) {
      throw ApiError.badRequest(`Unknown provider: ${provider}`);
    }
    await service.disconnect(req.ctx!.tenantId, provider as (typeof ANALYTICS_PROVIDERS)[number]);
    res.json({ data: { ok: true } });
  });

  // ===== Syncs =====

  router.post("/syncs", validateBody(analyticsSyncSchema), async (req, res) => {
    const ctx = req.ctx!;
    const providers = req.body.providers ?? [...ANALYTICS_PROVIDERS];
    const params = { startDate: req.body.startDate, endDate: req.body.endDate };
    const results = [];
    for (const provider of providers) {
      const jobId = jobs ? await jobs.enqueue({ tenantId: ctx.tenantId, provider, ...params }) : undefined;
      if (jobId) {
        results.push({ provider, queued: true, jobId });
        continue;
      }
      const { sync, recordsProcessed } = await service.runSync(ctx.tenantId, { provider, ...params });
      results.push({ provider, queued: false, sync, recordsProcessed });
    }
    res.json({ data: { results } });
  });

  router.get("/syncs", async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 25);
    const { data, total } = await service.listSyncs(req.ctx!.tenantId, Number.isFinite(page) ? page : 1, Number.isFinite(limit) ? limit : 25);
    res.json({ data, meta: { page, limit, total } });
  });

  // ===== Reports =====

  const reportRange = (req: { query: Record<string, unknown> }) => {
    const parsed = analyticsReportQuerySchema.safeParse({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) errors[issue.path.join(".")] = issue.message;
      throw ApiError.validation("Invalid report date range", errors);
    }
    return parsed.data;
  };

  router.get("/reports/gsc", async (req, res) => {
    res.json({ data: { rows: await service.gscReport(req.ctx!.tenantId, reportRange(req)) } });
  });

  router.get("/reports/ga4", async (req, res) => {
    res.json({ data: { rows: await service.ga4Traffic(req.ctx!.tenantId, reportRange(req)) } });
  });

  router.get("/reports/ads", async (req, res) => {
    res.json({ data: { rows: await service.adsCampaigns(req.ctx!.tenantId, reportRange(req)) } });
  });

  router.get("/overview", async (req, res) => {
    res.json({ data: await service.overview(req.ctx!.tenantId, reportRange(req)) });
  });

  return router;
}