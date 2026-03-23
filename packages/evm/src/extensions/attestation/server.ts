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
 * Adds third-party attestation to x402 payment flows:
 * - Pre-payment (402): fetches signed identity from attestor API
 * - Post-payment (200): fetches signed acknowledgment from attestor API
 *
 * Works with any scheme (escrow, exact, etc.) — not escrow-specific.
 *
 * @param attestorUrl - Base URL of the attestor service
 */
export function createAttestationExtension(attestorUrl: string): ResourceServerExtension {
  return {
    key: ATTESTATION_KEY,

    enrichPaymentRequiredResponse: async () => {
      try {
        const res = await fetch(`${attestorUrl}/identity`)
        if (!res.ok) return undefined
        const identity = await res.json()
        return { info: { identity } }
      } catch {
        return undefined
      }
    },

    enrichSettlementResponse: async (_declaration: unknown, rawContext: unknown) => {
      const context = rawContext as SettleResultContextWithTransport
      if (!context.result.success) return undefined

      const responseBody = context.transportContext?.responseBody
      if (!responseBody) return undefined

      const contentHash = keccak256(toBytes(responseBody.toString('utf-8')))

      try {
        const res = await fetch(`${attestorUrl}/verify`, {
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
        const data = (await res.json()) as { acknowledgment?: unknown }
        if (!data.acknowledgment) return undefined
        return { info: { acknowledgment: data.acknowledgment } }
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
