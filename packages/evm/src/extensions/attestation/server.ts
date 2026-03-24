import { keccak256, toBytes } from 'viem'
import type {
  ResourceServerExtension,
  PaymentRequiredContext,
  SettleResultContext,
} from '@x402/core/types'
import { ATTESTATION_KEY } from './types.js'

/**
 * Create the attestation extension for a resource server.
 *
 * Generic pass-through for third-party attestations. The extension
 * doesn't define what gets signed — the attestor decides.
 *
 * - Pre-payment (402): POSTs payment context to attestor, includes response
 * - Post-payment (200): POSTs response body + settlement info to attestor, includes response
 *
 * Works with any scheme (escrow, exact, etc.).
 *
 * **Important:** This extension is a pass-through — it does not verify
 * attestor responses. For client-side verifiability, the attestor must
 * sign its responses (e.g., EIP-712) and the client must verify those
 * signatures against a known attestor address.
 *
 * @param attestorUrl - Base URL of the attestor service
 * @param key - Extension key (default: 'attestation'). Use a custom key to
 *              support multiple attestors on the same server.
 */
export function createAttestationExtension(
  attestorUrl: string,
  key: string = ATTESTATION_KEY,
): ResourceServerExtension {
  return {
    key,

    // Pre-payment: POST payment context to attestor, include response in 402
    enrichPaymentRequiredResponse: async (
      declaration: unknown,
      context: PaymentRequiredContext,
    ) => {
      try {
        // eslint-disable-next-line no-undef
        const res = await fetch(`${attestorUrl}/attest/identity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requirements: context.requirements,
            resource: context.resourceInfo,
            declaration,
          }),
        })
        if (!res.ok) {
          console.warn(
            `[attestation:${key}] identity fetch failed: ${res.status} ${res.statusText}`,
          )
          return undefined
        }
        return { info: { identity: await res.json() } }
      } catch (err) {
        console.warn(`[attestation:${key}] identity fetch failed:`, err)
        return undefined
      }
    },

    // Post-payment: POST response body to attestor, include response in 200
    // Requires @x402/core >=2.8.0 for transportContext on SettleResultContext
    enrichSettlementResponse: async (_declaration: unknown, context: SettleResultContext) => {
      if (!context.result.success) return undefined

      const transportCtx = context.transportContext as
        | { responseBody?: { toString(encoding: string): string } | Uint8Array }
        | undefined
      const responseBody = transportCtx?.responseBody
      if (!responseBody) return undefined

      const bodyStr =
        typeof responseBody === 'string'
          ? responseBody
          : 'toString' in responseBody
            ? responseBody.toString('utf-8')
            : new globalThis.TextDecoder().decode(responseBody as Uint8Array)

      const contentHash = keccak256(toBytes(bodyStr))

      try {
        // eslint-disable-next-line no-undef
        const res = await fetch(`${attestorUrl}/attest/settle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction: context.result.transaction,
            network: context.result.network,
            contentHash,
            responseBody: bodyStr,
          }),
        })
        if (!res.ok) {
          console.warn(`[attestation:${key}] settle fetch failed: ${res.status} ${res.statusText}`)
          return undefined
        }
        return { info: { settlement: await res.json() } }
      } catch (err) {
        console.warn(`[attestation:${key}] settle fetch failed:`, err)
        return undefined
      }
    },
  }
}

/**
 * Declare the attestation extension on a route.
 * Only routes with this declaration will include attestation data.
 *
 * @param key - Extension key (must match the key passed to createAttestationExtension)
 */
export function declareAttestationExtension(
  key: string = ATTESTATION_KEY,
): Record<string, Record<string, unknown>> {
  return { [key]: {} }
}
