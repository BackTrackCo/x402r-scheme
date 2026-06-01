/**
 * Compatibility guard for the upstream auth-capture client.
 *
 * The client-side signing scheme is not implemented here — it lives upstream
 * in `@x402/evm/auth-capture/client`. That means there are two copies of the
 * payer-agnostic hash + EIP-712 signing logic: upstream's (inside the client)
 * and ours (`nonce.ts`, used by the facilitator's `verify`). They MUST stay
 * byte-compatible or the facilitator will reject payloads its own clients
 * produce.
 *
 * These tests are that gate. They drive the upstream client with a real signer
 * and assert, using only our local helpers, that:
 *   1. the wire payload still satisfies our type guards,
 *   2. the collector addresses match our canonical constants,
 *   3. the ERC-3009 nonce equals our `computePayerAgnosticPaymentInfoHash`,
 *   4. the signature recovers under the exact domain our facilitator verifies.
 *
 * No RPC — signatures are EOA, recovered offline. If a future @x402/evm bump
 * changes an address or the hash construction, this suite fails loudly before
 * the divergence reaches the facilitator. The full client→facilitator→escrow
 * path is additionally exercised in test/integrations.
 */
import { describe, it, expect } from "vitest";
import { hexToBigInt, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
// The client lives upstream; the facilitator-side verification it must stay
// compatible with lives in this package (nonce.ts).
import { AuthCaptureEvmScheme } from "@x402/evm/auth-capture/client";
import {
  EIP3009_TOKEN_COLLECTOR_ADDRESS,
  PERMIT2_ADDRESS,
  PERMIT2_TOKEN_COLLECTOR_ADDRESS,
} from "../../../src/auth-capture/constants";
import {
  computePayerAgnosticPaymentInfoHash,
  verifyERC3009Signature,
  verifyPermit2Signature,
} from "../../../src/auth-capture/nonce";
import { isEip3009Payload, isPermit2Payload } from "../../../src/auth-capture/types";
import type {
  AuthCaptureExtra,
  Eip3009Payload,
  PaymentInfoStruct,
  Permit2Payload,
} from "../../../src/auth-capture/types";

// Deterministic test signer (well-known anvil key #0). EOA → offline recovery.
const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const account = privateKeyToAccount(PRIVATE_KEY);

const CHAIN_ID = 84532;
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

const extra: AuthCaptureExtra = {
  captureAuthorizer: "0xcccccccccccccccccccccccccccccccccccccccc",
  captureDeadline: FUTURE,
  refundDeadline: FUTURE + 86400,
  feeRecipient: "0x4444444444444444444444444444444444444444",
  minFeeBps: 0,
  maxFeeBps: 100,
  name: "USDC",
  version: "2",
};

const requirements = {
  scheme: "auth-capture",
  network: `eip155:${CHAIN_ID}`,
  amount: "1000000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x1234567890123456789012345678901234567890",
  maxTimeoutSeconds: 3600,
  extra,
};

// A verifyTypedData backed by offline ECDSA recovery — no PublicClient needed.
const offlineVerifier = {
  verifyTypedData: async (args: {
    address: `0x${string}`;
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: `0x${string}`;
  }): Promise<boolean> => {
    const recovered = await recoverTypedDataAddress({
      domain: args.domain as Parameters<typeof recoverTypedDataAddress>[0]["domain"],
      types: args.types as Parameters<typeof recoverTypedDataAddress>[0]["types"],
      primaryType: args.primaryType,
      message: args.message,
      signature: args.signature,
    });
    return recovered.toLowerCase() === args.address.toLowerCase();
  },
};

// Rebuild the PaymentInfo struct the way the client does, reading the
// signing-time `preApprovalExpiry` and `salt` back off the wire payload so the
// hash is reconstructed deterministically (no clock dependency).
function reconstructPaymentInfo(preApprovalExpiry: number, salt: `0x${string}`): PaymentInfoStruct {
  return {
    operator: extra.captureAuthorizer,
    payer: account.address,
    receiver: requirements.payTo as `0x${string}`,
    token: requirements.asset as `0x${string}`,
    maxAmount: requirements.amount,
    preApprovalExpiry,
    authorizationExpiry: extra.captureDeadline,
    refundExpiry: extra.refundDeadline,
    minFeeBps: extra.minFeeBps,
    maxFeeBps: extra.maxFeeBps,
    feeReceiver: extra.feeRecipient,
    salt,
  };
}

describe("upstream auth-capture client compatibility", () => {
  it("exposes a scheme tagged 'auth-capture'", () => {
    expect(new AuthCaptureEvmScheme(account).scheme).toBe("auth-capture");
  });

  describe("ERC-3009 (default)", () => {
    it("produces a payload our facilitator can verify", async () => {
      const scheme = new AuthCaptureEvmScheme(account);
      const result = await scheme.createPaymentPayload(2, requirements);

      expect(result.x402Version).toBe(2);
      expect(isEip3009Payload(result.payload)).toBe(true);

      const payload = result.payload as unknown as Eip3009Payload;
      const preApprovalExpiry = Number(payload.authorization.validBefore);

      // (2) collector address matches our canonical constant
      expect(payload.authorization.to).toBe(EIP3009_TOKEN_COLLECTOR_ADDRESS);

      // amount + window are not bound by the nonce hash and are read back off the
      // signed payload, so assert them explicitly — a wrong-but-self-consistent
      // value would otherwise pass nonce + signature checks undetected.
      expect(payload.authorization.value).toBe(requirements.amount);
      expect(payload.authorization.validAfter).toBe("0");

      // (3) the wire nonce equals OUR payer-agnostic hash for the same struct
      const paymentInfo = reconstructPaymentInfo(preApprovalExpiry, payload.salt);
      const expectedNonce = computePayerAgnosticPaymentInfoHash(CHAIN_ID, paymentInfo);
      expect(payload.authorization.nonce).toBe(expectedNonce);

      // (4) the signature recovers under the exact domain our facilitator uses
      const ok = await verifyERC3009Signature(
        offlineVerifier,
        payload.authorization,
        payload.signature,
        { ...extra, chainId: CHAIN_ID },
        requirements.asset as `0x${string}`,
      );
      expect(ok).toBe(true);
    });
  });

  describe("Permit2", () => {
    it("produces a payload our facilitator can verify", async () => {
      const scheme = new AuthCaptureEvmScheme(account);
      const result = await scheme.createPaymentPayload(2, {
        ...requirements,
        extra: { ...extra, assetTransferMethod: "permit2" as const },
      });

      expect(isPermit2Payload(result.payload)).toBe(true);

      const payload = result.payload as unknown as Permit2Payload;
      const preApprovalExpiry = Number(payload.permit2Authorization.deadline);

      // (2) collector address matches our canonical constant
      expect(payload.permit2Authorization.spender).toBe(PERMIT2_TOKEN_COLLECTOR_ADDRESS);

      // amount is not bound by the nonce hash — assert it explicitly (see ERC-3009 note)
      expect(payload.permit2Authorization.permitted.token).toBe(requirements.asset);
      expect(payload.permit2Authorization.permitted.amount).toBe(requirements.amount);

      // (3) the Permit2 nonce equals OUR payer-agnostic hash as a uint256
      const paymentInfo = reconstructPaymentInfo(preApprovalExpiry, payload.salt);
      const expectedNonce = hexToBigInt(
        computePayerAgnosticPaymentInfoHash(CHAIN_ID, paymentInfo),
      ).toString();
      expect(payload.permit2Authorization.nonce).toBe(expectedNonce);

      // (4) the signature recovers under the canonical Permit2 domain our facilitator uses
      const ok = await verifyPermit2Signature(
        offlineVerifier,
        payload.permit2Authorization,
        payload.signature,
        CHAIN_ID,
      );
      expect(ok).toBe(true);
      // sanity: the domain our verifier binds to is the canonical Permit2 contract
      expect(PERMIT2_ADDRESS).toBe("0x000000000022D473030F116dDEE9F6B43aC78BA3");
    });
  });
});
