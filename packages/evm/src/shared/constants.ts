export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export const MAX_UINT48 = 281474976710655;
export const MAX_UINT32 = 4294967295;

// PaymentInfo struct for AuthCaptureEscrow
export const PAYMENT_INFO_COMPONENTS = [
  { name: 'payer', type: 'address' },
  { name: 'operator', type: 'address' },
  { name: 'receiver', type: 'address' },
  { name: 'token', type: 'address' },
  { name: 'maxAmount', type: 'uint256' },
  { name: 'authorizationExpiry', type: 'uint32' },
  { name: 'refundExpiry', type: 'uint48' },
  { name: 'minFeeBps', type: 'uint16' },
  { name: 'maxFeeBps', type: 'uint16' },
  { name: 'feeReceiver', type: 'address' },
  { name: 'salt', type: 'bytes32' },
] as const;

export const OPERATOR_ABI = [
  {
    name: 'authorize',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'paymentInfo', type: 'tuple', components: PAYMENT_INFO_COMPONENTS },
      { name: 'amount', type: 'uint256' },
      { name: 'tokenCollector', type: 'address' },
      { name: 'collectorData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

// ERC-3009 TransferWithAuthorization type hash
export const TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
  '0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267' as const;
