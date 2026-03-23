/* eslint-disable no-undef */
import { keccak256, toBytes } from 'viem'
import type { ResourceServerExtension } from '@x402/core/types'
import { ATTESTATION_KEY } from './types.js'

interface SettleResultContextWithTransport {
  result: { success: boolean; transaction: string; network: string }
  transportContext?: { responseBody?: Buffer }
}

/**
 * Create the attestation extension for a resource server.
 *
 * Generic pass-through for third-party attestations. The extension
 * doesn't define what gets signed — the attestor decides.
 *
 * - Pre-payment (402): fetches attestor's identity/config from GET endpoint
 * - Post-payment (200): forwards response body to attestor, includes response
 *
 * Works with any scheme (escrow, exact, etc.).
 *
 * @param attestorUrl - Base URL of the attestor service
 */
export function createAttestationExtension(attestorUrl: string): ResourceServerExtension {
  return {
    key: ATTESTATION_KEY,

    // Pre-payment: include attestor data in 402
    enrichPaymentRequiredResponse: async () => {
      try {
        const res = await fetch(`${attestorUrl}/attest/identity`)
        if (!res.ok) return undefined
        const data = await res.json()
        return { info: { identity: data } }
      } catch {
        return undefined
      }
    },

    // Post-payment: forward content to attestor, include response in 200
    enrichSettlementResponse: async (_declaration: unknown, rawContext: unknown) => {
      const context = rawContext as SettleResultContextWithTransport
      if (!context.result.success) return undefined

      const responseBody = context.transportContext?.responseBody
      if (!responseBody) return undefined

      const contentHash = keccak256(toBytes(responseBody.toString('utf-8')))

      try {
        const res = await fetch(`${attestorUrl}/attest/settle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction: context.result.transaction,
            network: context.result.network,
            contentHash,
            responseBody: responseBody.toString('utf-8'),
          }),
        })
        if (!res.ok) return undefined
        const data = await res.json()
        return { info: { settlement: data } }
      } catch {
        return undefined
      }
    },
  }
}

/**
 * Declare the attestation extension on a route.
 * Only routes with this declaration will include attestation data.
 */
export function declareAttestationExtension(): Record<string, Record<string, never>> {
  return { [ATTESTATION_KEY]: {} }
}
