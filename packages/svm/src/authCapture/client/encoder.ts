/**
 * Hand-rolled instruction encoders for `auth_capture_escrow.{authorize,charge}`.
 *
 * Replace with Codama-generated builders once `pnpm codama:generate` runs.
 *
 * Inner ixs call escrow directly (mirrors the EVM scheme: client signs an
 * authorization, facilitator submits to escrow). The escrow internally CPIs
 * into the configured `ITokenCollector` for the actual SPL transfer. No
 * intermediate operator program — `paymentInfo.operator` is whatever pubkey
 * the merchant chose, signed-as via the partial-tx by either the
 * captureAuthorizer themselves (typical: facilitator-as-captureAuthorizer)
 * or by an external program (out-of-scope x402r extension).
 */

import type { Address, Instruction } from "@solana/kit";
import { getAddressEncoder } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { ESCROW_IX_DISC } from "../shared/constants";
import { encodePaymentInfo } from "../shared/nonce";
import type { AuthCaptureSvmExtra, PaymentInfoSvm, SplitEntry } from "../shared/types";

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111" as Address;
const ASSOC_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;

interface AuthorizeAccs {
  operator: Address;
  paymentStatePda: Address;
  vaultAta: Address;
  payerAta: Address;
  mint: Address;
  payer: Address;
  rentPayer: Address;
}

interface ChargeAccs extends AuthorizeAccs {
  receiverAta: Address;
  receiver: Address;
  protocolFeeReceiverAta: Address;
  protocolFeeReceiver: Address;
  operatorFeeReceiverAta: Address;
  operatorFeeReceiver: Address;
  protocolFeeConfigPda: Address;
}

/** Encode `auth_capture_escrow::authorize`. */
export function encodeEscrowAuthorizeIx(args: {
  paymentInfo: PaymentInfoSvm;
  amount: bigint;
  collectorData: Uint8Array;
  extra: AuthCaptureSvmExtra;
  accounts: AuthorizeAccs;
}): Instruction {
  const data = concat([
    ESCROW_IX_DISC.authorize,
    encodePaymentInfo(args.paymentInfo),
    u64Le(args.amount),
    vecLen(args.collectorData.length),
    args.collectorData,
  ]);

  const a = args.accounts;
  // Escrow `Authorize` named accounts; collector accounts come after as
  // remaining_accounts (the escrow forwards them unchanged to the collector).
  const accounts = [
    meta(a.operator, false, true),
    meta(a.paymentStatePda, true, false),
    meta(a.vaultAta, true, false),
    meta(a.mint, false, false),
    meta(a.rentPayer, true, true),
    meta(args.extra.collectorProgramId, false, false),
    meta(TOKEN_PROGRAM_ADDRESS, false, false),
    meta(ASSOC_TOKEN_PROGRAM_ID, false, false),
    meta(SYSTEM_PROGRAM_ID, false, false),
    // --- collector accounts (CollectAuthorize) ---
    meta(a.payerAta, true, false),
    meta(a.vaultAta, true, false),
    meta(a.payer, false, true),
    meta(a.mint, false, false),
    meta(TOKEN_PROGRAM_ADDRESS, false, false),
  ];

  return {
    programAddress: args.extra.escrowProgramId,
    accounts,
    data,
  };
}

/** Encode `auth_capture_escrow::charge`. */
export function encodeEscrowChargeIx(args: {
  paymentInfo: PaymentInfoSvm;
  amount: bigint;
  splits: SplitEntry[];
  collectorData: Uint8Array;
  extra: AuthCaptureSvmExtra;
  accounts: ChargeAccs;
}): Instruction {
  const data = concat([
    ESCROW_IX_DISC.charge,
    encodePaymentInfo(args.paymentInfo),
    u64Le(args.amount),
    encodeSplits(args.splits),
    vecLen(args.collectorData.length),
    args.collectorData,
  ]);

  const a = args.accounts;
  const accounts = [
    meta(a.operator, false, true),
    meta(a.paymentStatePda, true, false),
    meta(a.vaultAta, true, false),
    meta(a.receiverAta, true, false),
    meta(a.receiver, false, false),
    meta(a.protocolFeeReceiverAta, true, false),
    meta(a.protocolFeeReceiver, false, false),
    meta(a.operatorFeeReceiverAta, true, false),
    meta(a.operatorFeeReceiver, false, false),
    meta(a.protocolFeeConfigPda, false, false),
    meta(a.mint, false, false),
    meta(a.rentPayer, true, true),
    meta(args.extra.collectorProgramId, false, false),
    meta(TOKEN_PROGRAM_ADDRESS, false, false),
    meta(ASSOC_TOKEN_PROGRAM_ID, false, false),
    meta(SYSTEM_PROGRAM_ID, false, false),
    // --- collector accounts ---
    meta(a.payerAta, true, false),
    meta(a.vaultAta, true, false),
    meta(a.payer, false, true),
    meta(a.mint, false, false),
    meta(TOKEN_PROGRAM_ADDRESS, false, false),
  ];

  return {
    programAddress: args.extra.escrowProgramId,
    accounts,
    data,
  };
}

function meta(address: Address, isWritable: boolean, isSigner: boolean) {
  return { address, role: roleFor(isWritable, isSigner) };
}

function roleFor(writable: boolean, signer: boolean): 0 | 1 | 2 | 3 {
  if (writable && signer) return 3;
  if (writable) return 2;
  if (signer) return 1;
  return 0;
}

function encodeSplits(splits: SplitEntry[]): Uint8Array {
  const enc = getAddressEncoder();
  const parts: Uint8Array[] = [vecLen(splits.length)];
  for (const e of splits) {
    parts.push(new Uint8Array(enc.encode(e.recipient)));
    parts.push(u64Le(e.amount));
  }
  return concat(parts);
}

function u64Le(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(value), true);
  return buf;
}

function vecLen(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n, true);
  return buf;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
