import "dotenv/config";
import Redis from "ioredis";
import { createPool } from "@beautyai/db";
import { createApp } from "./app.js";
import { createConfig } from "./config/env.js";
import { createContentProvider } from "./modules/content/index.js";
import { createContentJobClient } from "./jobs/contentQueue.js";
import { startContentWorker, type ContentWorkerHandle } from "./workers/contentWorker.js";

const config = createConfig();
const db = createPool({ connectionString: config.DATABASE_URL });

const provider = createContentProvider(config);
const jobs = createContentJobClient(config);

const app = createApp({ db, config, contentProvider: provider, jobs });

let worker: ContentWorkerHandle | undefined;
let workerConnection: Redis | undefined;
if (provider && config.REDIS_URL) {
  workerConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  worker = startContentWorker({ db, provider, connection: workerConnection });
  console.log("Content generation worker started (async queue).");
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
    if (jobs) await jobs.close();
    await db.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));