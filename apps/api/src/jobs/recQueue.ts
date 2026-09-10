import { Queue } from "bullmq";
import Redis from "ioredis";
import type { AppConfig } from "../config/env.js";

export const REC_QUEUE = "rec-refresh";

export interface RecRefreshJob {
  tenantId: string;
}

export interface RecJobClient {
  enqueue(job: RecRefreshJob): Promise<string>;
  close(): Promise<void>;
}

/**
 * Queued recommendation recompute. Returns null without REDIS_URL so the
 * admin "refresh" endpoint degrades to a synchronous run (shared pattern with
 * content generation and analytics syncs).
 */
export function createRecJobClient(config: AppConfig): RecJobClient | null {
  if (!config.REDIS_URL) return null;
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  const queue = new Queue(REC_QUEUE, { connection });
  return {
    async enqueue(job: RecRefreshJob): Promise<string> {
      const created = await queue.add(REC_QUEUE, job, { attempts: 3, backoff: { type: "exponential", delay: 4_000 } });
      return created.id ?? "";
    },
    close(): Promise<void> {
      return queue.close();
    },
  };
}