import "dotenv/config";
import { createPool } from "@beautyai/db";
import { createApp } from "./app.js";
import { createConfig } from "./config/env.js";

const config = createConfig();
const db = createPool({ connectionString: config.DATABASE_URL });

const app = createApp({ db, config });

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
    await db.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));