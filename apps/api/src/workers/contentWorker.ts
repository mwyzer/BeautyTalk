import { Worker } from "bullmq";
import type Redis from "ioredis";
import type { DbPool } from "@beautyai/db";
import type { ContentProvider } from "../content/types.js";
import { createContentService } from "../modules/content/index.js";
import { CONTENT_QUEUE, type ContentGenerateJob } from "../jobs/contentQueue.js";
import { contentGenerateSchema } from "@beautyai/shared";
import { ApiError } from "../lib/http.js";

export interface ContentWorkerDeps {
  db: DbPool;
  provider: ContentProvider;
  connection: Redis;
}

export interface ContentWorkerHandle {
  close(): Promise<void>;
}

/**
 * Consumes async content generation jobs. Shares the exact service used by
 * the HTTP layer, so credits, caching, and draft lifecycle behave identically
 * whether generation runs synchronously or through the queue.
 */
export function startContentWorker(deps: ContentWorkerDeps): ContentWorkerHandle {
  const service = createContentService({ db: deps.db, provider: deps.provider });

  const worker = new Worker(
    CONTENT_QUEUE,
    async (job) => {
      const data = job.data as ContentGenerateJob;
      const parsed = contentGenerateSchema.safeParse(data.body);
      if (!parsed.success) throw ApiError.badRequest("Invalid queued generation payload");
      const result = await service.generate({
        tenantId: data.tenantId,
        userId: data.userId,
        body: parsed.data,
      });
      return { drafts: result.drafts.length, cached: result.cached };
    },
    { connection: deps.connection, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[content-worker] job ${job?.id} failed: ${err.message}`);
  });

  return {
    async close(): Promise<void> {
      await worker.close();
    },
  };
}