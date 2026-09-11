import { Queue } from "bullmq";
import Redis from "ioredis";
import type { AppConfig } from "../config/env.js";

export const FRAUD_QUEUE = "fraud-scan";

export interface FraudScanJob {
  tenantId: string;
}

export interface FraudJobClient {
  enqueue(job: FraudScanJob): Promise<string>;
  close(): Promise<void>;
}

/**
 * Queued fraud scan. Returns null without REDIS_URL so the admin "scan"
 * endpoint degrades to a synchronous run (shared pattern with content,
 * analytics, and recommendation jobs).
 */
export function createFraudJobClient(config: AppConfig): FraudJobClient | null {
  if (!config.REDIS_URL) return null;
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  const queue = new Queue(FRAUD_QUEUE, { connection });
  return {
    async enqueue(job: FraudScanJob): Promise<string> {
      const created = await queue.add(FRAUD_QUEUE, job, { attempts: 3, backoff: { type: "exponential", delay: 4_000 } });
      return created.id ?? "";
    },
    close(): Promise<void> {
      return queue.close();
    },
  };
}