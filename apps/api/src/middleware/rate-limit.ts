import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/http.js";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function sweep(now: number): void {
  if (buckets.size < 10_000) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
}

export function rateLimit(opts: RateLimitOptions) {
  const { windowMs, max, keyGenerator } = opts;
  const keyFor = keyGenerator ?? ((req: Request) => req.ip ?? "unknown");
  return (req: Request, res: Response, next: NextFunction): void => {
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }
    const now = Date.now();
    sweep(now);
    const key = keyFor(req);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      next(ApiError.rateLimited("Too many requests, please slow down"));
      return;
    }
    res.setHeader("X-RateLimit-Remaining", String(max - bucket.count));
    next();
  };
}