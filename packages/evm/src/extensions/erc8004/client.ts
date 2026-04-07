/**
 * Client-side utilities for the 8004-reputation Extension
 */

import type { ClientReputationInfo, AgentReputationPayloadInfo } from './types.js'
import { ERC8004_REPUTATION } from './types.js'
import { isAgentReputationExtension } from './validation.js'

/**
 * Appends client identity to the extensions object if the server declared 8004-reputation support.
 *
 * This function reads the server's `8004-reputation` declaration from the extensions,
 * and appends the client's agent identity to it. If the extension is not present
 * (server didn't declare it), the extensions are returned unchanged.
 *
 * Does NOT generate identities -- the clientIdentity must be provided explicitly by the caller.
 *
 * @param extensions - The extensions object from PaymentRequired (modified in place)
 * @param clientIdentity - The client's reputation info with agent identity
 * @returns The modified extensions object (same reference as input)
 *
 * @example
 * ```typescript
 * import { appendClientIdentity } from '@x402r/evm/extensions/erc8004'
 *
 * const extensions = paymentRequired.extensions ?? {}
 * appendClientIdentity(extensions, {
 *   agentIdentity: {
 *     agentRegistry: 'eip155:8453:0x1234...abcd',
 *     agentId: '99',
 *   },
 * })
 *
 * const paymentPayload = {
 *   x402Version: 2,
 *   resource: paymentRequired.resource,
 *   accepted: selectedPaymentOption,
 *   payload: { ... },
 *   extensions,
 * }
 * ```
 */
export function appendClientIdentity(
  extensions: Record<string, unknown>,
  clientIdentity: ClientReputationInfo,
): Record<string, unknown> {
  const extension = extensions[ERC8004_REPUTATION]

  // Only append if the server declared this extension with valid structure
  if (!isAgentReputationExtension(extension)) {
    return extensions
  }

  // Append the client's identity to the existing extension info
  ;(extension.info as AgentReputationPayloadInfo).client = clientIdentity

  return extensions
}
