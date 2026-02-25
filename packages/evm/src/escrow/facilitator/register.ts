import type { Network } from '@x402/core/types'
import type { FacilitatorEvmSigner } from '@x402/evm'
import { x402Facilitator } from '@x402/core/facilitator'
import { EscrowFacilitatorScheme } from './scheme'

export interface EvmFacilitatorConfig {
  signer: FacilitatorEvmSigner
  networks: Network | Network[]
}

/**
 * Register escrow scheme with x402Facilitator
 *
 * The facilitator is operator-agnostic — it supports any operator. Operator,
 * escrow, and tokenCollector addresses are provided per-request by the merchant
 * via `refundable()` and arrive in `requirements.extra`.
 *
 * @example
 * ```typescript
 * const facilitator = new x402Facilitator();
 * registerEscrowEvmScheme(facilitator, {
 *   signer: evmSigner,
 *   networks: "eip155:84532",
 * });
 * ```
 */
export function registerEscrowEvmScheme(
  facilitator: x402Facilitator,
  config: EvmFacilitatorConfig,
): x402Facilitator {
  facilitator.register(config.networks, new EscrowFacilitatorScheme(config.signer))
  return facilitator
}
