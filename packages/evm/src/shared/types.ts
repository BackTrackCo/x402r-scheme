// EscrowExtra - fields in PaymentRequirements.extra
export interface EscrowExtra {
  escrowAddress: `0x${string}`;
  operatorAddress: `0x${string}`;
  tokenCollector: `0x${string}`;
  authorizeAddress?: `0x${string}`;
  minDeposit?: string;
  maxDeposit?: string;
  authorizationExpirySeconds?: number;
  refundExpirySeconds?: number;
  minFeeBps?: number;
  maxFeeBps?: number;
  feeReceiver?: `0x${string}`;
  name?: string;
  version?: string;
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
    authorizationExpiry: number;
    refundExpiry: number;
    minFeeBps: number;
    maxFeeBps: number;
    feeReceiver: `0x${string}`;
    salt: `0x${string}`;
  };
}
