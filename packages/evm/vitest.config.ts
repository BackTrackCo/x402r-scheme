import { defineConfig } from 'vitest/config'

// Default config: unit tests only. Fork tests live under test/fork and run
// against a local anvil instance forked from Base Sepolia — slow + need
// network access, so they're opt-in via `pnpm test:fork` (vitest.fork.config.ts).
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
