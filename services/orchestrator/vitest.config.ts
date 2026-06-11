import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
  test: {
    // Node by default (DB/server tests); component tests (*.test.tsx) get jsdom.
    environment: "node",
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    // Integration tests hit a DB and run destructive deleteMany, so:
    //  - db/client.ts routes test runs to MONGODB_TEST_URI / a local test DB
    //    (NEVER the shared Atlas cluster — see client.ts), and
    //  - files run serially to avoid cross-talk on the shared test DB.
    // Run `docker compose -f docker-compose.orchestrator.yml up -d mongo` first,
    // or set MONGODB_TEST_URI to a throwaway DB.
    fileParallelism: false,
  },
});
