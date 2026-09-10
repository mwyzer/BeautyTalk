import { Worker } from "bullmq";
import type Redis from "ioredis";
import type { DbPool } from "@beautyai/db";
import type { AnalyticsFetcher } from "../analytics/types.js";
import type { AnalyticsConfig } from "../modules/analytics/service.js";
import { createAnalyticsService } from "../modules/analytics/index.js";
import { ANALYTICS_QUEUE, type AnalyticsSyncJob } from "../jobs/analyticsQueue.js";

export interface AnalyticsWorkerDeps {
  db: DbPool;
  fetcher: AnalyticsFetcher;
  config: AnalyticsConfig;
  connection: Redis;
}

export interface AnalyticsWorkerHandle {
  close(): Promise<void>;
}

/**
 * Consumes async analytics sync jobs. Shares the exact service used by the
 * HTTP layer so token refresh, incremental windows, and row upserts behave
 * identically whether syncing runs synchronously or through the queue.
 */
export function startAnalyticsWorker(deps: AnalyticsWorkerDeps): AnalyticsWorkerHandle {
  const service = createAnalyticsService({ db: deps.db, fetcher: deps.fetcher, config: deps.config });

  const worker = new Worker(
    ANALYTICS_QUEUE,
    async (job) => {
      const data = job.data as AnalyticsSyncJob;
      const { sync, recordsProcessed } = await service.runSync(data.tenantId, {
        provider: data.provider,
        startDate: data.startDate,
        endDate: data.endDate,
      });
      return { status: sync.status, recordsProcessed };
    },
    { connection: deps.connection, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[analytics-worker] job ${job?.id} failed: ${err.message}`);
  });

  return {
    async close(): Promise<void> {
      await worker.close();
    },
  };
}