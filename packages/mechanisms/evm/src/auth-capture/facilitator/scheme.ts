/**
 * AuthCapture Scheme - Facilitator
 * Handles verification and settlement of auth-capture payments.
 *
 * Implements x402's SchemeNetworkFacilitator interface so the auth-capture scheme
 * is a drop-in for the x402 facilitator, just like ExactEvmScheme.
 *
 * The facilitator is captureAuthorizer-agnostic: capture-authorizer addresses are
 * set by the merchant and arrive in `requirements.extra` at verify/settle time.
 * Escrow + token-collector addresses are universal constants and never come from
 * the wire format.
 */

import type {
  FacilitatorContext,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { FacilitatorEvmSigner } from "@x402/evm";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  encodeFunctionData,
  hexToBigInt,
  parseErc6492Signature,
  type Log,
} from "viem";
import {
  ERC20_BALANCE_OF_ABI,
  ERC20_TRANSFER_EVENT_ABI,
  ESCROW_ABI,
  ESCROW_ERRORS_ABI,
  ESCROW_EVENTS_ABI,
  ESCROW_VIEW_ABI,
} from "../abi";
import {
  AUTH_CAPTURE_ESCROW_ADDRESS,
  AUTH_CAPTURE_SCHEME,
  EIP3009_TOKEN_COLLECTOR_ADDRESS,
  PERMIT2_TOKEN_COLLECTOR_ADDRESS,
} from "../constants";
import {
  ESCROW_ERROR_TO_INVALID_REASON,
  ErrAmountMismatch,
  ErrAuthorizationExpired,
  ErrAuthorizationNotYetValid,
  ErrCaptureAuthorizerAssetDivergence,
  ErrCaptureAuthorizerEscrowCallMissing,
  ErrCaptureAuthorizerGasExceeded,
  ErrCaptureAuthorizerPaymentInfoMismatch,
  ErrCaptureDeadlineExpired,
  ErrInsufficientBalance,
  ErrInvalidAuthCaptureExtra,
  ErrInvalidAuthCaptureSignature,
  ErrInvalidDeadlineOrdering,
  ErrInvalidNetwork,
  ErrInvalidPayloadFormat,
  ErrNetworkMismatch,
  ErrNonceMismatch,
  ErrPayloadMethodMismatch,
  ErrSimulationFailed,
  ErrTokenCollectorMismatch,
  ErrTokenMismatch,
  ErrTransactionReverted,
  ErrUnsupportedAssetTransferMethod,
  ErrUnsupportedScheme,
  ErrVerificationFailed,
} from "./errors";
import {
  computeOnchainPaymentInfoHash,
  computePayerAgnosticPaymentInfoHash,
  verifyERC3009Signature,
  verifyPermit2Signature,
} from "../nonce";
import {
  isAuthCaptureExtra,
  isAuthCapturePayload,
  isEip3009Payload,
  isPermit2Payload,
} from "../types";
import type {
  AuthCaptureExtra,
  AuthCapturePayload,
  Eip3009Payload,
  PaymentInfoStruct,
  Permit2Payload,
} from "../types";
import { parseChainId } from "../utils";

/**
 * Reconstruct the on-chain PaymentInfo struct from the inputs the facilitator
 * has after verifying a wire payload. Wire-only inputs: `payer` and `salt`
 * (both from the payload). `preApprovalExpiry` is computed by the caller from
 * the payload (ERC-3009 `validBefore` or Permit2 `deadline`). The remaining
 * fields come from `requirements` (receiver/token/maxAmount) and
 * `requirements.extra` (capture/refund deadlines, fee policy, captureAuthorizer).
 *
 * @param payer - Address recovered from the wire payload's signature.
 * @param preApprovalExpiry - Pre-approval expiry in Unix seconds (from the wire payload).
 * @param salt - 32-byte salt from the wire payload.
 * @param requirements - The payment requirements published by the server.
 * @param extra - The validated `AuthCaptureExtra` subset of `requirements.extra`.
 * @returns A PaymentInfo struct ready to hand to the escrow contract.
 */
