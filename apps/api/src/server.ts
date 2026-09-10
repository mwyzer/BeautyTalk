import "dotenv/config";
import Redis from "ioredis";
import { createPool } from "@beautyai/db";
import { createApp } from "./app.js";
import { createConfig } from "./config/env.js";
import { createContentProvider } from "./modules/content/index.js";
import { createGoogleAnalyticsFetcher } from "./modules/analytics/index.js";
import { createContentJobClient } from "./jobs/contentQueue.js";
import { createAuditJobClient } from "./jobs/crawlQueue.js";
import { createAnalyticsJobClient } from "./jobs/analyticsQueue.js";
import { createRecJobClient } from "./jobs/recQueue.js";
import { startContentWorker, type ContentWorkerHandle } from "./workers/contentWorker.js";
import { startAuditWorker, type AuditWorkerHandle } from "./workers/crawlWorker.js";
import { startAnalyticsWorker, type AnalyticsWorkerHandle } from "./workers/analyticsWorker.js";
import { startRecWorker, type RecWorkerHandle } from "./workers/recWorker.js";

const config = createConfig();
const db = createPool({ connectionString: config.DATABASE_URL });

const provider = createContentProvider(config);
const jobs = createContentJobClient(config);
const auditJobs = createAuditJobClient(config);
const analyticsFetcher = createGoogleAnalyticsFetcher({
  clientId: config.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
  redirectUri: config.GOOGLE_REDIRECT_URI ?? `${config.STOREFRONT_URL ?? "http://localhost:4321"}/admin/analytics`,
  adsDeveloperToken: config.GOOGLE_ADS_DEVELOPER_TOKEN,
});
const analyticsJobs = createAnalyticsJobClient(config);
const recJobs = createRecJobClient(config);

const app = createApp({ db, config, contentProvider: provider, jobs, auditJobs, analyticsFetcher, analyticsJobs, recJobs });

let worker: ContentWorkerHandle | undefined;
let auditWorker: AuditWorkerHandle | undefined;
let workerConnection: Redis | undefined;
if (provider && config.REDIS_URL) {
  workerConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  worker = startContentWorker({ db, provider, connection: workerConnection });
  console.log("Content generation worker started (async queue).");
}
let auditConnection: Redis | undefined;
if (config.REDIS_URL) {
  auditConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  auditWorker = startAuditWorker({
    db,
    connection: auditConnection,
    storefrontUrl: config.STOREFRONT_URL ?? "http://localhost:4321",
  });
  console.log("SEO audit worker started (async queue).");
}
let analyticsWorker: AnalyticsWorkerHandle | undefined;
let analyticsConnection: Redis | undefined;
if (config.REDIS_URL) {
  analyticsConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  analyticsWorker = startAnalyticsWorker({
    db,
    fetcher: analyticsFetcher,
    config,
    connection: analyticsConnection,
  });
  console.log("Analytics sync worker started (async queue).");
}
let recWorker: RecWorkerHandle | undefined;
let recConnection: Redis | undefined;
if (config.REDIS_URL) {
  recConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  recWorker = startRecWorker({ db, connection: recConnection });
  console.log("Recommendation refresh worker started (async queue).");
}

const server = app.listen(config.PORT, () => {
  console.log(`BeautyAI API listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
  console.log("Run `npm run db:migrate` before first use if the schema is not yet applied.");
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down`);
  server.close(async () => {
    if (worker) {
      await worker.close();
      await workerConnection?.quit();
    }
    if (auditWorker) {
      await auditWorker.close();
      await auditConnection?.quit();
    }
    if (analyticsWorker) {
      await analyticsWorker.close();
      await analyticsConnection?.quit();
    }
    if (recWorker) {
      await recWorker.close();
      await recConnection?.quit();
    }
    if (jobs) await jobs.close();
    if (auditJobs) await auditJobs.close();
    if (analyticsJobs) await analyticsJobs.close();
    if (recJobs) await recJobs.close();
    await db.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));