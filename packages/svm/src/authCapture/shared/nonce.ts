/**
 * `payment_info_hash` derivation: SHA-256 of the canonical Borsh encoding
 * of the on-chain `PaymentInfo` struct. Same value the program computes
 * via `state::PaymentInfo::hash`.
 *
 * Cross-SDK invariant: every implementation MUST encode field-for-field in
 * the order declared in the program's `state.rs`.
 */

import type { Address } from "@solana/kit";
import { getAddressEncoder } from "@solana/kit";
import { sha256 } from "@noble/hashes/sha256";

import type { PaymentInfoSvm } from "./types";

export function encodePaymentInfo(info: PaymentInfoSvm): Uint8Array {
  const enc = getAddressEncoder();
  // @solana/kit's encoder returns a ReadonlyUint8Array; copy to a mutable
  // Uint8Array so concat's signature stays simple.
  const encAddr = (a: Parameters<typeof enc.encode>[0]) => new Uint8Array(enc.encode(a));
  const parts: Uint8Array[] = [];

  parts.push(encAddr(info.operator));
  parts.push(encAddr(info.payer));
  parts.push(encAddr(info.receiver));
  parts.push(encAddr(info.mint));
  parts.push(u64Le(info.maxAmount));
  parts.push(i64Le(info.preApprovalExpiry));
  parts.push(i64Le(info.authorizationExpiry));
  parts.push(i64Le(info.refundExpiry));
  parts.push(u16Le(info.minFeeBps));
  parts.push(u16Le(info.maxFeeBps));
  parts.push(encAddr(info.feeReceiver));
  if (info.salt.length !== 32) {
    throw new Error(`salt must be 32 bytes, got ${info.salt.length}`);
  }
  parts.push(info.salt);

  return concat(parts);
}

export function paymentInfoHash(info: PaymentInfoSvm): Uint8Array {
  return sha256(encodePaymentInfo(info));
}

/** Generate a fresh 32-byte salt. Never reuse across requests. */
export function generateSalt(): Uint8Array {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function u64Le(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(value), true);
  return buf;
}

function i64Le(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, BigInt(value), true);
  return buf;
}

function u16Le(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, true);
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

export type { Address };
