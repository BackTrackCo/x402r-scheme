/**
 * Nonce computation, salt generation, and signing helpers.
 */

import { encodeAbiParameters, getAddress, keccak256, toHex, zeroAddress } from "viem";
import type { ClientEvmSigner } from "@x402/evm";
import {
  AUTH_CAPTURE_ESCROW_ADDRESS,
  PERMIT2_ADDRESS,
  PERMIT2_TRANSFER_FROM_TYPES,
  RECEIVE_AUTHORIZATION_TYPES,
} from "./constants";
import type { AuthCaptureExtra, Eip3009Payload, PaymentInfoStruct, Permit2Payload } from "./types";

/**
 * PaymentInfo typehash — must match AuthCaptureEscrow.PAYMENT_INFO_TYPEHASH.
 */
const PAYMENT_INFO_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)",
  ),
);

/**
 * Compute the payer-agnostic PaymentInfo hash. Used as the ERC-3009 nonce
 * (bytes32) and as the Permit2 nonce (uint256). Payer is zeroed so the same
 * hash can be reconstructed by the facilitator regardless of who pays.
 *
 * Freshness is the responsibility of `paymentInfo.salt` — generate a new salt
 * per signing call (see `generateSalt`).
 */
export function computePayerAgnosticPaymentInfoHash(
  chainId: number,
  paymentInfo: PaymentInfoStruct,
): `0x${string}` {
  const paymentInfoEncoded = encodeAbiParameters(
    [
      { name: "typehash", type: "bytes32" },
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
    ],
    [
      PAYMENT_INFO_TYPEHASH,
      paymentInfo.operator,
      zeroAddress,
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
    ],
  );
  const paymentInfoHash = keccak256(paymentInfoEncoded);

  const outerEncoded = encodeAbiParameters(
    [
      { name: "chainId", type: "uint256" },
      { name: "escrow", type: "address" },
      { name: "paymentInfoHash", type: "bytes32" },
    ],
    [BigInt(chainId), AUTH_CAPTURE_ESCROW_ADDRESS, paymentInfoHash],
  );

  return keccak256(outerEncoded);
}

/**
 * Sign ERC-3009 ReceiveWithAuthorization. The token's EIP-712 domain (name,
 * version) comes from `extra` because it varies per asset (e.g. "USDC" on
 * Sepolia, "USD Coin" on mainnet).
 */
export async function signERC3009(
  signer: ClientEvmSigner,
  authorization: Eip3009Payload["authorization"],
  extra: AuthCaptureExtra,
  tokenAddress: `0x${string}`,
  chainId: number,
): Promise<`0x${string}`> {
  const domain = {
    name: extra.name,
    version: extra.version,
    chainId,
    verifyingContract: getAddress(tokenAddress),
  };

  const message = {
    from: getAddress(authorization.from),
    to: getAddress(authorization.to),
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  };

  return signer.signTypedData({
    domain,
    types: RECEIVE_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message,
  });
}

/**
 * Verify ERC-3009 ReceiveWithAuthorization signature.
 */
export async function verifyERC3009Signature(
  signer: {
    verifyTypedData: (_args: {
      address: `0x${string}`;
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
      signature: `0x${string}`;
    }) => Promise<boolean>;
  },
  authorization: Eip3009Payload["authorization"],
  signature: `0x${string}`,
  extra: AuthCaptureExtra & { chainId: number },
  tokenAddress: `0x${string}`,
): Promise<boolean> {
  const domain = {
    name: extra.name,
    version: extra.version,
    chainId: extra.chainId,
    verifyingContract: getAddress(tokenAddress),
  };

  const message = {
    from: getAddress(authorization.from),
    to: getAddress(authorization.to),
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  };

  try {
    return await signer.verifyTypedData({
      address: getAddress(authorization.from),
      domain,
      types: RECEIVE_AUTHORIZATION_TYPES,
      primaryType: "ReceiveWithAuthorization",
      message,
      signature,
    });
  } catch {
    return false;
  }
}

/**
 * Sign Permit2 PermitTransferFrom. No witness — the deterministic nonce
 * (payer-agnostic PaymentInfo hash) cryptographically binds all payment
 * parameters including the merchant address.
 */
export async function signPermit2(
  signer: ClientEvmSigner,
  permit: Permit2Payload["permit2Authorization"],
  chainId: number,
): Promise<`0x${string}`> {
  const domain = {
    name: "Permit2",
    chainId,
    verifyingContract: PERMIT2_ADDRESS,
  };

  const message = {
    permitted: {
      token: getAddress(permit.permitted.token),
      amount: BigInt(permit.permitted.amount),
    },
    spender: getAddress(permit.spender),
    nonce: BigInt(permit.nonce),
    deadline: BigInt(permit.deadline),
  };

  return signer.signTypedData({
    domain,
    types: PERMIT2_TRANSFER_FROM_TYPES,
    primaryType: "PermitTransferFrom",
    message,
  });
}

/**
 * Verify Permit2 PermitTransferFrom signature.
 */
export async function verifyPermit2Signature(
  signer: {
    verifyTypedData: (_args: {
      address: `0x${string}`;
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
      signature: `0x${string}`;
    }) => Promise<boolean>;
  },
  permit: Permit2Payload["permit2Authorization"],
  signature: `0x${string}`,
  chainId: number,
): Promise<boolean> {
  const domain = {
    name: "Permit2",
    chainId,
    verifyingContract: PERMIT2_ADDRESS,
  };

  const message = {
    permitted: {
      token: getAddress(permit.permitted.token),
      amount: BigInt(permit.permitted.amount),
    },
    spender: getAddress(permit.spender),
    nonce: BigInt(permit.nonce),
    deadline: BigInt(permit.deadline),
  };

  try {
    return await signer.verifyTypedData({
      address: getAddress(permit.from),
      domain,
      types: PERMIT2_TRANSFER_FROM_TYPES,
      primaryType: "PermitTransferFrom",
      message,
      signature,
    });
  } catch {
    return false;
  }
}

/**
 * Generate a fresh cryptographically-random 32-byte salt. MUST be called once
 * per signing request — never reuse across requests. Freshness is required
 * because the nonce derivation zeroes the payer field; identical extras with
 * the same salt would collide across payers.
 */
export function generateSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
