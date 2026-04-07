/**
 * Resource Server utilities for the 8004-reputation Extension
 */

import type { ResourceServerExtension } from '@x402/core/types'
import type { AgentReputationExtension, AgentReputationRequiredInfo } from './types.js'
import { ERC8004_REPUTATION } from './types.js'
import { agentReputationSchema } from './schema.js'

/**
 * Declares the 8004-reputation extension for inclusion in PaymentRequired.extensions.
 *
 * Resource servers call this function to advertise their agent identity,
 * reputation registry, and optionally the resource endpoint.
 *
 * @param config - Server agent identity and reputation registry info
 * @returns An AgentReputationExtension object ready for PaymentRequired.extensions
 *
 * @example
 * ```typescript
 * import { declareAgentReputationExtension, ERC8004_REPUTATION } from '@x402r/evm/extensions/erc8004'
 *
 * const paymentRequired = {
 *   x402Version: 2,
 *   resource: { ... },
 *   accepts: [ ... ],
 *   extensions: {
 *     [ERC8004_REPUTATION]: declareAgentReputationExtension({
 *       identity: {
 *         agentRegistry: 'eip155:8453:0x1234...abcd',
 *         agentId: '42',
 *       },
 *       reputationRegistry: '0xabcd...1234',
 *       endpoint: '/api/data',
 *     })
 *   }
 * }
 * ```
 */
export function declareAgentReputationExtension(
  config: AgentReputationRequiredInfo,
): AgentReputationExtension {
  return {
    info: config,
    schema: agentReputationSchema,
  }
}

/**
 * ResourceServerExtension implementation for 8004-reputation.
 *
 * This extension doesn't require any enrichment hooks since the declaration
 * is static. Provided for consistency with other extensions and for
 * potential future use with the extension registration system.
 *
 * @example
 * ```typescript
 * import { agentReputationResourceServerExtension } from '@x402r/evm/extensions/erc8004'
 *
 * resourceServer.registerExtension(agentReputationResourceServerExtension)
 * ```
 */
export const agentReputationResourceServerExtension: ResourceServerExtension = {
  key: ERC8004_REPUTATION,
}