function reconstructPaymentInfo(
  payer: `0x${string}`,
  preApprovalExpiry: number,
  salt: `0x${string}`,
  requirements: PaymentRequirements,
  extra: AuthCaptureExtra,
): PaymentInfoStruct {
  return {
    operator: extra.captureAuthorizer,
    payer,
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

/**
 * Convert a JS-side PaymentInfo struct (string `maxAmount` and `salt`) into
 * the bigint-typed form viem expects when encoding the on-chain tuple.
 *
 * @param p - PaymentInfo with string-form numeric fields.
 * @returns The same struct with `maxAmount` and `salt` coerced to bigint.
 */
function paymentInfoToContractTuple(p: PaymentInfoStruct) {
  return { ...p, maxAmount: BigInt(p.maxAmount), salt: BigInt(p.salt) };
}

/**
 * Hard gas cap applied to both trace simulation and the broadcast settle tx
 * when `extra.captureAuthorizer` is a smart contract.
 *
 * This is a DoS bound on facilitator gas spend, NOT a correctness primitive.
 * EIP-150's 63/64 rule means the outer cap does not strictly bound the inner
 * escrow call's gas — a wrapper can pre-burn gas so escrow OOGs internally and
 * still return success. Catching that case is `verifyEscrowEvent`'s job: an
 * OOG'd escrow call emits no `PaymentAuthorized` / `PaymentCharged` event,
 * which fails with `capture_authorizer_escrow_call_missing`. Do not drop the
 * event check on the assumption that this cap protects correctness.
 *
 * 3_000_000 covers a direct authorize/charge call through the audited escrow
 * plus modest on-chain logic. zk-heavy authorizers (worst-case Halo2, STARK
 * verifiers) can exceed it; a deployment routing through such a
 * captureAuthorizer can raise the cap or refuse to settle
 * (`capture_authorizer_gas_exceeded`). Do not remove the cap.
 */
export const CAPTURE_AUTHORIZER_GAS_LIMIT = 3_000_000n;

/**
 * AuthCapture Facilitator Scheme - implements x402's SchemeNetworkFacilitator.
 *
 * Settle dispatch:
 *  - extra.autoCapture === true  → escrow.charge() (single-shot, funds direct to receiver)
 *  - extra.autoCapture !== true  → escrow.authorize() (two-phase; captureAuthorizer captures later)
 *
 * Asset-transfer dispatch (extra.assetTransferMethod):
 *  - 'eip3009' (default) → ERC-3009 ReceiveWithAuthorization, EIP3009_TOKEN_COLLECTOR
 *  - 'permit2'           → Permit2 PermitTransferFrom, PERMIT2_TOKEN_COLLECTOR
 */
export class AuthCaptureEvmScheme implements SchemeNetworkFacilitator {
  readonly scheme = AUTH_CAPTURE_SCHEME;
  readonly caipFamily = "eip155:*";

  /**
   * Construct a facilitator-side auth-capture scheme bound to a specific signer.
   *
   * @param signer - Facilitator signer with on-chain read + write capability.
   */
  constructor(private signer: FacilitatorEvmSigner) {}

  /**
   * Return the EOA address(es) this facilitator submits transactions from.
   * Advertised via `/supported` so merchants can decide whether to set
   * `extra.captureAuthorizer = facilitator-EOA` for the EOA-captureAuthorizer
   * path.
   *
   * @param _ - Unused network argument (interface compatibility).
   * @returns The facilitator's submitter address(es) on this network.
   */
  getSigners(_: string): string[] {
    return [...this.signer.getAddresses()];
  }

  /**
   * Facilitator-injected `extra` fields for `/supported`. auth-capture injects
   * none — every wire-format address is a universal canonical constant, and
   * `captureAuthorizer`, `feeRecipient`, and the deadlines are merchant-set
   * per request.
   *
   * @param _ - Unused network argument (interface compatibility).
   * @returns Always `undefined`.
   */
  getExtra(_: string): Record<string, unknown> | undefined {
    return undefined;
  }

  /**
   * Verify a payment payload against the published requirements without
   * touching state. Performs envelope shape checks, scheme/network agreement,
   * `extra` validation, deadline-ordering invariants, per-method field checks
   * (collector address, token, amount), signature verification (with
   * EIP-6492 unwrap), nonce binding to the payer-agnostic PaymentInfo hash,
   * and an on-chain `simulateContract` of `authorize` / `charge` so typed
   * escrow reverts surface as stable invalidReason strings.
   *
   * @param payload - The wire payload from the payer.
   * @param requirements - The server's published payment requirements.
   * @param _ - Unused FacilitatorContext (interface compatibility).
   * @returns A `VerifyResponse` with `isValid` and, on failure, a stable `invalidReason`.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    if (!isAuthCapturePayload(payload.payload)) {
      return { isValid: false, invalidReason: ErrInvalidPayloadFormat };
    }
    const wirePayload = payload.payload as AuthCapturePayload;
    const payer = isEip3009Payload(wirePayload)
      ? wirePayload.authorization.from
      : (wirePayload as Permit2Payload).permit2Authorization.from;

    if (
      payload.accepted.scheme !== AUTH_CAPTURE_SCHEME ||
      requirements.scheme !== AUTH_CAPTURE_SCHEME
    ) {
      return { isValid: false, invalidReason: ErrUnsupportedScheme, payer };
    }

    if (payload.accepted.network !== requirements.network) {
      return { isValid: false, invalidReason: ErrNetworkMismatch, payer };
    }

    const networkParts = requirements.network.split(":");
    if (networkParts.length !== 2 || networkParts[0] !== "eip155") {
      return { isValid: false, invalidReason: ErrInvalidNetwork, payer };
    }

    if (!isAuthCaptureExtra(requirements.extra)) {
      return { isValid: false, invalidReason: ErrInvalidAuthCaptureExtra, payer };
    }
    const extra = requirements.extra as AuthCaptureExtra;
    const chainId = parseChainId(requirements.network);
    const assetTransferMethod = extra.assetTransferMethod ?? "eip3009";

    if (assetTransferMethod !== "eip3009" && assetTransferMethod !== "permit2") {
      return { isValid: false, invalidReason: ErrUnsupportedAssetTransferMethod, payer };
    }
    if (assetTransferMethod === "eip3009" && !isEip3009Payload(wirePayload)) {
      return { isValid: false, invalidReason: ErrPayloadMethodMismatch, payer };
    }
    if (assetTransferMethod === "permit2" && !isPermit2Payload(wirePayload)) {
      return { isValid: false, invalidReason: ErrPayloadMethodMismatch, payer };
    }

    const now = Math.floor(Date.now() / 1000);
    const SAFETY_MARGIN_SECONDS = 6;
    if (extra.captureDeadline <= now + SAFETY_MARGIN_SECONDS) {
      return { isValid: false, invalidReason: ErrCaptureDeadlineExpired, payer };
    }
    if (extra.refundDeadline < extra.captureDeadline) {
      return { isValid: false, invalidReason: ErrInvalidDeadlineOrdering, payer };
    }
    // Mirror AuthCaptureEscrow._validatePayment ordering check upfront so the
    // facilitator rejects with a typed reason instead of letting the contract
    // revert with InvalidExpiries. preApprovalExpiry is client-derived from
    // requirements.maxTimeoutSeconds; if a merchant pairs a tight captureDeadline
    // with a generous maxTimeoutSeconds, the inequality breaks.

    let preApprovalExpiry: number;
    let amount: bigint;
    let signatureForVerify: `0x${string}`;
    let signatureValid = false;

    if (assetTransferMethod === "eip3009") {
      const eipPayload = wirePayload as Eip3009Payload;
      preApprovalExpiry = Number(eipPayload.authorization.validBefore);
      amount = BigInt(eipPayload.authorization.value);

      if (preApprovalExpiry <= now + SAFETY_MARGIN_SECONDS) {
        return { isValid: false, invalidReason: ErrAuthorizationExpired, payer };
      }
      if (Number(eipPayload.authorization.validAfter) > now) {
        return { isValid: false, invalidReason: ErrAuthorizationNotYetValid, payer };
      }
      if (
        eipPayload.authorization.to.toLowerCase() !== EIP3009_TOKEN_COLLECTOR_ADDRESS.toLowerCase()
      ) {
        return { isValid: false, invalidReason: ErrTokenCollectorMismatch, payer };
      }

      const parsed = parseErc6492Signature(eipPayload.signature);
      signatureForVerify = parsed.signature;
      signatureValid = await verifyERC3009Signature(
        this.signer,
        eipPayload.authorization,
        signatureForVerify,
        { ...extra, chainId },
        requirements.asset as `0x${string}`,
      );
    } else {
      const permitPayload = wirePayload as Permit2Payload;
      preApprovalExpiry = Number(permitPayload.permit2Authorization.deadline);
      amount = BigInt(permitPayload.permit2Authorization.permitted.amount);

      if (preApprovalExpiry <= now + SAFETY_MARGIN_SECONDS) {
        return { isValid: false, invalidReason: ErrAuthorizationExpired, payer };
      }
      if (
        permitPayload.permit2Authorization.spender.toLowerCase() !==
        PERMIT2_TOKEN_COLLECTOR_ADDRESS.toLowerCase()
      ) {
        return { isValid: false, invalidReason: ErrTokenCollectorMismatch, payer };
      }
      if (
        permitPayload.permit2Authorization.permitted.token.toLowerCase() !==
        requirements.asset.toLowerCase()
      ) {
        return { isValid: false, invalidReason: ErrTokenMismatch, payer };
      }

      const parsed = parseErc6492Signature(permitPayload.signature);
      signatureForVerify = parsed.signature;
      signatureValid = await verifyPermit2Signature(
        this.signer,
        permitPayload.permit2Authorization,
        signatureForVerify,
        chainId,
      );
    }

    if (!signatureValid) {
      return { isValid: false, invalidReason: ErrInvalidAuthCaptureSignature, payer };
    }

    if (amount !== BigInt(requirements.amount)) {
      return { isValid: false, invalidReason: ErrAmountMismatch, payer };
    }

    if (preApprovalExpiry > extra.captureDeadline) {
      // AuthCaptureEscrow._validatePayment requires preApprovalExp <= authorizationExp <= refundExp.
      // Surface this as the same invalid_deadline_ordering reason rather than letting the
      // contract revert with InvalidExpiries on settle.
      return { isValid: false, invalidReason: ErrInvalidDeadlineOrdering, payer };
    }

    // Reconstruct PaymentInfo and verify the wire nonce matches the
    // payer-agnostic hash. This binds the signature to all PaymentInfo fields.
    const paymentInfo = reconstructPaymentInfo(
      payer,
      preApprovalExpiry,
      wirePayload.salt,
      requirements,
      extra,
    );
    const expectedNonce = computePayerAgnosticPaymentInfoHash(chainId, paymentInfo);

    if (assetTransferMethod === "eip3009") {
      const wireNonce = (wirePayload as Eip3009Payload).authorization.nonce;
      if (wireNonce.toLowerCase() !== expectedNonce.toLowerCase()) {
        return { isValid: false, invalidReason: ErrNonceMismatch, payer };
      }
    } else {
      const wireNonce = BigInt((wirePayload as Permit2Payload).permit2Authorization.nonce);
      if (wireNonce !== hexToBigInt(expectedNonce)) {
        return { isValid: false, invalidReason: ErrNonceMismatch, payer };
      }
    }

    // Simulate the settle call to catch issues before spending gas. The
    // on-chain hash uses the real payer (matches escrow.getHash); the wire
    // nonce uses a zeroed payer. Both come from the same PaymentInfo struct,
    // so they're computed from the same source of truth.
    const onchainHash = computeOnchainPaymentInfoHash(chainId, paymentInfo);
    const settleResult = await this.simulateSettle(
      paymentInfo,
      amount,
      wirePayload,
      extra,
      onchainHash,
    );
    if (settleResult !== "ok") {
      // For balance-related failures, return a more actionable reason.
      try {
        const balance = (await this.signer.readContract({
          address: requirements.asset as `0x${string}`,
          abi: ERC20_BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [payer],
        })) as bigint;
        if (balance < BigInt(requirements.amount)) {
          return { isValid: false, invalidReason: ErrInsufficientBalance, payer };
        }
      } catch {
        /* ignore — fall through */
      }
      return { isValid: false, invalidReason: settleResult, payer };
    }

    return { isValid: true, payer };
  }

  /**
   * Verify-then-settle. Re-runs `verify()` against the payload, then submits
   * `authorize` (two-phase, default) or `charge` (single-shot, when
   * `extra.autoCapture === true`) to the escrow contract. If the merchant has
   * set `captureAuthorizer` to a smart contract, the call is routed through
   * that contract instead of directly to the escrow (see `resolveSettleTarget`).
   * Waits for the transaction receipt with a 60-second timeout.
   *
   * @param payload - The wire payload from the payer.
   * @param requirements - The server's published payment requirements.
   * @param _ - Unused FacilitatorContext (interface compatibility).
   * @returns A `SettleResponse` with `success`, the transaction hash (on
   *          success), and a stable `errorReason` (on failure).
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _?: FacilitatorContext,
  ): Promise<SettleResponse> {
    const verification = await this.verify(payload, requirements);
    if (!verification.isValid) {
      return {
        success: false,
        errorReason: verification.invalidReason ?? ErrVerificationFailed,
        transaction: "",
        network: requirements.network,
        payer: verification.payer,
      };
    }

    const wirePayload = payload.payload as unknown as AuthCapturePayload;
    const extra = requirements.extra as unknown as AuthCaptureExtra;
    const assetTransferMethod = extra.assetTransferMethod ?? "eip3009";
    const payer = verification.payer as `0x${string}`;

    const { preApprovalExpiry, amount } = unpackForSettle(wirePayload, assetTransferMethod);
    const paymentInfo = reconstructPaymentInfo(
      payer,
      preApprovalExpiry,
      wirePayload.salt,
      requirements,
      extra,
    );

    // charge() takes 6 args (adds feeBps + feeReceiver); authorize() takes 4.
    // Use minFeeBps as the safe default within the merchant's signed [min, max]
    // range; feeReceiver mirrors paymentInfo.feeReceiver (= extra.feeRecipient)
    // because _validateFee requires actual to match configured when configured != 0.
    const { functionName, args } = buildSettleArgs(paymentInfo, amount, wirePayload, extra);

    const settleTarget = await this.resolveSettleTarget(extra.captureAuthorizer);
    const isContractPath = settleTarget !== AUTH_CAPTURE_ESCROW_ADDRESS;

    try {
      const txHash = await this.signer.writeContract({
        address: settleTarget,
        abi: ESCROW_ABI,
        functionName,
        args,
        // Apply the gas cap on the contract path so a misbehaving authorizer
        // cannot drain the facilitator. The EOA path skips this so the audited
        // escrow gets a normal eth_estimateGas-driven limit.
        ...(isContractPath ? { gas: CAPTURE_AUTHORIZER_GAS_LIMIT } : {}),
      });

      const receiptPromise = this.signer.waitForTransactionReceipt({ hash: txHash });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Transaction receipt timeout after 60s")), 60_000),
      );
      const receipt = await Promise.race([receiptPromise, timeoutPromise]);

      if (receipt.status !== "success") {
        return {
          success: false,
          errorReason: ErrTransactionReverted,
          transaction: txHash,
          network: requirements.network,
          payer,
        };
      }

      return {
        success: true,
        transaction: txHash,
        network: requirements.network,
        payer,
      };
    } catch (error) {
      return {
        success: false,
        errorReason: error instanceof Error ? error.message : "Settlement failed",
        transaction: "",
        network: requirements.network,
        payer,
      };
    }
  }

  /**
   * Simulate the settle call and translate the result to a stable wire-level
   * reason. Dispatches by captureAuthorizer kind:
   *
   * - **EOA path** (settle target == escrow): a revert-only `eth_call`
   *   simulation is sufficient. The escrow is the same audited contract on
   *   every chain; semantic guarantees are baked in.
   * - **Contract path** (settle target == captureAuthorizer contract):
   *   trace-level simulation is mandatory per `scheme_auth_capture_evm.md`'s
   *   "Smart Contract `captureAuthorizer`" section. We verify the wrapper
   *   actually reaches escrow with the signed PaymentInfo, that asset deltas
   *   match the signed split, and that the simulated gas stays under the cap.
   *
   * Returns `"ok"` on simulated success, or a stable `invalidReason` string.
   *
   * @param paymentInfo - The reconstructed PaymentInfo struct.
   * @param amount - Settle amount in token base units.
   * @param wirePayload - The payer's wire payload.
   * @param extra - Validated `AuthCaptureExtra` from `requirements.extra`.
   * @param paymentInfoHash - On-chain `paymentInfoHash` (matches escrow event topic).
   * @returns `"ok"` on simulated success, or a stable `invalidReason` string.
   */
  private async simulateSettle(
    paymentInfo: PaymentInfoStruct,
    amount: bigint,
    wirePayload: AuthCapturePayload,
    extra: AuthCaptureExtra,
    paymentInfoHash: `0x${string}`,
  ): Promise<"ok" | string> {
    const settleTarget = await this.resolveSettleTarget(extra.captureAuthorizer);
    const isContractPath = settleTarget !== AUTH_CAPTURE_ESCROW_ADDRESS;

    return isContractPath
      ? this.simulateAuthorizerPassthrough(
          settleTarget,
          paymentInfo,
          amount,
          wirePayload,
          extra,
          paymentInfoHash,
        )
      : this.simulateEscrowDirect(paymentInfo, amount, wirePayload, extra);
  }

  /**
   * EOA path: simulate `authorize` / `charge` against the canonical escrow
   * with the facilitator EOA as `msg.sender`. Returns `"ok"` on success, or a
   * stable wire reason decoded from a `ContractFunctionRevertedError`.
   *
   * @param paymentInfo - The reconstructed PaymentInfo struct.
   * @param amount - Settle amount in token base units.
   * @param wirePayload - The payer's wire payload.
   * @param extra - Validated `AuthCaptureExtra` from `requirements.extra`.
   * @returns `"ok"` on simulated success, or a stable `invalidReason` string.
   */
  private async simulateEscrowDirect(
    paymentInfo: PaymentInfoStruct,
    amount: bigint,
    wirePayload: AuthCapturePayload,
    extra: AuthCaptureExtra,
  ): Promise<"ok" | string> {
    const { functionName, args } = buildSettleArgs(paymentInfo, amount, wirePayload, extra);
    try {
      await this.signer.readContract({
        address: AUTH_CAPTURE_ESCROW_ADDRESS,
        abi: ESCROW_ABI_WITH_ERRORS,
        functionName,
        args,
        account: this.signer.getAddresses()[0],
      } as Parameters<typeof this.signer.readContract>[0]);
      return "ok";
    } catch (err) {
      return decodeRevertReason(err);
    }
  }

  /**
   * Contract path: trace-level simulation of the settle call against an
   * untrusted captureAuthorizer contract. Uses the signer's `simulateCalls`
   * capability (viem PublicClient action) to capture logs and per-call gas.
   * Checks layered on top of a revert-only simulation:
   *
   * 1. Gas: simulated `gasUsed` MUST be ≤ `CAPTURE_AUTHORIZER_GAS_LIMIT`.
   * 2. Escrow event: the trace MUST contain the matching `PaymentAuthorized`
   * or `PaymentCharged` event emitted by `AUTH_CAPTURE_ESCROW_ADDRESS`,
   * with `paymentInfoHash` equal to the payer-agnostic hash verified in
   * step 12.
   * 3. Asset deltas: ERC-20 `Transfer` events for `requirements.asset` must
   * move funds consistent with the signed PaymentInfo — payer pays
   * `amount`; on `authorize` the receiver/feeReceiver are untouched and
   * no address outside `{payer, receiver, feeReceiver}` net-receives
   * other than as a known intermediate; on `charge` receiver +
   * feeReceiver get the split with `feeBps ∈ [minFeeBps, maxFeeBps]`.
   *
   * Falls back to revert reason decoding on simulation failure. If the
   * signer doesn't expose `simulateCalls`, we cannot satisfy the spec on
   * the contract path and return `simulation_failed`.
   *
   * @param target - Resolved settle target — the captureAuthorizer contract.
   * @param paymentInfo - The reconstructed PaymentInfo struct.
   * @param amount - Settle amount in token base units.
   * @param wirePayload - The payer's wire payload.
   * @param extra - Validated `AuthCaptureExtra` from `requirements.extra`.
   * @param paymentInfoHash - On-chain `paymentInfoHash` (matches escrow event topic).
   * @returns `"ok"` on simulated success, or a stable `invalidReason` string.
   */
  private async simulateAuthorizerPassthrough(
    target: `0x${string}`,
    paymentInfo: PaymentInfoStruct,
    amount: bigint,
    wirePayload: AuthCapturePayload,
    extra: AuthCaptureExtra,
    paymentInfoHash: `0x${string}`,
  ): Promise<"ok" | string> {
    const simulateCalls = (this.signer as unknown as Partial<SimulateCallsCapable>).simulateCalls;
    if (typeof simulateCalls !== "function") {
      return ErrSimulationFailed;
    }
    const { functionName, args } = buildSettleArgs(paymentInfo, amount, wirePayload, extra);
    const data = encodeFunctionData({
      abi: ESCROW_ABI,
      functionName,
      args,
    } as Parameters<typeof encodeFunctionData>[0]);

    // Resolve the operator's TokenStore up front; we need it to enumerate
    // the allowed asset-delta recipients on both authorize and charge.
    // Deterministic CREATE2 from (tokenStoreImpl, salt=bytes20(operator),
    // deployer=escrow) — querying the escrow is the most robust source.
    let tokenStore: `0x${string}`;
    try {
      tokenStore = (await this.signer.readContract({
        address: AUTH_CAPTURE_ESCROW_ADDRESS,
        abi: ESCROW_VIEW_ABI,
        functionName: "getTokenStore",
        args: [paymentInfo.operator],
      })) as `0x${string}`;
    } catch {
      return ErrSimulationFailed;
    }

    let traceResult: SimulateCallResult;
    try {
      const response = (await simulateCalls.call(this.signer, {
        account: this.signer.getAddresses()[0],
        calls: [
          {
            to: target,
            data,
            gas: CAPTURE_AUTHORIZER_GAS_LIMIT,
          },
        ],
        traceTransfers: true,
      })) as SimulateCallsResponse;
      traceResult = response.results[0];
    } catch (err) {
      return decodeRevertReason(err);
    }

    if (traceResult.status !== "success") {
      // Some RPCs surface the revert as `error` on the result; others throw.
      // Try to decode whichever we got.
      if (traceResult.error) return decodeRevertReason(traceResult.error);
      return ErrSimulationFailed;
    }

    if (
      typeof traceResult.gasUsed === "bigint" &&
      traceResult.gasUsed > CAPTURE_AUTHORIZER_GAS_LIMIT
    ) {
      return ErrCaptureAuthorizerGasExceeded;
    }

    const logs = traceResult.logs ?? [];
    const eventCheck = verifyEscrowEvent(logs, functionName, paymentInfoHash);
    if (!eventCheck.ok) return eventCheck.reason;

    const assetCheck = verifyAssetDeltas(
      logs,
      paymentInfo,
      amount,
      functionName,
      tokenStore,
      eventCheck.chargeFee,
    );
    if (assetCheck !== "ok") return assetCheck;

    return "ok";
  }

  /**
   * Resolve the on-chain target for an `authorize`/`charge` call per spec.
   * Per `scheme_auth_capture_evm.md`, the facilitator may call escrow `"either
   * directly or through a smart contract set as the captureAuthorizer"`.
   * Probes `getCode(captureAuthorizer)`:
   *
   * - **EOA** (empty or `0x` bytecode) → call the canonical escrow directly.
   *   The escrow's `onlySender(paymentInfo.operator)` gate is satisfied
   *   because the facilitator's tx `msg.sender` equals the captureAuthorizer
   *   EOA.
   * - **Contract** (non-empty bytecode) → call the captureAuthorizer
   *   contract, which MUST expose the literal `authorize`/`charge` escrow
   *   selectors and forward to escrow. The contract becomes `msg.sender` at
   *   the escrow, satisfying the gate.
   *
   * @param captureAuthorizer - Address from `extra.captureAuthorizer`.
   * @returns The address to target with the settle write/simulate.
   */
  private async resolveSettleTarget(captureAuthorizer: `0x${string}`): Promise<`0x${string}`> {
    const code = await this.signer.getCode({ address: captureAuthorizer });
    if (!code || code === "0x") return AUTH_CAPTURE_ESCROW_ADDRESS;
    return captureAuthorizer;
  }
}

