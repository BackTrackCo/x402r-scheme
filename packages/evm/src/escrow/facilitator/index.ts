/**
 * Escrow Scheme - Facilitator
 * Handles verification and settlement of escrow payments.
 *
 * Implements x402's SchemeNetworkFacilitator interface so the escrow scheme
 * is a drop-in for the x402 facilitator, just like ExactEvmScheme.
 */

import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { x402Facilitator } from "@x402/core/facilitator";
import { OPERATOR_ABI } from "../../shared/constants.js";
import { verifyERC3009Signature } from "../../shared/nonce.js";
import type { EscrowExtra, EscrowPayload } from "../../shared/types.js";

/**
 * Parse chainId from CAIP-2 network identifier
 * @param network - CAIP-2 network identifier (e.g., 'eip155:84532')
 * @returns The chain ID as a number
 */
function parseChainId(network: string): number {
  const parts = network.split(":");
  if (parts.length !== 2 || parts[0] !== "eip155") {
    throw new Error(
      `Invalid network format: ${network}. Expected 'eip155:<chainId>'`,
    );
  }
  const chainId = parseInt(parts[1], 10);
  if (isNaN(chainId)) {
    throw new Error(`Invalid chainId in network: ${network}`);
  }
  return chainId;
}

/**
 * Escrow Facilitator Scheme - implements x402's SchemeNetworkFacilitator
 *
 * The facilitator is operator-agnostic: it does not store operator/escrow/tokenCollector
 * config. Those values are set by the merchant via `refundable()` and arrive in
 * `requirements.extra` at verify/settle time.
 */
export class EscrowFacilitatorScheme implements SchemeNetworkFacilitator {
  readonly scheme = "escrow";
  readonly caipFamily = "eip155:*";

  constructor(private signer: FacilitatorEvmSigner) {}

  getSigners(_network: string): string[] {
    return [...this.signer.getAddresses()];
  }

  getExtra(_network: string): Record<string, unknown> {
    return { name: "USDC", version: "2" };
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const escrowPayload = payload.payload as unknown as EscrowPayload;
    const payer = escrowPayload.authorization.from;

    // Validate scheme
    if (requirements.scheme !== "escrow") {
      return {
        isValid: false,
        invalidReason: "unsupported_scheme",
        payer,
      };
    }

    // Validate network format
    const networkParts = requirements.network.split(":");
    if (networkParts.length !== 2 || networkParts[0] !== "eip155") {
      return {
        isValid: false,
        invalidReason: "invalid_network",
        payer,
      };
    }

    const extra = requirements.extra as unknown as EscrowExtra;
    const chainId = parseChainId(requirements.network);

    // Time window validation
    const now = Math.floor(Date.now() / 1000);
    const validBefore = Number(escrowPayload.authorization.validBefore);
    const validAfter = Number(escrowPayload.authorization.validAfter);

    if (validBefore <= now + 6) {
      return {
        isValid: false,
        invalidReason: "authorization_expired",
        payer,
      };
    }

    if (validAfter > now) {
      return {
        isValid: false,
        invalidReason: "authorization_not_yet_valid",
        payer,
      };
    }

    // Verify ERC-3009 signature
    const isValidSignature = await verifyERC3009Signature(
      this.signer,
      escrowPayload.authorization,
      escrowPayload.signature,
      { ...extra, chainId },
      requirements.asset as `0x${string}`,
    );

    if (!isValidSignature) {
      return {
        isValid: false,
        invalidReason: "invalid_escrow_signature",
        payer,
      };
    }

    // Verify amount meets requirements
    if (
      BigInt(escrowPayload.authorization.value) <
      BigInt(requirements.amount)
    ) {
      return {
        isValid: false,
        invalidReason: "insufficient_amount",
        payer,
      };
    }

    // Verify token matches
    if (
      escrowPayload.paymentInfo.token.toLowerCase() !==
      requirements.asset.toLowerCase()
    ) {
      return {
        isValid: false,
        invalidReason: "token_mismatch",
        payer,
      };
    }

    // Verify receiver matches
    if (
      escrowPayload.paymentInfo.receiver.toLowerCase() !==
      requirements.payTo.toLowerCase()
    ) {
      return {
        isValid: false,
        invalidReason: "receiver_mismatch",
        payer,
      };
    }

    return {
      isValid: true,
      payer,
    };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const escrowPayload = payload.payload as unknown as EscrowPayload;
    const extra = requirements.extra as unknown as EscrowExtra;
    const { authorizeAddress, operatorAddress, tokenCollector } = extra;

    const paymentInfo = {
      operator: escrowPayload.paymentInfo.operator,
      payer: escrowPayload.authorization.from,
      receiver: escrowPayload.paymentInfo.receiver,
      token: escrowPayload.paymentInfo.token,
      maxAmount: BigInt(escrowPayload.paymentInfo.maxAmount),
      preApprovalExpiry: escrowPayload.paymentInfo.preApprovalExpiry,
      authorizationExpiry: escrowPayload.paymentInfo.authorizationExpiry,
      refundExpiry: escrowPayload.paymentInfo.refundExpiry,
      minFeeBps: escrowPayload.paymentInfo.minFeeBps,
      maxFeeBps: escrowPayload.paymentInfo.maxFeeBps,
      feeReceiver: escrowPayload.paymentInfo.feeReceiver,
      salt: BigInt(escrowPayload.paymentInfo.salt),
    };

    // Pass raw signature - ERC3009PaymentCollector expects raw bytes, not ABI-encoded
    const collectorData = escrowPayload.signature;

    const target = authorizeAddress ?? operatorAddress;

    try {
      const txHash = await this.signer.writeContract({
        address: target,
        abi: OPERATOR_ABI,
        functionName: "authorize",
        args: [
          paymentInfo,
          BigInt(escrowPayload.authorization.value),
          tokenCollector,
          collectorData,
        ],
      });

      // Wait for transaction confirmation
      const receipt = await this.signer.waitForTransactionReceipt({
        hash: txHash,
      });

      if (receipt.status !== "success") {
        return {
          success: false,
          errorReason: "transaction_reverted",
          transaction: txHash,
          network: requirements.network,
          payer: escrowPayload.authorization.from,
        };
      }

      return {
        success: true,
        transaction: txHash,
        network: requirements.network,
        payer: escrowPayload.authorization.from,
      };
    } catch (error) {
      return {
        success: false,
        errorReason:
          error instanceof Error ? error.message : "Settlement failed",
        transaction: "",
        network: requirements.network,
        payer: escrowPayload.authorization.from,
      };
    }
  }
}

/**
 * Register escrow scheme with x402Facilitator
 *
 * The facilitator is operator-agnostic — it supports any operator. Operator,
 * escrow, and tokenCollector addresses are provided per-request by the merchant
 * via `refundable()` and arrive in `requirements.extra`.
 *
 * @example
 * ```typescript
 * const facilitator = new x402Facilitator();
 * registerEscrowScheme(facilitator, {
 *   signer: evmSigner,
 *   networks: "eip155:84532",
 * });
 * ```
 */
export function registerEscrowScheme(
  facilitator: x402Facilitator,
  config: {
    signer: FacilitatorEvmSigner;
    networks: Network | Network[];
  },
): x402Facilitator {
  facilitator.register(
    config.networks,
    new EscrowFacilitatorScheme(config.signer),
  );
  return facilitator;
}

export type { EscrowExtra, EscrowPayload } from "../../shared/types.js";
