import { Queue } from "bullmq";
import Redis from "ioredis";
import type { AnalyticsProvider } from "@beautyai/shared";
import type { AppConfig } from "../config/env.js";

export const ANALYTICS_QUEUE = "analytics-sync";

export interface AnalyticsSyncJob {
  tenantId: string;
  provider: AnalyticsProvider;
  startDate?: string;
  endDate?: string;
}

export interface AnalyticsJobClient {
  enqueue(job: AnalyticsSyncJob): Promise<string>;
  close(): Promise<void>;
}

/**
 * Creates a BullMQ-backed job client for async analytics syncs.
 * Returns null when REDIS_URL is absent so the API degrades to the
 * synchronous sync path (mirrors the content-generation pattern).
 */
export function createAnalyticsJobClient(config: AppConfig): AnalyticsJobClient | null {
  if (!config.REDIS_URL) return null;
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  const queue = new Queue(ANALYTICS_QUEUE, { connection });
  return {
    async enqueue(job: AnalyticsSyncJob): Promise<string> {
      const created = await queue.add(ANALYTICS_QUEUE, job, { attempts: 3, backoff: { type: "exponential", delay: 4_000 } });
      return created.id ?? "";
    },
    close(): Promise<void> {
      return queue.close();
    },
  };
}