/**
 * Type guard for EscrowPayload
 */
export function isEscrowPayload(value: unknown): value is EscrowPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "authorization" in value &&
    "signature" in value &&
    "paymentInfo" in value
  );
}

/**
 * Type guard for EscrowExtra
 */
export function isEscrowExtra(value: unknown): value is EscrowExtra {
  return (
    typeof value === "object" &&
    value !== null &&
    "escrowAddress" in value &&
    "operatorAddress" in value &&
    "tokenCollector" in value
  );
}

// EscrowExtra - fields in PaymentRequirements.extra
export interface EscrowExtra {
  escrowAddress: `0x${string}`;
  operatorAddress: `0x${string}`;
  tokenCollector: `0x${string}`;
  authorizeAddress?: `0x${string}`;
  minDeposit?: string;
  maxDeposit?: string;
  preApprovalExpirySeconds?: number;
  authorizationExpirySeconds?: number;
  refundExpirySeconds?: number;
  minFeeBps?: number;
  maxFeeBps?: number;
  feeReceiver?: `0x${string}`;
  name: string; // EIP-712 domain name (e.g., "USDC" for Base USDC)
  version: string; // EIP-712 domain version (e.g., "2" for USDC)
}

// EscrowPayload - the payload field in PaymentPayload
export interface EscrowPayload {
  authorization: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: `0x${string}`;
  };
  signature: `0x${string}`;
  paymentInfo: {
    operator: `0x${string}`;
    receiver: `0x${string}`;
    token: `0x${string}`;
    maxAmount: string;
    preApprovalExpiry: number;
    authorizationExpiry: number;
    refundExpiry: number;
    minFeeBps: number;
    maxFeeBps: number;
    feeReceiver: `0x${string}`;
    salt: `0x${string}`;
  };
}
