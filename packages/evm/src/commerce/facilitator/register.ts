import type { Network } from '@x402/core/types'
import type { FacilitatorEvmSigner } from '@x402/evm'
import { x402Facilitator } from '@x402/core/facilitator'
import { CommerceFacilitatorScheme } from './scheme'

export interface EvmFacilitatorConfig {
  signer: FacilitatorEvmSigner
  networks: Network | Network[]
}

/**
 * Register commerce scheme with x402Facilitator
 *
 * The facilitator is operator-agnostic — it supports any operator. Operator
 * addresses are provided per-request by the merchant in `requirements.extra`.
 * Base commerce-payments addresses (escrow, tokenCollector) are provided as
 * defaults via `/supported` and can be overridden by the merchant.
 *
 * @example
 * ```typescript
 * const facilitator = new x402Facilitator();
 * registerCommerceEvmScheme(facilitator, {
 *   signer: evmSigner,
 *   networks: "eip155:84532",
 * });
 * ```
 */
export function registerCommerceEvmScheme(
  facilitator: x402Facilitator,
  config: EvmFacilitatorConfig,
): x402Facilitator {
  facilitator.register(config.networks, new CommerceFacilitatorScheme(config.signer))
  return facilitator
}
