/**
 * AuthCapture (SVM) facilitator scheme.
 *
 * Verification rules (MUST list — see `scheme_authCapture_svm.md`):
 *
 *   1. Instruction layout: [ComputeBudget(2), ComputeBudget(3),
 *      auth_capture_escrow::{authorize|charge}, ...optional Lighthouse].
 *   2. Fee-payer safety: feePayer not in inner ix accounts; managed by us.
 *   3. Compute price <= 5 lamports/CU.
 *   4. Inner ix `paymentInfo.operator == extra.captureAuthorizer` (direct).
 *   5. PaymentInfo fields match `requirements` and `extra`.
 */

import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  parseSetComputeUnitLimitInstruction,
  parseSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  type Address,
} from "@solana/kit";
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { FacilitatorSvmSigner } from "@x402/svm";
import { decodeTransactionFromPayload } from "@x402/svm";

import { ESCROW_IX_DISC, PROGRAM_IDS } from "../shared/constants";
import {
  isAuthCaptureSvmExtra,
  isAuthCaptureSvmPayload,
  type AuthCaptureSvmExtra,
  type AuthCaptureSvmPayload,
} from "../shared/types";
import { parseSvmCluster } from "../shared/utils";
import { decodePaymentInfo } from "./decoder";

const MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 5n;
const LIGHTHOUSE_PROGRAM_ID = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95" as Address;

export class AuthCaptureSvmFacilitatorScheme implements SchemeNetworkFacilitator {
  readonly scheme = "authCapture";
  readonly caipFamily = "solana:*";

  constructor(private readonly signer: FacilitatorSvmSigner) {}

  getSigners(_network: string): string[] {
    return [...this.signer.getAddresses()];
  }

