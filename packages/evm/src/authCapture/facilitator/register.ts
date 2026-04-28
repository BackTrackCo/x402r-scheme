import type { Network } from '@x402/core/types'
import type { FacilitatorEvmSigner } from '@x402/evm'
import { x402Facilitator } from '@x402/core/facilitator'
import { AuthCaptureFacilitatorScheme } from './scheme'
import type { AuthCaptureFacilitatorOptions } from './scheme'

export interface EvmFacilitatorConfig {
  signer: FacilitatorEvmSigner
  networks: Network | Network[]
  /** Override default escrow/tokenCollector addresses in /supported */
  defaults?: AuthCaptureFacilitatorOptions
}

/**
 * Register authCapture scheme with x402Facilitator
 *
 * The facilitator is operator-agnostic — it supports any operator. Operator
 * addresses are provided per-request by the merchant in `requirements.extra`.
 * Base commerce-payments addresses (escrow, tokenCollector) are provided as
 * defaults via `/supported` and can be overridden by the merchant or via
 * `config.defaults`.
 *
 * @example Default (commerce-payments addresses)
 * ```typescript
 * registerAuthCaptureEvmScheme(facilitator, {
 *   signer: evmSigner,
 *   networks: "eip155:84532",
 * });
 * ```
 *
 * @example Custom defaults (e.g. x402r fork)
 * ```typescript
 * registerAuthCaptureEvmScheme(facilitator, {
 *   signer: evmSigner,
 *   networks: "eip155:84532",
 *   defaults: {
 *     escrowAddress: "0x...",
 *     tokenCollector: "0x...",
 *   },
 * });
 * ```
 */
export function registerAuthCaptureEvmScheme(
  facilitator: x402Facilitator,
  config: EvmFacilitatorConfig,
): x402Facilitator {
  facilitator.register(
    config.networks,
    new AuthCaptureFacilitatorScheme(config.signer, config.defaults),
  )
  return facilitator
}
