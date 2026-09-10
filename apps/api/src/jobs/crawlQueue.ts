import { Queue } from "bullmq";
import Redis from "ioredis";
import type { AppConfig } from "../config/env.js";

export const AUDIT_QUEUE = "seo-audit";

export interface AuditJob {
  tenantId: string;
  auditId: string;
}

export interface AuditJobClient {
  enqueue(job: AuditJob): Promise<string>;
  close(): Promise<void>;
}

/**
 * Creates a BullMQ-backed job client for async SEO audit crawls.
 * Returns null when REDIS_URL is absent so the API degrades to the
 * synchronous path (mirrors the content-queue pattern).
 */
export function createAuditJobClient(config: AppConfig): AuditJobClient | null {
  if (!config.REDIS_URL) return null;
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  const queue = new Queue(AUDIT_QUEUE, { connection });
  return {
    async enqueue(job: AuditJob): Promise<string> {
      const created = await queue.add(AUDIT_QUEUE, job, { attempts: 3, backoff: { type: "exponential", delay: 4_000 } });
      return created.id ?? "";
    },
    close(): Promise<void> {
      return queue.close();
    },
  };
}