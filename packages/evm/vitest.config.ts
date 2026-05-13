import { defineConfig } from "vitest/config";

// Default config: unit tests only. Integration tests live under
// test/integrations and run against a local anvil instance forked from Base
// Sepolia. They're slow + need network access, so they're opt-in via
// `pnpm test:integration` (vitest.integration.config.ts).
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
