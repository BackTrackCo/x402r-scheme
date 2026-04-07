/**
 * Validation and extraction utilities for the 8004-reputation Extension
 */

import type {
  AgentReputationExtension,
  AgentReputationRequiredInfo,
  AgentReputationPayloadInfo,
  AgentIdentity,
} from './types.js'
import { ERC8004_REPUTATION } from './types.js'

/**
 * Type guard to check if an object is a valid 8004-reputation extension structure.
 *
 * Checks for the required structure: info.identity.agentRegistry, info.identity.agentId,
 * and info.reputationRegistry.
 *
 * @param value - The object to check
 * @returns True if the object has the expected 8004-reputation extension structure
 *
 * @example
 * ```typescript
 * if (isAgentReputationExtension(extensions['8004-reputation'])) {
 *   console.log(extension.info.identity.agentId)
 * }
 * ```
 */
export function isAgentReputationExtension(value: unknown): value is AgentReputationExtension {
  if (!value || typeof value !== 'object') {
    return false
  }

  const ext = value as Partial<AgentReputationExtension>

  if (!ext.info || typeof ext.info !== 'object') {
    return false
  }

  const info = ext.info as Partial<AgentReputationRequiredInfo>

  // identity must be an object with agentRegistry and agentId
  if (!info.identity || typeof info.identity !== 'object') {
    return false
  }

  const identity = info.identity as Partial<AgentIdentity>

  if (typeof identity.agentRegistry !== 'string' || typeof identity.agentId !== 'string') {
    return false
  }

  // reputationRegistry must be a string
  if (typeof info.reputationRegistry !== 'string') {
    return false
  }

  return true
}

/**
 * Extracts the server's agent identity from a PaymentRequired-shaped object.
 *
 * @param paymentRequired - Object with an extensions field (e.g. PaymentRequired)
 * @returns The server's AgentIdentity, or undefined if not present
 *
 * @example
 * ```typescript
 * const serverIdentity = extractServerIdentity(paymentRequired)
 * if (serverIdentity) {
 *   console.log('Server agent:', serverIdentity.agentId)
 * }
 * ```
 */
export function extractServerIdentity(
  paymentRequired: Record<string, unknown>,
): AgentIdentity | undefined {
  const extensions = paymentRequired?.extensions as Record<string, unknown> | undefined
  if (!extensions) {
    return undefined
  }

  const extension = extensions[ERC8004_REPUTATION]
  if (!isAgentReputationExtension(extension)) {
    return undefined
  }

  return extension.info.identity
}

/**
 * Extracts the client's agent identity from a PaymentPayload-shaped object.
 *
 * @param paymentPayload - Object with an extensions field (e.g. PaymentPayload)
 * @returns The client's AgentIdentity, or undefined if not present
 *
 * @example
 * ```typescript
 * const clientIdentity = extractClientIdentity(paymentPayload)
 * if (clientIdentity) {
 *   console.log('Client agent:', clientIdentity.agentId)
 * }
 * ```
 */
export function extractClientIdentity(
  paymentPayload: Record<string, unknown>,
): AgentIdentity | undefined {
  const extensions = paymentPayload?.extensions as Record<string, unknown> | undefined
  if (!extensions) {
    return undefined
  }

  const extension = extensions[ERC8004_REPUTATION]
  if (!isAgentReputationExtension(extension)) {
    return undefined
  }

  const info = extension.info as Partial<AgentReputationPayloadInfo>
  if (!info.client || typeof info.client !== 'object') {
    return undefined
  }

  const client = info.client
  if (
    !client.agentIdentity ||
    typeof client.agentIdentity !== 'object' ||
    typeof client.agentIdentity.agentRegistry !== 'string' ||
    typeof client.agentIdentity.agentId !== 'string'
  ) {
    return undefined
  }

  return client.agentIdentity
}

/**
 * Extracts the reputation registry address from a PaymentRequired or PaymentPayload-shaped object.
 *
 * @param obj - Object with an extensions field
 * @returns The reputation registry address string, or undefined if not present
 *
 * @example
 * ```typescript
 * const registry = extractReputationRegistry(paymentRequired)
 * if (registry) {
 *   console.log('Reputation registry:', registry)
 * }
 * ```
 */
export function extractReputationRegistry(
  obj: Record<string, unknown>,
): string | undefined {
  const extensions = obj?.extensions as Record<string, unknown> | undefined
  if (!extensions) {
    return undefined
  }

  const extension = extensions[ERC8004_REPUTATION]
  if (!isAgentReputationExtension(extension)) {
    return undefined
  }

  return extension.info.reputationRegistry
}
