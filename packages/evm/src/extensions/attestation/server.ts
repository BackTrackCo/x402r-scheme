import type { ResourceServerExtension, PaymentRequiredContext } from '@x402/core/types'
import { ATTESTATION_KEY } from './types.js'

export type ErrorHandler = (error: unknown) => void

export interface AttestationExtensionOptions {
  /** Extension key (default: 'attestation'). Use a custom key to support multiple attestors. */
  key?: string
  /** Custom error handler. Defaults to `console.warn`. */
  onError?: ErrorHandler
}

/**
 * Create the attestation extension for a resource server.
 *
 * Generic pass-through for third-party attestations in the 402 response.
 * POSTs payment context to the attestor and includes the signed response
 * so clients can verify attestor identity before paying.
 *
 * Post-payment forwarding (response body to attestor) is intentionally
 * NOT included — use an `onAfterSettle` hook for that, since different
 * attestors have different payload requirements.
 *
 * **Important:** This extension is a pass-through — it does not verify
 * attestor responses. For client-side verifiability, the attestor must
 * sign its responses (e.g., EIP-712) and the client must verify those
 * signatures against a known attestor address.
 *
 * @param attestorUrl - Base URL of the attestor service
 * @param options - Optional configuration
 *
 * @example
 * ```ts
 * createAttestationExtension('http://arbiter:3001', {
 *   onError: (err) => sentry.captureException(err),
 * })
 * ```
 */
export function createAttestationExtension(
  attestorUrl: string,
  options?: AttestationExtensionOptions,
): ResourceServerExtension {
  const key = options?.key ?? ATTESTATION_KEY
  const errorHandler: ErrorHandler =
    options?.onError ?? ((err) => console.warn(`[attestation:${key}] identity fetch failed:`, err))

  return {
    key,

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
          errorHandler(
            new Error(`[attestation:${key}] ${attestorUrl}: ${res.status} ${res.statusText}`),
          )
          return undefined
        }
        return { info: { identity: await res.json() } }
      } catch (err) {
        errorHandler(
          err instanceof Error
            ? Object.assign(err, { message: `[attestation:${key}] ${attestorUrl}: ${err.message}` })
            : new Error(`[attestation:${key}] ${attestorUrl}: ${err}`),
        )
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
