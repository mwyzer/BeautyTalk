import { Worker } from "bullmq";
import type Redis from "ioredis";
import type { DbPool } from "@beautyai/db";
import { createRecommendationService } from "../modules/recommendations/index.js";
import { REC_QUEUE, type RecRefreshJob } from "../jobs/recQueue.js";

export interface RecWorkerDeps {
  db: DbPool;
  connection: Redis;
}

export interface RecWorkerHandle {
  close(): Promise<void>;
}

/**
 * Consumes async rec-refresh jobs and recomputes popularity, co-purchase, and
 * related-product scores into the precomputed product_recommendations table.
 */
export function startRecWorker(deps: RecWorkerDeps): RecWorkerHandle {
  const service = createRecommendationService({ db: deps.db });

  const worker = new Worker(
    REC_QUEUE,
    async (job) => {
      const { tenantId } = job.data as RecRefreshJob;
      const result = await service.refresh(tenantId);
      return { counts: result.counts, generatedAt: result.generatedAt };
    },
    { connection: deps.connection, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[rec-worker] job ${job?.id} failed: ${err.message}`);
  });

  return {
    async close(): Promise<void> {
      await worker.close();
    },
  };
}