/**
 * Borsh decoder for the on-chain `PaymentInfo` (slim — no slot arrays).
 * Inverse of `shared/nonce.ts::encodePaymentInfo`.
 */

import { getAddressDecoder, type Address } from "@solana/kit";
import type { PaymentInfoSvm } from "../shared/types";

const ADDR = getAddressDecoder();

export function decodePaymentInfo(buf: Uint8Array): {
  info: PaymentInfoSvm;
  bytesConsumed: number;
} {
  const r = new Reader(buf);
  const operator = r.address();
  const payer = r.address();
  const receiver = r.address();
  const mint = r.address();
  const maxAmount = r.u64();
  const preApprovalExpiry = r.i64();
  const authorizationExpiry = r.i64();
  const refundExpiry = r.i64();
  const minFeeBps = r.u16();
  const maxFeeBps = r.u16();
  const feeReceiver = r.address();
  const salt = r.bytes(32);
  return {
    info: {
      operator,
      payer,
      receiver,
      mint,
      maxAmount,
      preApprovalExpiry,
      authorizationExpiry,
      refundExpiry,
      minFeeBps,
      maxFeeBps,
      feeReceiver,
      salt,
    },
    bytesConsumed: r.cursor,
  };
}

class Reader {
  cursor = 0;
  view: DataView;

  constructor(public buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  bytes(len: number): Uint8Array {
    const out = this.buf.slice(this.cursor, this.cursor + len);
    if (out.length !== len) throw new Error("buffer underrun");
    this.cursor += len;
    return out;
  }

  address(): Address {
    return ADDR.decode(this.bytes(32));
  }

  u16(): number {
    const v = this.view.getUint16(this.cursor, true);
    this.cursor += 2;
    return v;
  }

  u64(): bigint {
    const v = this.view.getBigUint64(this.cursor, true);
    this.cursor += 8;
    return v;
  }

  i64(): bigint {
    const v = this.view.getBigInt64(this.cursor, true);
    this.cursor += 8;
    return v;
  }
}
