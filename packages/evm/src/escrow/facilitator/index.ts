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
import {
  OPERATOR_ABI,
  ERC20_BALANCE_OF_ABI,
  ERC6492_MAGIC_VALUE,
} from "../../shared/constants.js";
import { verifyERC3009Signature } from "../../shared/nonce.js";
import {
  isEscrowPayload,
  isEscrowExtra,
} from "../../shared/types.js";
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
 * Extract inner signature from an EIP-6492 wrapped signature.
 * If the signature is not EIP-6492 wrapped, returns it unchanged.
 *
 * EIP-6492 format: abi.encode(address, bytes, bytes) ++ MAGIC_VALUE
 * The inner signature is the third ABI-encoded bytes field.
 */
function unwrapERC6492Signature(signature: `0x${string}`): `0x${string}` {
  // EIP-6492 magic is 32 bytes (64 hex chars) at the end
  if (signature.length <= 66) return signature; // Too short to be wrapped

  const magicSuffix = `0x${signature.slice(-64)}`;
  if (magicSuffix !== ERC6492_MAGIC_VALUE) return signature; // Not wrapped

  // Strip the magic suffix and ABI-decode: (address prepareTarget, bytes prepareData, bytes innerSignature)
  // The wrapped data (without magic) is: 0x + ABI-encoded (address, bytes, bytes)
  const wrappedHex = signature.slice(2, -64); // hex without 0x prefix and magic

  // ABI layout for (address, bytes, bytes):
  // word 0 (0-64): address (padded to 32 bytes)
  // word 1 (64-128): offset to prepareData bytes
  // word 2 (128-192): offset to innerSignature bytes
  // Then the dynamic data follows

  if (wrappedHex.length < 192) return signature; // Malformed

  const innerSigOffset = parseInt(wrappedHex.slice(128, 192), 16) * 2; // byte offset → hex offset
  if (innerSigOffset + 64 > wrappedHex.length) return signature; // Malformed

  const innerSigLength = parseInt(
    wrappedHex.slice(innerSigOffset, innerSigOffset + 64),
    16,
  ) * 2; // bytes → hex chars
  const innerSigStart = innerSigOffset + 64;

  if (innerSigStart + innerSigLength > wrappedHex.length) return signature; // Malformed

  return `0x${wrappedHex.slice(innerSigStart, innerSigStart + innerSigLength)}` as `0x${string}`;
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

  // C4: name/version now come from server's parsePrice() via AssetAmount.extra.
  // The facilitator should not hardcode token-specific metadata.
  getExtra(_network: string): Record<string, unknown> | undefined {
    return undefined;
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    // M5: Type guard instead of double cast
    if (!isEscrowPayload(payload.payload)) {
      return {
        isValid: false,
        invalidReason: "invalid_payload_format",
      };
    }
    const escrowPayload = payload.payload as EscrowPayload;
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

    // M5: Type guard for extra
    if (!isEscrowExtra(requirements.extra)) {
      return {
        isValid: false,
        invalidReason: "invalid_escrow_extra",
        payer,
      };
    }
    const extra = requirements.extra as EscrowExtra;
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

    // M4: Extract inner signature for verification if EIP-6492 wrapped.
    // The contract's ERC6492SignatureHandler handles deployment; the facilitator
    // only needs the inner ECDSA signature for ecrecover verification.
    const signatureForVerify = unwrapERC6492Signature(escrowPayload.signature);

    // Verify ERC-3009 signature
    const isValidSignature = await verifyERC3009Signature(
      this.signer,
      escrowPayload.authorization,
      signatureForVerify,
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

    // H4: Balance check — verify payer has sufficient token balance
    try {
      const balance = await this.signer.readContract({
        address: requirements.asset as `0x${string}`,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [payer],
      });

      if (BigInt(balance as string) < BigInt(requirements.amount)) {
        return {
          isValid: false,
          invalidReason: "insufficient_balance",
          payer,
        };
      }
    } catch {
      // If balance check fails (e.g., non-standard token), skip it.
      // The on-chain transaction will fail anyway if balance is insufficient.
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
    // H2: Re-verify before settling to catch expired/invalid payloads
    const verification = await this.verify(payload, requirements);
    if (!verification.isValid) {
      return {
        success: false,
        errorReason: verification.invalidReason ?? "verification_failed",
        transaction: "",
        network: requirements.network,
        payer: verification.payer,
      };
    }

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

    // Pass raw signature — ERC3009PaymentCollector/ERC6492SignatureHandler
    // handles EIP-6492 unwrapping and wallet deployment on-chain
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

      // Wait for transaction confirmation with 60s timeout to avoid hanging on stuck txs
      const receiptPromise = this.signer.waitForTransactionReceipt({
        hash: txHash,
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Transaction receipt timeout after 60s")),
          60_000,
        ),
      );
      const receipt = await Promise.race([receiptPromise, timeoutPromise]);

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
