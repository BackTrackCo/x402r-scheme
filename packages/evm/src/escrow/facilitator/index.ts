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
 * Configuration for escrow facilitator metadata exposed via getExtra()
 */
export interface EscrowFacilitatorConfig {
  operatorAddress: `0x${string}`;
  escrowAddress: `0x${string}`;
  tokenCollector: `0x${string}`;
  minFeeBps?: number;
  maxFeeBps?: number;
}

/**
 * Escrow Facilitator Scheme - implements x402's SchemeNetworkFacilitator
 */
export class EscrowFacilitatorScheme implements SchemeNetworkFacilitator {
  readonly scheme = "escrow";
  readonly caipFamily = "eip155:*";

  constructor(
    private signer: FacilitatorEvmSigner,
    private escrowConfig?: EscrowFacilitatorConfig,
  ) {}

  getSigners(_network: string): string[] {
    return [...this.signer.getAddresses()];
  }

  getExtra(_network: string): Record<string, unknown> | undefined {
    if (!this.escrowConfig) return undefined;
    return {
      escrowAddress: this.escrowConfig.escrowAddress,
      operatorAddress: this.escrowConfig.operatorAddress,
      tokenCollector: this.escrowConfig.tokenCollector,
      minFeeBps: this.escrowConfig.minFeeBps ?? 0,
      maxFeeBps: this.escrowConfig.maxFeeBps ?? 1000,
      name: "USDC",
      version: "2",
    };
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const escrowPayload = payload.payload as unknown as EscrowPayload;
    const extra = requirements.extra as unknown as EscrowExtra;
    const chainId = parseChainId(requirements.network);

    // Verify ERC-3009 signature
    const isValidSignature = await verifyERC3009Signature(
      this.signer,
      escrowPayload.authorization,
      escrowPayload.signature,
      { ...extra, chainId },
      requirements.asset as `0x${string}`,
    );

    if (!isValidSignature) {
      return { isValid: false, invalidReason: "Invalid ERC-3009 signature" };
    }

    // Verify amount meets requirements
    if (
      BigInt(escrowPayload.authorization.value) <
      BigInt(requirements.amount)
    ) {
      return { isValid: false, invalidReason: "Insufficient payment amount" };
    }

    // Verify token matches
    if (
      escrowPayload.paymentInfo.token.toLowerCase() !==
      requirements.asset.toLowerCase()
    ) {
      return { isValid: false, invalidReason: "Token mismatch" };
    }

    // Verify receiver matches
    if (
      escrowPayload.paymentInfo.receiver.toLowerCase() !==
      requirements.payTo.toLowerCase()
    ) {
      return { isValid: false, invalidReason: "Receiver mismatch" };
    }

    return {
      isValid: true,
      payer: escrowPayload.authorization.from,
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
 * @example
 * ```typescript
 * const facilitator = new x402Facilitator();
 * registerEscrowScheme(facilitator, {
 *   signer: evmSigner,
 *   networks: "eip155:84532",
 *   operatorAddress: "0x...",
 *   escrowAddress: "0x...",
 *   tokenCollector: "0x...",
 * });
 * ```
 */
export function registerEscrowScheme(
  facilitator: x402Facilitator,
  config: {
    signer: FacilitatorEvmSigner;
    networks: Network | Network[];
    operatorAddress?: `0x${string}`;
    escrowAddress?: `0x${string}`;
    tokenCollector?: `0x${string}`;
    minFeeBps?: number;
    maxFeeBps?: number;
  },
): x402Facilitator {
  const escrowConfig =
    config.operatorAddress && config.escrowAddress && config.tokenCollector
      ? {
          operatorAddress: config.operatorAddress,
          escrowAddress: config.escrowAddress,
          tokenCollector: config.tokenCollector,
          minFeeBps: config.minFeeBps,
          maxFeeBps: config.maxFeeBps,
        }
      : undefined;
  facilitator.register(
    config.networks,
    new EscrowFacilitatorScheme(config.signer, escrowConfig),
  );
  return facilitator;
}

export type { EscrowExtra, EscrowPayload } from "../../shared/types.js";
