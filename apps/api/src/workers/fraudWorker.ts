import { Worker } from "bullmq";
import type Redis from "ioredis";
import type { DbPool } from "@beautyai/db";
import { createFraudService } from "../modules/fraud/index.js";
import { FRAUD_QUEUE, type FraudScanJob } from "../jobs/fraudQueue.js";

export interface FraudWorkerDeps {
  db: DbPool;
  connection: Redis;
}

export interface FraudWorkerHandle {
  close(): Promise<void>;
}

/**
 * Consumes async fraud-scan jobs and evaluates order-fraud rules, inserting
 * new flags into the review queue.
 */
export function startFraudWorker(deps: FraudWorkerDeps): FraudWorkerHandle {
  const service = createFraudService({ db: deps.db });

  const worker = new Worker(
    FRAUD_QUEUE,
    async (job) => {
      const { tenantId } = job.data as FraudScanJob;
      const result = await service.scan(tenantId);
      return { scannedOrders: result.scannedOrders, flagsCreated: result.flagsCreated };
    },
    { connection: deps.connection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[fraud-worker] job ${job?.id} failed: ${err.message}`);
  });

  return {
    async close(): Promise<void> {
      await worker.close();
    },
  };
}