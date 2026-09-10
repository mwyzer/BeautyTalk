import { Worker } from "bullmq";
import type Redis from "ioredis";
import type { DbPool } from "@beautyai/db";
import { createAuditService } from "../modules/audit/index.js";
import { AUDIT_QUEUE, type AuditJob } from "../jobs/crawlQueue.js";

export interface AuditWorkerDeps {
  db: DbPool;
  connection: Redis;
  storefrontUrl: string;
}

export interface AuditWorkerHandle {
  close(): Promise<void>;
}

/**
 * Consumes async SEO audit crawl jobs. Shares the exact service used by
 * the HTTP layer, so crawl, issue detection, scoring, and completion behave
 * identically whether the audit runs synchronously or through the queue.
 */
export function startAuditWorker(deps: AuditWorkerDeps): AuditWorkerHandle {
  const service = createAuditService({ db: deps.db, storefrontUrl: deps.storefrontUrl });

  const worker = new Worker(
    AUDIT_QUEUE,
    async (job) => {
      const data = job.data as AuditJob;
      const audit = await service.runAudit(data.tenantId, data.auditId);
      return { auditId: audit.id, status: audit.status, totalUrls: audit.totalUrls };
    },
    { connection: deps.connection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[audit-worker] job ${job?.id} failed: ${err.message}`);
  });

  return {
    async close(): Promise<void> {
      await worker.close();
    },
  };
}