/**
 * PDA derivation helpers for `auth-capture-escrow`. Replace the bodies with
 * Codama-generated `findXxxPda` helpers once `pnpm codama:generate` runs in
 * the contracts repo — the signatures here mirror what Codama emits so
 * consumers don't have to change.
 */

import type { Address } from "@solana/kit";
import { SEEDS } from "./constants";

/**
 * Stub: derive `[b"payment", payment_info_hash]` under the
 * `auth-capture-escrow` program.
 */
export async function findPaymentStatePda(
  _escrowProgramId: Address,
  _paymentInfoHash: Uint8Array,
): Promise<[Address, number]> {
  throw new Error("stub: replace with Codama-generated findPaymentStatePda");
}

/**
 * Stub: derive `[b"protocol-fee-config"]` under the `auth-capture-escrow`
 * program.
 */
export async function findProtocolFeeConfigPda(
  _escrowProgramId: Address,
): Promise<[Address, number]> {
  throw new Error("stub: replace with Codama-generated findProtocolFeeConfigPda");
}

void SEEDS;
