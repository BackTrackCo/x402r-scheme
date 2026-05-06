/**
 * Vitest globalSetup: spawn an anvil instance forked from Base Sepolia.
 *
 * Exposes the running RPC URL to tests via process.env.ANVIL_RPC_URL.
 * Tears anvil down after the suite.
 *
 * If BASE_SEPOLIA_RPC_URL is not set, setup logs a warning and returns
 * without spawning. The per-test guards (`if (!process.env.ANVIL_RPC_URL)`)
 * then `it.skip` cleanly so opt-in CI without the secret stays green
 * instead of red-with-throw.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

let anvil: ChildProcess | null = null
let signalHandlersRegistered = false

const ANVIL_BIN = process.env.ANVIL_BIN || 'anvil'
const FORK_RPC = process.env.BASE_SEPOLIA_RPC_URL
const PORT = 8545

async function waitForAnvilReady(rpcUrl: string, attempts = 40, delayMs = 250): Promise<void> {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) })
  for (let i = 0; i < attempts; i += 1) {
    try {
      await client.getChainId()
      return
    } catch {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw new Error(`anvil at ${rpcUrl} did not become ready after ${attempts * delayMs}ms`)
}

function killAnvil(): void {
  if (!anvil || anvil.killed) return
  anvil.kill('SIGTERM')
}

function registerSignalHandlers(): void {
  if (signalHandlersRegistered) return
  signalHandlersRegistered = true
  const cleanup = (signal: NodeJS.Signals) => {
    killAnvil()
    // Re-raise so the parent process exits with the conventional code
    process.kill(process.pid, signal)
  }
  process.once('SIGINT', cleanup)
  process.once('SIGTERM', cleanup)
  // Best-effort cleanup on uncaught throw paths
  process.once('exit', killAnvil)
}

export async function setup(): Promise<void> {
  if (!FORK_RPC) {
    console.warn(
      '[fork-test] BASE_SEPOLIA_RPC_URL not set — anvil will not be spawned and fork tests will skip cleanly. Set it to a Base Sepolia RPC URL to actually run them.',
    )
    return
  }

  // Surface ENOENT (anvil not on PATH) immediately instead of waiting 10s for
  // the RPC ready-check to time out.
  let spawnError: Error | null = null
  anvil = spawn(
    ANVIL_BIN,
    [
      '--fork-url',
      FORK_RPC,
      '--port',
      String(PORT),
      '--silent',
      '--accounts',
      '0',
      // Pin block to keep tests deterministic; fall back to latest if unset.
      ...(process.env.BASE_SEPOLIA_FORK_BLOCK
        ? ['--fork-block-number', process.env.BASE_SEPOLIA_FORK_BLOCK]
        : []),
    ],
    { stdio: process.env.ANVIL_VERBOSE ? 'inherit' : 'ignore' },
  )

  anvil.once('error', (err: NodeJS.ErrnoException) => {
    spawnError = err
    if (err.code === 'ENOENT') {
      console.error(
        `[fork-test] failed to spawn anvil: '${ANVIL_BIN}' not found on PATH. Install Foundry (https://getfoundry.sh) or set ANVIL_BIN to the absolute path.`,
      )
    } else {
      console.error(`[fork-test] failed to spawn anvil: ${err.message}`)
    }
  })

  anvil.once('exit', (code) => {
    if (code !== null && code !== 0 && !spawnError) {
      console.error(`anvil exited unexpectedly with code ${code}`)
    }
  })

  registerSignalHandlers()

  // Race the wait-loop with the spawn-error path so ENOENT short-circuits.
  const rpcUrl = `http://127.0.0.1:${PORT}`
  await Promise.race([
    waitForAnvilReady(rpcUrl),
    new Promise<never>((_, reject) => {
      const tick = setInterval(() => {
        if (spawnError) {
          clearInterval(tick)
          reject(spawnError)
        }
      }, 50)
    }),
  ])
  process.env.ANVIL_RPC_URL = rpcUrl
}

export async function teardown(): Promise<void> {
  if (anvil && !anvil.killed) {
    anvil.kill('SIGTERM')
    // Give it a moment, then force-kill if still alive.
    await new Promise((r) => setTimeout(r, 250))
    if (!anvil.killed) anvil.kill('SIGKILL')
  }
  anvil = null
}