// Combined ABI: function definitions + custom-error definitions. viem decodes
// revert data against any error in the ABI passed to the call.
const ESCROW_ABI_WITH_ERRORS = [...ESCROW_ABI, ...ESCROW_ERRORS_ABI] as const;

/**
 * Walk a viem error chain looking for a decoded custom-error name, then map
 * known names to a stable `invalidReason` via `ESCROW_ERROR_TO_INVALID_REASON`.
 * Anything unmapped returns `ErrSimulationFailed` so the wire never leaks raw
 * selectors.
 *
 * @param err - The error thrown by `readContract` / `simulateContract`.
 * @returns A stable wire-level `invalidReason` string.
 */
function decodeRevertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk(
      (e): e is ContractFunctionRevertedError => e instanceof ContractFunctionRevertedError,
    );
    if (revert instanceof ContractFunctionRevertedError) {
      const errorName = revert.data?.errorName;
      if (errorName && errorName in ESCROW_ERROR_TO_INVALID_REASON) {
        return ESCROW_ERROR_TO_INVALID_REASON[errorName];
      }
    }
  }
  return ErrSimulationFailed;
}

/**
 * Build the function name + args tuple used by both the simulate and settle
 * paths so the two are guaranteed identical. Encodes `charge`'s 6-arg / 4-arg
 * split in one place.
 *
 * @param paymentInfo - The reconstructed PaymentInfo struct.
 * @param amount - Settle amount in token base units.
 * @param wirePayload - The payer's wire payload.
 * @param extra - Validated `AuthCaptureExtra` from `requirements.extra`.
 * @returns `functionName` (authorize | charge) and the matching `args` tuple.
 */
