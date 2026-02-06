/**
 * Escrow Scheme - Client
 * Creates payment payloads for escrow payments
 */

import type { WalletClient } from "viem";
import {
  computeEscrowNonce,
  signERC3009,
  generateSalt,
} from "../../shared/nonce.js";
import { MAX_UINT48 } from "../../shared/constants.js";
import type { EscrowExtra, EscrowPayload } from "../../shared/types.js";

export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  extra: EscrowExtra;
}

/**
 * Create an escrow payment payload from payment requirements
 */
export async function createPaymentPayload(
  requirements: PaymentRequirements,
  wallet: WalletClient,
): Promise<EscrowPayload> {
  const {
    escrowAddress,
    operatorAddress,
    tokenCollector,
    minFeeBps = 0,
    maxFeeBps = 0,
    feeReceiver,
    preApprovalExpirySeconds,
    refundExpirySeconds,
    authorizationExpirySeconds,
  } = requirements.extra;

  const chainId = await wallet.getChainId();
  const maxAmount = requirements.amount;

  const paymentInfo = {
    operator: operatorAddress,
    receiver: requirements.payTo,
    token: requirements.asset,
    maxAmount,
    preApprovalExpiry: preApprovalExpirySeconds ?? MAX_UINT48,
    authorizationExpiry: authorizationExpirySeconds ?? MAX_UINT48,
    refundExpiry: refundExpirySeconds ?? MAX_UINT48,
    minFeeBps,
    maxFeeBps,
    feeReceiver: feeReceiver ?? operatorAddress,
    salt: generateSalt(),
  };

  const nonce = computeEscrowNonce(chainId, escrowAddress, paymentInfo);

  // ERC-3009 authorization - validBefore MUST match what contract passes to receiveWithAuthorization
  // The contract uses paymentInfo.preApprovalExpiry as validBefore
  const authorization = {
    from: wallet.account!.address,
    to: tokenCollector,
    value: maxAmount,
    validAfter: "0",
    validBefore: String(paymentInfo.preApprovalExpiry),
    nonce,
  };

  const signature = await signERC3009(
    wallet,
    authorization,
    requirements.extra,
    requirements.asset,
  );

  return { authorization, signature, paymentInfo };
}

export const EscrowScheme = {
  scheme: "escrow" as const,
  createPaymentPayload,
};

export type { EscrowExtra, EscrowPayload } from "../../shared/types.js";
