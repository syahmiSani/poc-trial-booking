import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every test file resets the same database, so files must not overlap.
    // Within a file, tests already run sequentially.
    fileParallelism: false,
    // The concurrency tests hold transactions open on purpose.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
  },
});
