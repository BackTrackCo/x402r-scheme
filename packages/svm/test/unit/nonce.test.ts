import { describe, it, expect } from "vitest";
import { encodePaymentInfo, paymentInfoHash } from "../../src/authCapture/shared/nonce";
import { decodePaymentInfo } from "../../src/authCapture/facilitator/decoder";
import type { PaymentInfoSvm } from "../../src/authCapture/shared/types";

describe("encode/decode PaymentInfo round-trip", () => {
  // All addresses must decode to exactly 32 bytes. Mixed real-world fixtures:
  // System Program, Token Program, USDC mainnet, USDC devnet.
  const fixture: PaymentInfoSvm = {
    operator: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as never,
    payer: "11111111111111111111111111111111" as never,
    receiver: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as never,
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as never,
    maxAmount: 1_000_000n,
    preApprovalExpiry: 1_700_000_000n,
    authorizationExpiry: 1_700_001_000n,
    refundExpiry: 1_700_002_000n,
    minFeeBps: 0,
    maxFeeBps: 100,
    feeReceiver: "11111111111111111111111111111111" as never,
    salt: new Uint8Array(32),
  };

  it("Borsh round-trips", () => {
    const encoded = encodePaymentInfo(fixture);
    const { info } = decodePaymentInfo(encoded);
    expect(info.operator).toEqual(fixture.operator);
    expect(info.maxAmount).toEqual(fixture.maxAmount);
    expect(info.minFeeBps).toEqual(fixture.minFeeBps);
    expect(info.salt).toEqual(fixture.salt);
  });

  it("paymentInfoHash is deterministic and 32 bytes", () => {
    const h1 = paymentInfoHash(fixture);
    const h2 = paymentInfoHash(fixture);
    expect(h1).toEqual(h2);
    expect(h1.length).toEqual(32);
  });

  it("changing salt changes the hash", () => {
    const h1 = paymentInfoHash(fixture);
    const salt2 = new Uint8Array(32);
    salt2[0] = 1;
    const h2 = paymentInfoHash({ ...fixture, salt: salt2 });
    expect(h1).not.toEqual(h2);
  });

  it("encoded length matches the canonical PaymentInfo size", () => {
    const encoded = encodePaymentInfo(fixture);
    // 5 Pubkeys (operator, payer, receiver, mint, feeReceiver = 32 each)
    // + u64 maxAmount + 3 i64 expiries + 2 u16 fee-bps + 32 salt
    // = 160 + 8 + 24 + 4 + 32 = 228
    expect(encoded.length).toEqual(228);
  });
});
