export const MAX_UINT48 = 281474976710655
export const MAX_UINT32 = 4294967295

// Canonical AuthCaptureEscrow + token collector deployments from base/commerce-payments.
// These are universal constants — not configurable per merchant. The same address is
// expected on every supported chain (CREATE2 deploy under deterministic salts).
// Currently only Base mainnet + Base Sepolia are confirmed; BASE_CHAIN_IDS gates
// /supported until additional chains are deployed.
// https://github.com/base/commerce-payments
export const AUTH_CAPTURE_ESCROW_ADDRESS =
  '0xBdEA0D1bcC5966192B070Fdf62aB4EF5b4420cff' as const satisfies `0x${string}`
export const EIP3009_TOKEN_COLLECTOR_ADDRESS =
  '0x0E3dF9510de65469C4518D7843919c0b8C7A7757' as const satisfies `0x${string}`
export const PERMIT2_TOKEN_COLLECTOR_ADDRESS =
  '0x992476B9Ee81d52a5BdA0622C333938D0Af0aB26' as const satisfies `0x${string}`

// Canonical Uniswap Permit2 contract — same address on every chain it's deployed to.
// https://github.com/Uniswap/permit2
export const PERMIT2_ADDRESS =
  '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const satisfies `0x${string}`

export const BASE_CHAIN_IDS = new Set(['eip155:8453', 'eip155:84532'])

// PaymentInfo struct for AuthCaptureEscrow (matches base/commerce-payments contract).
// Field names are canonical Solidity — do not rename. Spec-level field renames
// (captureAuthorizer, captureDeadline, refundDeadline, feeRecipient) live at the
// extra/wire layer; this struct preserves the canonical EIP-712 typehash.
export const PAYMENT_INFO_COMPONENTS = [
  { name: 'operator', type: 'address' },
  { name: 'payer', type: 'address' },
  { name: 'receiver', type: 'address' },
  { name: 'token', type: 'address' },
  { name: 'maxAmount', type: 'uint120' },
  { name: 'preApprovalExpiry', type: 'uint48' },
  { name: 'authorizationExpiry', type: 'uint48' },
  { name: 'refundExpiry', type: 'uint48' },
  { name: 'minFeeBps', type: 'uint16' },
  { name: 'maxFeeBps', type: 'uint16' },
  { name: 'feeReceiver', type: 'address' },
  { name: 'salt', type: 'uint256' },
] as const

export const ESCROW_ABI = [
  {
    name: 'authorize',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'paymentInfo',
        type: 'tuple',
        components: PAYMENT_INFO_COMPONENTS,
      },
      { name: 'amount', type: 'uint256' },
      { name: 'tokenCollector', type: 'address' },
      { name: 'collectorData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'charge',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'paymentInfo',
        type: 'tuple',
        components: PAYMENT_INFO_COMPONENTS,
      },
      { name: 'amount', type: 'uint256' },
      { name: 'tokenCollector', type: 'address' },
      { name: 'collectorData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

// ERC-3009 ReceiveWithAuthorization EIP-712 types
export const RECEIVE_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

// Uniswap Permit2 PermitTransferFrom EIP-712 types
export const PERMIT2_TRANSFER_FROM_TYPES = {
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
} as const

// ERC-20 balanceOf ABI for balance checks
export const ERC20_BALANCE_OF_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const