  getExtra(_network: string): Record<string, unknown> | undefined {
    const addresses = this.signer.getAddresses();
    const idx = Math.floor(Math.random() * addresses.length);
    return { feePayer: addresses[idx] };
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    if (payload.accepted.scheme !== "authCapture" || requirements.scheme !== "authCapture") {
      return { isValid: false, invalidReason: "unsupported_scheme", payer: "" };
    }
    if (payload.accepted.network !== requirements.network) {
      return { isValid: false, invalidReason: "network_mismatch", payer: "" };
    }
    if (!isAuthCaptureSvmPayload(payload.payload)) {
      return { isValid: false, invalidReason: "invalid_payload_format", payer: "" };
    }
    if (!isAuthCaptureSvmExtra(requirements.extra)) {
      return { isValid: false, invalidReason: "invalid_authCapture_extra", payer: "" };
    }
    const extra = requirements.extra as AuthCaptureSvmExtra;
    const wirePayload = payload.payload as AuthCaptureSvmPayload;

    const cluster = parseSvmCluster(requirements.network);
    const { authCaptureEscrow: escrowProgramId } = PROGRAM_IDS[cluster];

    const signerAddresses = this.signer.getAddresses().map(a => a.toString());
    if (!signerAddresses.includes(extra.feePayer)) {
      return { isValid: false, invalidReason: "fee_payer_not_managed_by_facilitator", payer: "" };
    }

    let transaction;
    try {
      transaction = decodeTransactionFromPayload(wirePayload);
    } catch {
      return {
        isValid: false,
        invalidReason: "invalid_authCapture_payload_could_not_be_decoded",
        payer: "",
      };
    }

    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    const decompiled = decompileTransactionMessage(compiled);
    const instructions = decompiled.instructions ?? [];

    if (instructions.length < 3 || instructions.length > 5) {
      return { isValid: false, invalidReason: "invalid_instruction_count", payer: "" };
    }
    try {
      verifyComputeLimit(instructions[0] as never);
      verifyComputePrice(instructions[1] as never);
    } catch (err) {
      return {
        isValid: false,
        invalidReason: err instanceof Error ? err.message : "compute_budget_check_failed",
        payer: "",
      };
    }

    const inner = instructions[2];
    if (inner.programAddress.toString() !== escrowProgramId) {
      return { isValid: false, invalidReason: "wrong_program_id", payer: "" };
    }

    for (let i = 3; i < instructions.length; i++) {
      if (instructions[i].programAddress.toString() !== LIGHTHOUSE_PROGRAM_ID) {
        return {
          isValid: false,
          invalidReason: `unknown_optional_instruction_${i}`,
          payer: "",
        };
      }
    }

    const data = inner.data ?? new Uint8Array();
    if (data.length < 8) {
      return { isValid: false, invalidReason: "inner_ix_data_too_short", payer: "" };
    }
    const disc = data.slice(0, 8);
    const expectedDisc =
      extra.autoCapture === true ? ESCROW_IX_DISC.charge : ESCROW_IX_DISC.authorize;
    if (!eqBytes(disc, expectedDisc)) {
      return { isValid: false, invalidReason: "inner_ix_disc_mismatch", payer: "" };
    }

    let parsed;
    try {
      parsed = decodePaymentInfo(data.slice(8));
    } catch {
      return { isValid: false, invalidReason: "invalid_payment_info_encoding", payer: "" };
    }

    const payer = parsed.info.payer;
    const mismatches = [
      parsed.info.operator !== extra.captureAuthorizer && "operator_mismatch",
      parsed.info.receiver !== requirements.payTo && "receiver_mismatch",
      parsed.info.mint !== requirements.asset && "mint_mismatch",
      parsed.info.maxAmount !== BigInt(requirements.amount) && "amount_mismatch",
      parsed.info.authorizationExpiry !== BigInt(extra.captureDeadline) &&
        "capture_deadline_mismatch",
      parsed.info.refundExpiry !== BigInt(extra.refundDeadline) && "refund_deadline_mismatch",
      parsed.info.minFeeBps !== extra.minFeeBps && "min_fee_bps_mismatch",
      parsed.info.maxFeeBps !== extra.maxFeeBps && "max_fee_bps_mismatch",
      parsed.info.feeReceiver !== extra.feeRecipient && "fee_receiver_mismatch",
    ].find(Boolean);
    if (mismatches) {
      return { isValid: false, invalidReason: mismatches as string, payer };
    }

    if ((inner.accounts ?? []).some(a => a.address.toString() === extra.feePayer)) {
      return { isValid: false, invalidReason: "fee_payer_in_inner_accounts", payer };
    }

    const now = BigInt(Math.floor(Date.now() / 1000));
    if (parsed.info.preApprovalExpiry <= now + 6n) {
      return { isValid: false, invalidReason: "authorization_expired", payer };
    }
    if (parsed.info.preApprovalExpiry > parsed.info.authorizationExpiry) {
      return { isValid: false, invalidReason: "invalid_deadline_ordering", payer };
    }

    try {
      const fullySigned = await this.signer.signTransaction(
        wirePayload.transaction,
        extra.feePayer,
        requirements.network,
      );
      await this.signer.simulateTransaction(fullySigned, requirements.network);
    } catch (err) {
      return {
        isValid: false,
        invalidReason: "transaction_simulation_failed",
        invalidMessage: err instanceof Error ? err.message : String(err),
        payer,
      };
    }

    return { isValid: true, payer };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const wirePayload = payload.payload as unknown as AuthCaptureSvmPayload;
    const v = await this.verify(payload, requirements);
    if (!v.isValid) {
      return {
        success: false,
        network: requirements.network,
        transaction: "",
        errorReason: v.invalidReason ?? "verification_failed",
        payer: v.payer || "",
      };
    }
    const extra = requirements.extra as unknown as AuthCaptureSvmExtra;
    try {
      const fullySigned = await this.signer.signTransaction(
        wirePayload.transaction,
        extra.feePayer,
        requirements.network,
      );
      const signature = await this.signer.sendTransaction(fullySigned, requirements.network);
      await this.signer.confirmTransaction(signature, requirements.network);
      return {
        success: true,
        transaction: signature,
        network: requirements.network,
        payer: v.payer,
      };
    } catch (err) {
      return {
        success: false,
        errorReason: err instanceof Error ? err.message : "transaction_failed",
        transaction: "",
        network: requirements.network,
        payer: v.payer || "",
      };
    }
  }
}

function verifyComputeLimit(ix: { programAddress: Address; data?: Readonly<Uint8Array> }) {
  if (
    ix.programAddress.toString() !== COMPUTE_BUDGET_PROGRAM_ADDRESS.toString() ||
    !ix.data ||
    ix.data[0] !== 2
  ) {
    throw new Error("invalid_compute_limit_instruction");
  }
  parseSetComputeUnitLimitInstruction(ix as never);
}

function verifyComputePrice(ix: { programAddress: Address; data?: Readonly<Uint8Array> }) {
  if (
    ix.programAddress.toString() !== COMPUTE_BUDGET_PROGRAM_ADDRESS.toString() ||
    !ix.data ||
    ix.data[0] !== 3
  ) {
    throw new Error("invalid_compute_price_instruction");
  }
  const parsed = parseSetComputeUnitPriceInstruction(ix as never) as unknown as {
    microLamports: bigint;
  };
  if (parsed.microLamports > MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS) {
    throw new Error("compute_price_too_high");
  }
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
