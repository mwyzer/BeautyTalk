import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@beautyai/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      "@beautyai/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    restoreMocks: true,
  },
});