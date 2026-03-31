/**
 * Type guard for CommercePayload
 */
export function isCommercePayload(value: unknown): value is CommercePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'authorization' in value &&
    'signature' in value &&
    'paymentInfo' in value
  )
}

/**
 * Type guard for CommerceExtra
 */
export function isCommerceExtra(value: unknown): value is CommerceExtra {
  return (
    typeof value === 'object' &&
    value !== null &&
    'escrowAddress' in value &&
    'operatorAddress' in value
  )
}

// CommerceExtra - fields in PaymentRequirements.extra
export interface CommerceExtra {
  escrowAddress: `0x${string}`
  operatorAddress: `0x${string}`
  tokenCollector?: `0x${string}` // defaults to commerce-payments ERC3009PaymentCollector
  preApprovalExpirySeconds?: number
  authorizationExpirySeconds?: number
  refundExpirySeconds?: number
  minFeeBps?: number
  maxFeeBps?: number
  feeReceiver?: `0x${string}`
  settlementMethod?: 'authorize' | 'charge' // default: "authorize"
  name: string // EIP-712 domain name (e.g., "USDC" for Base USDC)
  version: string // EIP-712 domain version (e.g., "2" for USDC)
}

// CommercePayload - the payload field in PaymentPayload
export interface CommercePayload {
  authorization: {
    from: `0x${string}`
    to: `0x${string}`
    value: string
    validAfter: string
    validBefore: string
    nonce: `0x${string}`
  }
  signature: `0x${string}`
  paymentInfo: {
    operator: `0x${string}`
    receiver: `0x${string}`
    token: `0x${string}`
    maxAmount: string
    preApprovalExpiry: number
    authorizationExpiry: number
    refundExpiry: number
    minFeeBps: number
    maxFeeBps: number
    feeReceiver: `0x${string}`
    salt: `0x${string}`
  }
}
