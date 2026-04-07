/**
 * Type definitions for the 8004-reputation Extension
 *
 * Aligned with x402-foundation/x402#931.
 * Enables servers and clients to declare their ERC-8004 agent identities
 * and reputation registry within the x402 extension system.
 */

/**
 * Extension identifier for the 8004-reputation extension
 * Aligned with x402-foundation/x402#931
 */
export const ERC8004_REPUTATION = '8004-reputation'

/**
 * Agent identity using CAIP-10 format for the registry address.
 * EVM only for x402r (Solana support defined in spec but not implemented).
 */
export interface AgentIdentity {
  /** Format: "eip155:{chainId}:{identityRegistryAddress}" */
  agentRegistry: string
  /** ERC-721 tokenId from the Identity Registry (stringified bigint) */
  agentId: string
}

/**
 * Client reputation info appended by the payer.
 * Required for server->client reputation feedback.
 */
export interface ClientReputationInfo {
  agentIdentity: AgentIdentity
}

/**
 * Extension info in PaymentRequired (server -> client)
 */
export interface AgentReputationRequiredInfo {
  identity: AgentIdentity
  /** Reputation Registry contract address */
  reputationRegistry: string
  /** Resource endpoint being accessed (used in giveFeedback) */
  endpoint?: string
}

/**
 * Extension info in PaymentPayload (echoed from server + optional client info)
 */
export interface AgentReputationPayloadInfo extends AgentReputationRequiredInfo {
  client?: ClientReputationInfo
}

/**
 * Full extension structure with info and JSON Schema
 */
export interface AgentReputationExtension {
  info: AgentReputationRequiredInfo | AgentReputationPayloadInfo
  schema: AgentReputationSchema
}

/**
 * JSON Schema type for the 8004-reputation extension
 */
export interface AgentReputationSchema {
  $schema: 'https://json-schema.org/draft/2020-12/schema'
  type: 'object'
  properties: Record<string, unknown>
  required: string[]
}
