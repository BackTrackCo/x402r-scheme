// Scheme identifier for the authCapture payment scheme.
export const AUTH_CAPTURE_SCHEME = "authCapture" as const;

// Canonical AuthCaptureEscrow + token collector deployments from
// base/commerce-payments (https://github.com/base/commerce-payments). These are
// the audited, live addresses listed in the upstream README — the source of
// truth for this scheme. Universal constants — not configurable per merchant.
//
// Currently live on: Base (8453) and Base Sepolia (84532). Additional EVM chains
// will land at the same addresses as the upstream extends coverage; expand the
// supported-chain list here as those deployments ship.
export const AUTH_CAPTURE_ESCROW_ADDRESS =
  "0xBdEA0D1bcC5966192B070Fdf62aB4EF5b4420cff" as const satisfies `0x${string}`;
export const EIP3009_TOKEN_COLLECTOR_ADDRESS =
  "0x0E3dF9510de65469C4518D7843919c0b8C7A7757" as const satisfies `0x${string}`;
export const PERMIT2_TOKEN_COLLECTOR_ADDRESS =
  "0x992476B9Ee81d52a5BdA0622C333938D0Af0aB26" as const satisfies `0x${string}`;

// Canonical Uniswap Permit2 contract — same address on every chain it's deployed to.
// https://github.com/Uniswap/permit2
export const PERMIT2_ADDRESS =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const satisfies `0x${string}`;

// ERC-3009 ReceiveWithAuthorization EIP-712 types
export const RECEIVE_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// Uniswap Permit2 PermitTransferFrom EIP-712 types
export const PERMIT2_TRANSFER_FROM_TYPES = {
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
} as const;

/**
 * Map an AuthCaptureEscrow custom-error name (decoded by viem from a
 * ContractFunctionRevertedError) to a stable `invalidReason` string. Anything
 * unmapped falls through to the generic `simulation_failed` so verify() never
 * leaks raw selectors to callers.
 */
export const ESCROW_ERROR_TO_INVALID_REASON: Record<string, string> = {
  AfterPreApprovalExpiry: "authorization_expired",
  InvalidExpiries: "invalid_deadline_ordering",
  ExceedsMaxAmount: "amount_mismatch",
  PaymentAlreadyCollected: "payment_already_collected",
  TokenCollectionFailed: "token_collection_failed",
  InvalidCollectorForOperation: "invalid_collector",
  InvalidSender: "invalid_capture_authorizer",
  ZeroAmount: "amount_mismatch",
  AmountOverflow: "amount_overflow",
  FeeBpsOverflow: "invalid_fee_bps",
  InvalidFeeBpsRange: "invalid_fee_bps_range",
  FeeBpsOutOfRange: "fee_bps_out_of_range",
  ZeroFeeReceiver: "zero_fee_receiver",
  InvalidFeeReceiver: "invalid_fee_receiver",
  AfterAuthorizationExpiry: "capture_deadline_expired",
  InsufficientAuthorization: "insufficient_authorization",
  ZeroAuthorization: "zero_authorization",
};
