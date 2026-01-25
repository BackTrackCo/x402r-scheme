/**
 * Nonce computation and ERC-3009 signing utilities
 * Adapted from @agentokratia/x402-escrow (MIT)
 */

import { encodeAbiParameters, keccak256, type WalletClient } from 'viem';
import { ZERO_ADDRESS, PAYMENT_INFO_COMPONENTS } from './constants.js';
import type { EscrowExtra, EscrowPayload } from './types.js';

/**
 * Compute escrow nonce for ERC-3009 authorization
 * Uses payer=0 for payer-agnostic nonce (signature valid for any payer)
 */
export function computeEscrowNonce(
  chainId: number,
  escrowAddress: `0x${string}`,
  paymentInfo: EscrowPayload['paymentInfo']
): `0x${string}` {
  const paymentInfoWithZeroPayer = {
    payer: ZERO_ADDRESS,
    operator: paymentInfo.operator,
    receiver: paymentInfo.receiver,
    token: paymentInfo.token,
    maxAmount: BigInt(paymentInfo.maxAmount),
    authorizationExpiry: paymentInfo.authorizationExpiry,
    refundExpiry: paymentInfo.refundExpiry,
    minFeeBps: paymentInfo.minFeeBps,
    maxFeeBps: paymentInfo.maxFeeBps,
    feeReceiver: paymentInfo.feeReceiver,
    salt: paymentInfo.salt,
  };

  const encoded = encodeAbiParameters(
    [
      { name: 'chainId', type: 'uint256' },
      { name: 'escrow', type: 'address' },
      { name: 'paymentInfo', type: 'tuple', components: PAYMENT_INFO_COMPONENTS },
    ],
    [BigInt(chainId), escrowAddress, paymentInfoWithZeroPayer]
  );

  return keccak256(encoded);
}

/**
 * Sign ERC-3009 TransferWithAuthorization
 */
export async function signERC3009(
  wallet: WalletClient,
  authorization: EscrowPayload['authorization'],
  extra: EscrowExtra
): Promise<`0x${string}`> {
  const domain = {
    name: extra.name ?? 'USD Coin',
    version: extra.version ?? '2',
    chainId: await wallet.getChainId(),
    verifyingContract: authorization.to as `0x${string}`, // token contract
  };

  const types = {
    TransferWithAuthorization: [
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
    primaryType: 'TransferWithAuthorization',
    message,
  });
}

/**
 * Verify ERC-3009 signature (facilitator-side)
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
  extra: EscrowExtra
): Promise<boolean> {
  const domain = {
    name: extra.name ?? 'USD Coin',
    version: extra.version ?? '2',
    chainId: 84532, // TODO: get from network
    verifyingContract: authorization.to,
  };

  const types = {
    TransferWithAuthorization: [
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
      primaryType: 'TransferWithAuthorization',
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
