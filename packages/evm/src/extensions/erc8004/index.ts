export {
  ERC8004_REPUTATION,
  type AgentIdentity,
  type ClientReputationInfo,
  type AgentReputationRequiredInfo,
  type AgentReputationPayloadInfo,
  type AgentReputationExtension,
  type AgentReputationSchema,
} from './types.js'
export { agentReputationSchema } from './schema.js'
export { declareAgentReputationExtension, agentReputationResourceServerExtension } from './server.js'
export { appendClientIdentity } from './client.js'
export {
  isAgentReputationExtension,
  extractServerIdentity,
  extractClientIdentity,
  extractReputationRegistry,
} from './validation.js'