function buildSettleArgs(
  paymentInfo: PaymentInfoStruct,
  amount: bigint,
  wirePayload: AuthCapturePayload,
  extra: AuthCaptureExtra,
): { functionName: "authorize" | "charge"; args: readonly unknown[] } {
  const assetTransferMethod = extra.assetTransferMethod ?? "eip3009";
  const { tokenCollector, collectorData } = unpackForSettle(wirePayload, assetTransferMethod);
  const functionName = extra.autoCapture === true ? "charge" : "authorize";
  const tuple = paymentInfoToContractTuple(paymentInfo);
  const args =
    functionName === "charge"
      ? ([
          tuple,
          amount,
          tokenCollector,
          collectorData,
          paymentInfo.minFeeBps,
          paymentInfo.feeReceiver,
        ] as const)
      : ([tuple, amount, tokenCollector, collectorData] as const);
  return { functionName, args };
}

/**
 * Shape the contract path expects from the signer for `eth_simulateV1`
 * (viem PublicClient.simulateCalls). Not declared on FacilitatorEvmSigner
 * because not every signer transport surfaces it; we feature-detect at use.
 */
type SimulateCallsCapable = {
  simulateCalls(args: {
    account?: `0x${string}`;
    calls: Array<{ to: `0x${string}`; data: `0x${string}`; gas?: bigint }>;
    traceTransfers?: boolean;
  }): Promise<SimulateCallsResponse>;
};

