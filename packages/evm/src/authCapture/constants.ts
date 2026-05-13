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

// PaymentInfo struct for AuthCaptureEscrow (matches base/commerce-payments contract).
// Field names are canonical Solidity — do not rename. Spec-level field renames
// (captureAuthorizer, captureDeadline, refundDeadline, feeRecipient) live at the
// extra/wire layer; this struct preserves the canonical EIP-712 typehash.
export const PAYMENT_INFO_COMPONENTS = [
  { name: "operator", type: "address" },
  { name: "payer", type: "address" },
  { name: "receiver", type: "address" },
  { name: "token", type: "address" },
  { name: "maxAmount", type: "uint120" },
  { name: "preApprovalExpiry", type: "uint48" },
  { name: "authorizationExpiry", type: "uint48" },
  { name: "refundExpiry", type: "uint48" },
  { name: "minFeeBps", type: "uint16" },
  { name: "maxFeeBps", type: "uint16" },
  { name: "feeReceiver", type: "address" },
  { name: "salt", type: "uint256" },
] as const;

export const ESCROW_ABI = [
  {
    name: "authorize",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "paymentInfo",
        type: "tuple",
        components: PAYMENT_INFO_COMPONENTS,
      },
      { name: "amount", type: "uint256" },
      { name: "tokenCollector", type: "address" },
      { name: "collectorData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "charge",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "paymentInfo",
        type: "tuple",
        components: PAYMENT_INFO_COMPONENTS,
      },
      { name: "amount", type: "uint256" },
      { name: "tokenCollector", type: "address" },
      { name: "collectorData", type: "bytes" },
      { name: "feeBps", type: "uint16" },
      { name: "feeReceiver", type: "address" },
    ],
    outputs: [],
  },
] as const;

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

// ERC-20 balanceOf ABI for balance checks
export const ERC20_BALANCE_OF_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

// View functions on AuthCaptureEscrow used by tests / introspection. Not part
// of ESCROW_ABI because settle/simulate paths only need authorize + charge.
export const ESCROW_VIEW_ABI = [
  {
    name: "getHash",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "paymentInfo",
        type: "tuple",
        components: PAYMENT_INFO_COMPONENTS,
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "paymentState",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "paymentInfoHash", type: "bytes32" }],
    outputs: [
      {
        name: "state",
        type: "tuple",
        components: [
          { name: "hasCollectedPayment", type: "bool" },
          { name: "capturableAmount", type: "uint120" },
          { name: "refundableAmount", type: "uint120" },
        ],
      },
    ],
  },
] as const;

// AuthCaptureEscrow custom errors. Spliced into the ABI passed to simulateContract
// so viem can decode `ContractFunctionRevertedError.data.errorName` instead of
// falling back to an opaque hex selector. Names mirror the Solidity definitions
// at base/commerce-payments/src/AuthCaptureEscrow.sol.
export const ESCROW_ERRORS_ABI = [
  { type: "error", name: "InvalidSender", inputs: [{ type: "address" }, { type: "address" }] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "AmountOverflow", inputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "error", name: "ExceedsMaxAmount", inputs: [{ type: "uint256" }, { type: "uint256" }] },
  {
    type: "error",
    name: "AfterPreApprovalExpiry",
    inputs: [{ type: "uint48" }, { type: "uint48" }],
  },
  {
    type: "error",
    name: "InvalidExpiries",
    inputs: [{ type: "uint48" }, { type: "uint48" }, { type: "uint48" }],
  },
  { type: "error", name: "FeeBpsOverflow", inputs: [{ type: "uint16" }] },
  { type: "error", name: "InvalidFeeBpsRange", inputs: [{ type: "uint16" }, { type: "uint16" }] },
  {
    type: "error",
    name: "FeeBpsOutOfRange",
    inputs: [{ type: "uint16" }, { type: "uint16" }, { type: "uint16" }],
  },
  { type: "error", name: "ZeroFeeReceiver", inputs: [] },
  { type: "error", name: "InvalidFeeReceiver", inputs: [{ type: "address" }, { type: "address" }] },
  { type: "error", name: "InvalidCollectorForOperation", inputs: [] },
  { type: "error", name: "TokenCollectionFailed", inputs: [] },
  { type: "error", name: "PaymentAlreadyCollected", inputs: [{ type: "bytes32" }] },
  {
    type: "error",
    name: "AfterAuthorizationExpiry",
    inputs: [{ type: "uint48" }, { type: "uint48" }],
  },
  {
    type: "error",
    name: "InsufficientAuthorization",
    inputs: [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
  },
  { type: "error", name: "ZeroAuthorization", inputs: [{ type: "bytes32" }] },
] as const;

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
