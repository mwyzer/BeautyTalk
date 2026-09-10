import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 chars"),
    JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 chars"),
    JWT_ACCESS_TTL: z.string().default("15m"),
    JWT_REFRESH_TTL: z.string().default("30d"),
    REDIS_URL: z.string().url().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_API_VERSION: z.string().optional(),
    CHECKOUT_SUCCESS_URL: z.string().url().optional(),
    CHECKOUT_CANCEL_URL: z.string().url().optional(),
    STOREFRONT_URL: z.string().url().optional(),
    CRAWL_POLITENESS_MS: z.coerce.number().int().min(0).max(10_000).default(250),
    CRAWL_MAX_DEPTH: z.coerce.number().int().min(1).max(10).default(3),
    CRAWL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(8_000),
    CRAWL_LINK_BUDGET: z.coerce.number().int().min(0).max(10_000).default(200),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().url().optional(),
    OPENAI_MODEL_FAST: z.string().default("gpt-4o-mini"),
    OPENAI_MODEL_FULL: z.string().default("gpt-4o"),
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().url().optional(),
    GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
    ANALYTICS_TOKEN_KEY: z.string().min(16, "ANALYTICS_TOKEN_KEY must be at least 16 chars").optional(),
  });

export type AppConfig = z.infer<typeof envSchema>;

export function createConfig(overrides: Record<string, string> = {}): AppConfig {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}