type SimulateCallResult = {
  status: "success" | "failure";
  gasUsed?: bigint;
  logs?: ReadonlyArray<Log>;
  error?: unknown;
};

type SimulateCallsResponse = {
  results: ReadonlyArray<SimulateCallResult>;
};

/**
 * Result of `verifyEscrowEvent`. On `ok`, exposes the actual `feeReceiver`
 * and `feeBps` from the `PaymentCharged` event so the asset-delta check can
 * authoritatively know who got the fee (essential when
 * `paymentInfo.feeReceiver === address(0)`, which delegates fee-recipient
 * choice to the captureAuthorizer at charge time).
 */
type EscrowEventCheck =
  | {
      ok: true;
      chargeFee?: { feeReceiver: `0x${string}`; feeBps: number };
    }
  | { ok: false; reason: string };

/**
 * Find the `PaymentAuthorized` / `PaymentCharged` event in a simulated trace,
 * emitted by `AUTH_CAPTURE_ESCROW_ADDRESS`, and assert its indexed
 * `paymentInfoHash` matches the on-chain hash recomputed in verify step 12.
 *
 * On `charge`, also surfaces the `feeReceiver` and `feeBps` from the event
 * so the asset-delta check can use the actual values escrow used (vs. the
 * `paymentInfo.feeReceiver`, which may be `address(0)` per spec to delegate
 * fee-recipient choice).
 *
 * No matching event → `capture_authorizer_escrow_call_missing`. Hash mismatch
 * → `capture_authorizer_payment_info_mismatch`.
 *
 * @param logs - All logs from the simulated trace.
 * @param functionName - The escrow function the facilitator submitted.
 * @param expectedHash - On-chain `paymentInfoHash` matching `escrow.getHash(paymentInfo)`.
 * @returns Event check result; on `ok: true` for `charge`, includes the
 *   actual `feeReceiver` and `feeBps` from the event.
 */
