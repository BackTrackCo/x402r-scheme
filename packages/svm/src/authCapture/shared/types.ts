/**
 * authCapture (SVM) wire-format types.
 *
 * The SVM scheme is a faithful port of `base/commerce-payments`'s authCapture
 * primitives — escrow + token collectors. Spec-level field names
 * (`captureAuthorizer`, `captureDeadline`, `refundDeadline`, `feeRecipient`)
 * live here at the wire layer; the on-chain `PaymentInfo` struct uses
 * canonical commerce-payments-style names (`operator`, `authorization_expiry`,
 * `refund_expiry`, `fee_receiver`). The SDK translates before computing the
 * canonical Borsh hash.
 *
 * `paymentInfo.operator == extra.captureAuthorizer` directly — same shape as
 * EVM commerce-payments. Higher-level patterns (operator factories, slot
 * dispatch, condition/hook plugins) are x402r-specific extensions and live
 * outside this package.
 */

import type { Address } from "@solana/kit";

/** AuthCapture extra fields living in `PaymentRequirements.extra`. */
export interface AuthCaptureSvmExtra {
  /** Facilitator-supplied feePayer for the partial tx. SVM exact-scheme parity. */
  feePayer: Address;
  /** Auth-capture-escrow program ID for the cluster. */
  escrowProgramId: Address;
  /** Token collector program ID. The pilot ships only `spl-token-collector`. */
  collectorProgramId: Address;
  /** Pubkey authorized to call authorize/capture/void/refund/charge on the
   *  escrow. Committed on-chain as `paymentInfo.operator`. May be a wallet,
   *  a multisig, or a PDA of any external program. */
  captureAuthorizer: Address;
  /** Operator-fee receiver. Committed on-chain as `paymentInfo.fee_receiver`. */
  feeRecipient: Address;
  /** Absolute Unix seconds. */
  captureDeadline: number;
  /** Absolute Unix seconds. */
  refundDeadline: number;
  /** Bps, 0..10_000. */
  minFeeBps: number;
  /** Bps, 0..10_000. */
  maxFeeBps: number;
  /** Read from program state at requirements-build time. Immutable per-deploy. */
  protocolFeeBps: number;
  /** Read from program state at requirements-build time. Immutable per-deploy. */
  protocolFeeReceiver: Address;
  /** Default false → two-phase (authorize). true → single-shot (charge). */
  autoCapture?: boolean;
}

export function isAuthCaptureSvmExtra(value: unknown): value is AuthCaptureSvmExtra {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.feePayer === "string" &&
    typeof v.escrowProgramId === "string" &&
    typeof v.collectorProgramId === "string" &&
    typeof v.captureAuthorizer === "string" &&
    typeof v.feeRecipient === "string" &&
    typeof v.captureDeadline === "number" &&
    typeof v.refundDeadline === "number" &&
    typeof v.minFeeBps === "number" &&
    typeof v.maxFeeBps === "number" &&
    typeof v.protocolFeeBps === "number" &&
    typeof v.protocolFeeReceiver === "string"
  );
}

/** Wire payload — same shape as `exact-svm`. */
export interface AuthCaptureSvmPayload {
  /** Base64-encoded partial-signed Solana transaction. */
  transaction: string;
}

export function isAuthCaptureSvmPayload(value: unknown): value is AuthCaptureSvmPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.transaction === "string";
}

/** Splits entry as encoded into `charge`/`capture` ix data. */
export interface SplitEntry {
  recipient: Address;
  amount: bigint;
}

/**
 * On-chain `PaymentInfo` shape. Canonical primitive — no scheme-specific
 * fields, no slot arrays. The SDK encodes this via Borsh to derive
 * `payment_info_hash`.
 */
export interface PaymentInfoSvm {
  operator: Address; // = extra.captureAuthorizer
  payer: Address;
  receiver: Address;
  mint: Address;
  maxAmount: bigint;
  preApprovalExpiry: bigint;
  authorizationExpiry: bigint;
  refundExpiry: bigint;
  minFeeBps: number;
  maxFeeBps: number;
  feeReceiver: Address;
  /** 32 bytes. */
  salt: Uint8Array;
}
