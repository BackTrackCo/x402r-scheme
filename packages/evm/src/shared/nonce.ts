/**
 * Nonce computation and ERC-3009 signing utilities
 * Adapted from @agentokratia/x402-escrow (MIT)
 */

import { encodeAbiParameters, keccak256, type WalletClient } from 'viem';
import { ZERO_ADDRESS, PAYMENT_INFO_COMPONENTS } from './constants.js';
import type { EscrowExtra, EscrowPayload } from './types.js';

/**
 * PaymentInfo typehash - must match AuthCaptureEscrow.PAYMENT_INFO_TYPEHASH
 */
const PAYMENT_INFO_TYPEHASH = keccak256(
  new TextEncoder().encode(
    'PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)'
  )
);

/**
 * Compute escrow nonce for ERC-3009 authorization
 * Must match AuthCaptureEscrow.getHash() with payer=address(0)
 */
export function computeEscrowNonce(
  chainId: number,
  escrowAddress: `0x${string}`,
  paymentInfo: EscrowPayload['paymentInfo']
): `0x${string}` {
  // Step 1: Encode paymentInfo with payer=0 (payer-agnostic)
  const paymentInfoEncoded = encodeAbiParameters(
    [
      { name: 'typehash', type: 'bytes32' },
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
    ],
    [
      PAYMENT_INFO_TYPEHASH,
      paymentInfo.operator,
      ZERO_ADDRESS, // payer-agnostic
      paymentInfo.receiver,
      paymentInfo.token,
      BigInt(paymentInfo.maxAmount),
      paymentInfo.preApprovalExpiry,
      paymentInfo.authorizationExpiry,
      paymentInfo.refundExpiry,
      paymentInfo.minFeeBps,
      paymentInfo.maxFeeBps,
      paymentInfo.feeReceiver,
      BigInt(paymentInfo.salt),
    ]
  );
  const paymentInfoHash = keccak256(paymentInfoEncoded);

  // Step 2: Encode (chainId, escrow, paymentInfoHash) and hash
  const outerEncoded = encodeAbiParameters(
    [
      { name: 'chainId', type: 'uint256' },
      { name: 'escrow', type: 'address' },
      { name: 'paymentInfoHash', type: 'bytes32' },
    ],
    [BigInt(chainId), escrowAddress, paymentInfoHash]
  );

  return keccak256(outerEncoded);
}

/**
 * Sign ERC-3009 ReceiveWithAuthorization
 * Note: receiveWithAuthorization uses a different primary type than transferWithAuthorization
 */
export async function signERC3009(
  wallet: WalletClient,
  authorization: EscrowPayload['authorization'],
  extra: EscrowExtra,
  tokenAddress: `0x${string}`
): Promise<`0x${string}`> {
  // Note: Base Sepolia/Mainnet USDC uses "USDC" as name, not "USD Coin"
  const domain = {
    name: extra.name ?? 'USDC',
    version: extra.version ?? '2',
    chainId: await wallet.getChainId(),
    verifyingContract: tokenAddress,
  };

  // ERC-3009 uses ReceiveWithAuthorization for receiveWithAuthorization()
  const types = {
    ReceiveWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };

  const message = {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  };

  return wallet.signTypedData({
    account: wallet.account!,
    domain,
    types,
    primaryType: 'ReceiveWithAuthorization',
    message,
  });
}

/**
 * Verify ERC-3009 signature (facilitator-side)
 * @param signer - The signer with verifyTypedData method
 * @param authorization - ERC-3009 authorization data
 * @param signature - The signature to verify
 * @param extra - Extra configuration including chainId
 * @param tokenAddress - The token contract address (verifyingContract for EIP-712)
 */
export async function verifyERC3009Signature(
  signer: {
    verifyTypedData: (args: {
      address: `0x${string}`;
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
      signature: `0x${string}`;
    }) => Promise<boolean>;
  },
  authorization: EscrowPayload['authorization'],
  signature: `0x${string}`,
  extra: EscrowExtra & { chainId: number },
  tokenAddress: `0x${string}`
): Promise<boolean> {
  // Note: Base Sepolia/Mainnet USDC uses "USDC" as name, not "USD Coin"
  const domain = {
    name: extra.name ?? 'USDC',
    version: extra.version ?? '2',
    chainId: extra.chainId,
    verifyingContract: tokenAddress,
  };

  // Must use ReceiveWithAuthorization to match what was signed
  const types = {
    ReceiveWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };

  const message = {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  };

  try {
    return await signer.verifyTypedData({
      address: authorization.from,
      domain,
      types,
      primaryType: 'ReceiveWithAuthorization',
      message,
      signature,
    });
  } catch {
    return false;
  }
}

/**
 * Generate random salt for paymentInfo
 */
export function generateSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}