function verifyEscrowEvent(
  logs: ReadonlyArray<Log>,
  functionName: "authorize" | "charge",
  expectedHash: `0x${string}`,
): EscrowEventCheck {
  const escrow = AUTH_CAPTURE_ESCROW_ADDRESS.toLowerCase();
  const expectedEventName = functionName === "authorize" ? "PaymentAuthorized" : "PaymentCharged";
  let foundEscrowEvent = false;

  for (const log of logs) {
    if (log.address.toLowerCase() !== escrow) continue;
    let decoded: ReturnType<typeof decodeEventLog>;
    try {
      decoded = decodeEventLog({
        abi: ESCROW_EVENTS_ABI,
        data: log.data,
        topics: log.topics,
        strict: false,
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== expectedEventName) continue;
    foundEscrowEvent = true;
    const args = decoded.args as {
      paymentInfoHash: `0x${string}`;
      feeReceiver?: `0x${string}`;
      feeBps?: number;
    };
    if (args.paymentInfoHash.toLowerCase() !== expectedHash.toLowerCase()) continue;
    if (functionName === "charge") {
      return {
        ok: true,
        chargeFee: {
          feeReceiver: args.feeReceiver as `0x${string}`,
          feeBps: Number(args.feeBps),
        },
      };
    }
    return { ok: true };
  }

  return {
    ok: false,
    reason: foundEscrowEvent
      ? ErrCaptureAuthorizerPaymentInfoMismatch
      : ErrCaptureAuthorizerEscrowCallMissing,
  };
}

/**
 * Reconstruct net ERC-20 deltas for `paymentInfo.token` from the trace and
 * assert they match the signed PaymentInfo.
 *
 * Allowed-recipient enumeration: every address with a non-zero net delta MUST
 * be one of `{payer, receiver, feeReceiver, tokenStore}`. Anything else is a
 * sign the wrapper redirected funds and fails the check immediately.
 *
 * On `authorize`: payer = -amount; receiver = 0; feeReceiver = 0;
 * tokenStore = +amount.
 *
 * On `charge`: payer = -amount; tokenStore net 0 (funds flow through); the
 * actual fee recipient is whatever escrow emitted in the `PaymentCharged`
 * event (necessary when `paymentInfo.feeReceiver === address(0)` per spec).
 * `feeBps` from the event must satisfy `[minFeeBps, maxFeeBps]`. Handles
 * `receiver === feeReceiver` (combined delta = amount, fee check still runs
 * against the event's `feeBps`).
 *
 * Any divergence → `capture_authorizer_asset_divergence`.
 *
 * @param logs - All logs from the simulated trace.
 * @param paymentInfo - The reconstructed PaymentInfo struct.
 * @param amount - Settle amount in token base units.
 * @param functionName - The escrow function the facilitator submitted.
 * @param tokenStore - `escrow.getTokenStore(paymentInfo.operator)`.
 * @param chargeFee - On `charge`, the actual `feeReceiver` and `feeBps`
 *   surfaced by `verifyEscrowEvent`.
 * @param chargeFee.feeReceiver - Recipient escrow actually paid the fee to.
 * @param chargeFee.feeBps - Fee basis points escrow actually used.
 * @returns `"ok"` or `capture_authorizer_asset_divergence`.
 */
function verifyAssetDeltas(
  logs: ReadonlyArray<Log>,
  paymentInfo: PaymentInfoStruct,
  amount: bigint,
  functionName: "authorize" | "charge",
  tokenStore: `0x${string}`,
  chargeFee?: { feeReceiver: `0x${string}`; feeBps: number },
): "ok" | string {
  const token = paymentInfo.token.toLowerCase();
  const deltas = new Map<string, bigint>();

  for (const log of logs) {
    if (log.address.toLowerCase() !== token) continue;
    let decoded: ReturnType<typeof decodeEventLog>;
    try {
      decoded = decodeEventLog({
        abi: ERC20_TRANSFER_EVENT_ABI,
        data: log.data,
        topics: log.topics,
        strict: false,
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "Transfer") continue;
    const { from, to, value } = decoded.args as {
      from: `0x${string}`;
      to: `0x${string}`;
      value: bigint;
    };
    const fromKey = from.toLowerCase();
    const toKey = to.toLowerCase();
    deltas.set(fromKey, (deltas.get(fromKey) ?? 0n) - value);
    deltas.set(toKey, (deltas.get(toKey) ?? 0n) + value);
  }

  const payerKey = paymentInfo.payer.toLowerCase();
  const receiverKey = paymentInfo.receiver.toLowerCase();
  const tokenStoreKey = tokenStore.toLowerCase();

  if (functionName === "authorize") {
    const feeReceiverKey = paymentInfo.feeReceiver.toLowerCase();
    const allowed = new Set([payerKey, receiverKey, feeReceiverKey, tokenStoreKey]);
    for (const [addr, delta] of deltas) {
      if (delta === 0n) continue;
      if (!allowed.has(addr)) return ErrCaptureAuthorizerAssetDivergence;
    }
    if ((deltas.get(payerKey) ?? 0n) !== -amount) return ErrCaptureAuthorizerAssetDivergence;
    if ((deltas.get(tokenStoreKey) ?? 0n) !== amount) {
      return ErrCaptureAuthorizerAssetDivergence;
    }
    // receiver / feeReceiver untouched at authorize time. If receiver ==
    // tokenStore (pathological) the receiver-net-zero check would conflict
    // with tokenStore having +amount; in practice escrow's tokenStore is a
    // CREATE2 deploy from the operator-derived salt and won't collide with
    // a merchant-set receiver, but be defensive.
    if (receiverKey !== tokenStoreKey && (deltas.get(receiverKey) ?? 0n) !== 0n) {
      return ErrCaptureAuthorizerAssetDivergence;
    }
    if (
      feeReceiverKey !== tokenStoreKey &&
      feeReceiverKey !== receiverKey &&
      (deltas.get(feeReceiverKey) ?? 0n) !== 0n
    ) {
      return ErrCaptureAuthorizerAssetDivergence;
    }
    return "ok";
  }

  // charge path. Use the actual feeReceiver / feeBps from the escrow event
  // (essential when paymentInfo.feeReceiver == 0, where the wrapper supplies
  // any non-zero recipient).
  if (!chargeFee) return ErrCaptureAuthorizerAssetDivergence;
  const actualFeeReceiverKey = chargeFee.feeReceiver.toLowerCase();
  const allowed = new Set([payerKey, receiverKey, actualFeeReceiverKey, tokenStoreKey]);
  for (const [addr, delta] of deltas) {
    if (delta === 0n) continue;
    if (!allowed.has(addr)) return ErrCaptureAuthorizerAssetDivergence;
  }
  if ((deltas.get(payerKey) ?? 0n) !== -amount) return ErrCaptureAuthorizerAssetDivergence;
  // tokenStore is transient on charge; whatever flowed through nets to 0.
  if (
    tokenStoreKey !== payerKey &&
    tokenStoreKey !== receiverKey &&
    tokenStoreKey !== actualFeeReceiverKey
  ) {
    if ((deltas.get(tokenStoreKey) ?? 0n) !== 0n) return ErrCaptureAuthorizerAssetDivergence;
  }

  // Resolve the receiver / feeReceiver split. If receiver === actualFeeReceiver
  // they share a Map entry; the combined delta must equal `amount` and the
  // feeBps still has to be inside the signed [min, max] range.
  const expectedFee = (amount * BigInt(chargeFee.feeBps)) / 10000n;
  const expectedNet = amount - expectedFee;
  if (chargeFee.feeBps < paymentInfo.minFeeBps || chargeFee.feeBps > paymentInfo.maxFeeBps) {
    return ErrCaptureAuthorizerAssetDivergence;
  }
  if (receiverKey === actualFeeReceiverKey) {
    if ((deltas.get(receiverKey) ?? 0n) !== amount) {
      return ErrCaptureAuthorizerAssetDivergence;
    }
    return "ok";
  }
  if ((deltas.get(receiverKey) ?? 0n) !== expectedNet) {
    return ErrCaptureAuthorizerAssetDivergence;
  }
  if ((deltas.get(actualFeeReceiverKey) ?? 0n) !== expectedFee) {
    return ErrCaptureAuthorizerAssetDivergence;
  }
  return "ok";
}

/**
 * Unpack the per-method inputs the escrow needs at settle time: the token
 * collector address (canonical, per method) and the `collectorData` blob the
 * collector parses. EIP-3009 collectors take the raw ReceiveWithAuthorization
 * signature directly. Permit2 collectors take the signature ABI-encoded as
 * `bytes` (the collector itself reconstructs the PermitTransferFrom struct
 * from PaymentInfo, using the deterministic nonce + payer).
 *
 * @param wirePayload - The verified wire payload (EIP-3009 or Permit2 shape).
 * @param assetTransferMethod - Which envelope the payload uses.
 * @returns `preApprovalExpiry`, `amount`, `tokenCollector`, and `collectorData` ready for the escrow call.
 */
function unpackForSettle(
  wirePayload: AuthCapturePayload,
  assetTransferMethod: "eip3009" | "permit2",
): {
  preApprovalExpiry: number;
  amount: bigint;
  tokenCollector: `0x${string}`;
  collectorData: `0x${string}`;
} {
  if (assetTransferMethod === "eip3009") {
    const p = wirePayload as Eip3009Payload;
    return {
      preApprovalExpiry: Number(p.authorization.validBefore),
      amount: BigInt(p.authorization.value),
      tokenCollector: EIP3009_TOKEN_COLLECTOR_ADDRESS,
      collectorData: p.signature,
    };
  }
  const p = wirePayload as Permit2Payload;
  // Permit2 collector expects the raw 65-byte signature; the collector itself
  // reconstructs the PermitTransferFrom struct from PaymentInfo (deterministic
  // nonce + payer). Don't ABI-wrap — Permit2 checks `signature.length == 65`
  // directly and rejects a wrapped blob with `InvalidSignatureLength()`.
  return {
    preApprovalExpiry: Number(p.permit2Authorization.deadline),
    amount: BigInt(p.permit2Authorization.permitted.amount),
    tokenCollector: PERMIT2_TOKEN_COLLECTOR_ADDRESS,
    collectorData: p.signature,
  };
}
