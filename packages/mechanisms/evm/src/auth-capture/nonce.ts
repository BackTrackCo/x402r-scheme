/**
 * Nonce computation and signature-verification helpers.
 *
 * Client-side signing lives upstream in `@x402/evm/auth-capture/client`; this
 * module keeps the facilitator-side pieces — the payer-agnostic PaymentInfo
 * hash and the ERC-3009 / Permit2 signature verifiers.
 */

import { encodeAbiParameters, getAddress, keccak256, zeroAddress } from "viem";
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
 * Compute the payer-agnostic PaymentInfo hash that auth-capture uses as both
 * the ERC-3009 nonce (`bytes32`) and the Permit2 nonce (`uint256`, via the
 * same 32 bytes interpreted as an integer). The payer field is zeroed before
 * hashing so the facilitator can reconstruct the same hash on the verify side
 * without knowing payer identity in advance.
 *
 * Freshness comes from `paymentInfo.salt` — a fresh salt per signing call.
 * Identical extras + same salt would collide across payers.
 *
 * @param chainId - EVM chain id; binds the hash to a specific chain.
 * @param paymentInfo - The reconstructed PaymentInfo struct (canonical Solidity field names).
 * @returns The 32-byte hash to use as the nonce on the wire.
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
 * Verify an ERC-3009 `ReceiveWithAuthorization` signature against the supplied
 * authorization fields. The EIP-712 domain is bound to the **token contract**,
 * with `name`/`version` from `extra` (they vary per asset, e.g. `"USDC"` on
 * Sepolia vs `"USD Coin"` on mainnet). Wraps errors
 * (smart-wallet `isValidSignature` reverts, EIP-6492 issues) and returns false
 * rather than throwing.
 *
 * @param signer - Facilitator-side verifier with `verifyTypedData`.
 * @param signer.verifyTypedData - Method that recovers and validates the typed-data signature.
 * @param authorization - The ERC-3009 authorization to verify.
 * @param signature - The signature blob from the payer.
 * @param extra - Carries the token EIP-712 domain `name`, `version`, and the chain id.
 * @param tokenAddress - Address of the token contract (verifyingContract in the domain).
 * @returns True if the signature recovers to `authorization.from`; false on any error.
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
 * Verify a Permit2 `PermitTransferFrom` signature against the supplied permit
 * fields. The EIP-712 domain is bound to the canonical Permit2 contract. Wraps
 * errors and returns false rather than throwing.
 *
 * @param signer - Facilitator-side verifier with `verifyTypedData`.
 * @param signer.verifyTypedData - Method that recovers and validates the typed-data signature.
 * @param permit - The Permit2 PermitTransferFrom message to verify.
 * @param signature - The signature blob from the payer.
 * @param chainId - EVM chain id (chainId in the Permit2 domain).
 * @returns True if the signature recovers to `permit.from`; false on any error.
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
