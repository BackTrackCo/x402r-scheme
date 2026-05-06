import { defineConfig } from 'vitest/config'

// Fork-test config: opt-in via `pnpm test:fork`. Spawns a local anvil instance
// forked from Base Sepolia, then runs happy-path settle scenarios against
// canonical AuthCaptureEscrow + token-collector deploys. Catches mistakes that
// pure mocks miss (e.g., the charge ABI 6-arg arity bug from PR #40 review).
//
// Required env: BASE_SEPOLIA_RPC_URL (any working Base Sepolia RPC).
// Optional env: ANVIL_BIN (defaults to 'anvil' on PATH).
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/fork/**/*.test.ts'],
    globalSetup: ['./test/fork/anvil-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
