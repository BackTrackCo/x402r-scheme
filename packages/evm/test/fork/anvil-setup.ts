/**
 * Vitest globalSetup: spawn an anvil instance forked from Base Sepolia.
 *
 * Exposes the running RPC URL to tests via process.env.ANVIL_RPC_URL.
 * Tears anvil down after the suite. If BASE_SEPOLIA_RPC_URL is not set,
 * the setup aborts cleanly with a hint — fork tests are opt-in.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

let anvil: ChildProcess | null = null

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

export async function setup(): Promise<void> {
  if (!FORK_RPC) {
    throw new Error(
      'fork tests require BASE_SEPOLIA_RPC_URL — set it to a working Base Sepolia RPC and re-run',
    )
  }

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

  anvil.once('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`anvil exited unexpectedly with code ${code}`)
    }
  })

  const rpcUrl = `http://127.0.0.1:${PORT}`
  await waitForAnvilReady(rpcUrl)
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
