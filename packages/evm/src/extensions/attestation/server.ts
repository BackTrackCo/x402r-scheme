import { keccak256, toBytes } from 'viem'
import type {
  ResourceServerExtension,
  PaymentRequiredContext,
  SettleResultContext,
} from '@x402/core/types'
import { DEFAULT_ATTESTATION_KEY } from './types.js'

// transportContext is passed at runtime by x402HTTPResourceServer but not
// declared on the SettleResultContext type. The offer-receipt extension
// accesses it the same way via cast.
interface TransportContext {
  responseBody?: Uint8Array | { toString(encoding: string): string }
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
 * @param key - Extension key (default: 'attestation'). Use a custom key to
 *              support multiple attestors on the same server.
 */
export function createAttestationExtension(
  attestorUrl: string,
  key: string = DEFAULT_ATTESTATION_KEY,
): ResourceServerExtension {
  return {
    key,

    // Pre-payment: include attestor data in 402
    enrichPaymentRequiredResponse: async (
      _declaration: unknown,
      _context: PaymentRequiredContext,
    ) => {
      try {
        // eslint-disable-next-line no-undef
        const res = await fetch(`${attestorUrl}/attest/identity`)
        if (!res.ok) return undefined
        const data = await res.json()
        return { info: { identity: data } }
      } catch (err) {
        console.warn(`[attestation:${key}] identity fetch failed:`, err)
        return undefined
      }
    },

    // Post-payment: forward content to attestor, include response in 200
    enrichSettlementResponse: async (_declaration: unknown, context: SettleResultContext) => {
      if (!context.result.success) return undefined

      // transportContext is passed at runtime but not on the SettleResultContext type
      const transportCtx = (context as unknown as { transportContext?: TransportContext })
        .transportContext
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
        if (!res.ok) return undefined
        const data = await res.json()
        return { info: { settlement: data } }
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
  key: string = DEFAULT_ATTESTATION_KEY,
): Record<string, Record<string, unknown>> {
  return { [key]: {} }
}
