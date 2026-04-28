import type { Network } from '@x402/core/types'
import type { FacilitatorEvmSigner } from '@x402/evm'
import { x402Facilitator } from '@x402/core/facilitator'
import { AuthCaptureFacilitatorScheme } from './scheme'

export interface EvmFacilitatorConfig {
  signer: FacilitatorEvmSigner
  networks: Network | Network[]
}

/**
 * Register authCapture scheme with x402Facilitator.
 *
 * The facilitator is captureAuthorizer-agnostic — it supports any captureAuthorizer.
 * The captureAuthorizer address is provided per-request by the merchant in
 * `requirements.extra.captureAuthorizer`. AuthCaptureEscrow + token-collector
 * addresses are universal constants and never come from the wire format.
 *
 * @example
 * ```typescript
 * registerAuthCaptureEvmScheme(facilitator, {
 *   signer: evmSigner,
 *   networks: "eip155:84532",
 * });
 * ```
 */
export function registerAuthCaptureEvmScheme(
  facilitator: x402Facilitator,
  config: EvmFacilitatorConfig,
): x402Facilitator {
  facilitator.register(config.networks, new AuthCaptureFacilitatorScheme(config.signer))
  return facilitator
}
