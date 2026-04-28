/**
 * Type guard for AuthCapturePayload
 */
export function isAuthCapturePayload(value: unknown): value is AuthCapturePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'authorization' in value &&
    'signature' in value &&
    'paymentInfo' in value
  )
}

/**
 * Type guard for AuthCaptureExtra
 */
export function isAuthCaptureExtra(value: unknown): value is AuthCaptureExtra {
  return (
    typeof value === 'object' &&
    value !== null &&
    'escrowAddress' in value &&
    'operatorAddress' in value &&
    'tokenCollector' in value
  )
}

// AuthCaptureExtra - fields in PaymentRequirements.extra
export interface AuthCaptureExtra {
  escrowAddress: `0x${string}`
  operatorAddress: `0x${string}`
  tokenCollector: `0x${string}`
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

// AuthCapturePayload - the payload field in PaymentPayload
export interface AuthCapturePayload {
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
