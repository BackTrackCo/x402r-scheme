/**
 * JSON Schema definitions for the 8004-reputation Extension
 */

import type { AgentReputationSchema } from './types.js'

/**
 * JSON Schema for validating 8004-reputation extension info.
 * Compliant with JSON Schema Draft 2020-12.
 */
export const agentReputationSchema: AgentReputationSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    identity: {
      type: 'object',
      properties: {
        agentRegistry: {
          type: 'string',
          description: 'CAIP-10 format: {namespace}:{chainId}:{address}',
        },
        agentId: { type: 'string' },
      },
      required: ['agentRegistry', 'agentId'],
    },
    reputationRegistry: {
      type: 'string',
      description: 'Reputation registry contract address',
    },
    endpoint: { type: 'string' },
    client: {
      type: 'object',
      properties: {
        agentIdentity: {
          type: 'object',
          properties: {
            agentRegistry: { type: 'string' },
            agentId: { type: 'string' },
          },
          required: ['agentRegistry', 'agentId'],
        },
      },
    },
  },
  required: ['identity', 'reputationRegistry'],
}
