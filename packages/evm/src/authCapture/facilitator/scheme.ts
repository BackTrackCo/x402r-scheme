/**
 * AuthCapture Scheme - Facilitator
 * Handles verification and settlement of authCapture payments.
 *
 * Implements x402's SchemeNetworkFacilitator interface so the authCapture scheme
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
} from '@x402/core/types'
import type { FacilitatorEvmSigner } from '@x402/evm'
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeAbiParameters,
  hexToBigInt,
  parseErc6492Signature,
} from 'viem'
import {
  AUTH_CAPTURE_ESCROW_ADDRESS,
  EIP3009_TOKEN_COLLECTOR_ADDRESS,
  ERC20_BALANCE_OF_ABI,
  ESCROW_ABI,
  ESCROW_ERRORS_ABI,
  ESCROW_ERROR_TO_INVALID_REASON,
  PERMIT2_TOKEN_COLLECTOR_ADDRESS,
} from '../shared/constants'
import {
  computePayerAgnosticPaymentInfoHash,
  verifyERC3009Signature,
  verifyPermit2Signature,
} from '../shared/nonce'
import {
  isAuthCaptureExtra,
  isAuthCapturePayload,
  isEip3009Payload,
  isPermit2Payload,
} from '../shared/types'
import type {
  AuthCaptureExtra,
  AuthCapturePayload,
  Eip3009Payload,
  PaymentInfoStruct,
  Permit2Payload,
} from '../shared/types'
import { parseChainId } from '../shared/utils'

/**
 * Reconstruct the on-chain PaymentInfo struct from a verified payload + extra.
 * Inputs that come from the wire: payer (payload), salt (payload), and the
 * canonical extra fields (captureAuthorizer/captureDeadline/refundDeadline/
 * feeRecipient/maxFeeBps/minFeeBps). Top-level requirements provide
 * receiver/token/maxAmount.
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
  }
}

function paymentInfoToContractTuple(p: PaymentInfoStruct) {
  return { ...p, maxAmount: BigInt(p.maxAmount), salt: BigInt(p.salt) }
}

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
export class AuthCaptureFacilitatorScheme implements SchemeNetworkFacilitator {
  readonly scheme = 'authCapture'
  readonly caipFamily = 'eip155:*'

  constructor(private signer: FacilitatorEvmSigner) {}

  getSigners(_network: string): string[] {
    return [...this.signer.getAddresses()]
  }

  // No facilitator-injected extras: all wire-format addresses are constants and
  // captureAuthorizer/feeRecipient/deadlines are merchant-set.
  getExtra(_network: string): Record<string, unknown> | undefined {
    return undefined
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    if (!isAuthCapturePayload(payload.payload)) {
      return { isValid: false, invalidReason: 'invalid_payload_format' }
    }
    const wirePayload = payload.payload as AuthCapturePayload
    const payer = isEip3009Payload(wirePayload)
      ? wirePayload.authorization.from
      : (wirePayload as Permit2Payload).permit2Authorization.from

    if (payload.accepted.scheme !== 'authCapture' || requirements.scheme !== 'authCapture') {
      return { isValid: false, invalidReason: 'unsupported_scheme', payer }
    }

    if (payload.accepted.network !== requirements.network) {
      return { isValid: false, invalidReason: 'network_mismatch', payer }
    }

    const networkParts = requirements.network.split(':')
    if (networkParts.length !== 2 || networkParts[0] !== 'eip155') {
      return { isValid: false, invalidReason: 'invalid_network', payer }
    }

    if (!isAuthCaptureExtra(requirements.extra)) {
      return { isValid: false, invalidReason: 'invalid_authCapture_extra', payer }
    }
    const extra = requirements.extra as AuthCaptureExtra
    const chainId = parseChainId(requirements.network)
    const assetTransferMethod = extra.assetTransferMethod ?? 'eip3009'

    if (assetTransferMethod !== 'eip3009' && assetTransferMethod !== 'permit2') {
      return { isValid: false, invalidReason: 'unsupported_asset_transfer_method', payer }
    }
    if (assetTransferMethod === 'eip3009' && !isEip3009Payload(wirePayload)) {
      return { isValid: false, invalidReason: 'payload_method_mismatch', payer }
    }
    if (assetTransferMethod === 'permit2' && !isPermit2Payload(wirePayload)) {
      return { isValid: false, invalidReason: 'payload_method_mismatch', payer }
    }

    const now = Math.floor(Date.now() / 1000)
    const SAFETY_MARGIN_SECONDS = 6
    if (extra.captureDeadline <= now + SAFETY_MARGIN_SECONDS) {
      return { isValid: false, invalidReason: 'capture_deadline_expired', payer }
    }
    if (extra.refundDeadline < extra.captureDeadline) {
      return { isValid: false, invalidReason: 'invalid_deadline_ordering', payer }
    }
    // Mirror AuthCaptureEscrow._validatePayment ordering check upfront so the
    // facilitator rejects with a typed reason instead of letting the contract
    // revert with InvalidExpiries. preApprovalExpiry is client-derived from
    // requirements.maxTimeoutSeconds; if a merchant pairs a tight captureDeadline
    // with a generous maxTimeoutSeconds, the inequality breaks.

    let preApprovalExpiry: number
    let amount: bigint
    let signatureForVerify: `0x${string}`
    let signatureValid = false

    if (assetTransferMethod === 'eip3009') {
      const eipPayload = wirePayload as Eip3009Payload
      preApprovalExpiry = Number(eipPayload.authorization.validBefore)
      amount = BigInt(eipPayload.authorization.value)

      if (preApprovalExpiry <= now + SAFETY_MARGIN_SECONDS) {
        return { isValid: false, invalidReason: 'authorization_expired', payer }
      }
      if (Number(eipPayload.authorization.validAfter) > now) {
        return { isValid: false, invalidReason: 'authorization_not_yet_valid', payer }
      }
      if (
        eipPayload.authorization.to.toLowerCase() !== EIP3009_TOKEN_COLLECTOR_ADDRESS.toLowerCase()
      ) {
        return { isValid: false, invalidReason: 'token_collector_mismatch', payer }
      }

      const parsed = parseErc6492Signature(eipPayload.signature)
      signatureForVerify = parsed.signature
      signatureValid = await verifyERC3009Signature(
        this.signer,
        eipPayload.authorization,
        signatureForVerify,
        { ...extra, chainId },
        requirements.asset as `0x${string}`,
      )
    } else {
      const permitPayload = wirePayload as Permit2Payload
      preApprovalExpiry = Number(permitPayload.permit2Authorization.deadline)
      amount = BigInt(permitPayload.permit2Authorization.permitted.amount)

      if (preApprovalExpiry <= now + SAFETY_MARGIN_SECONDS) {
        return { isValid: false, invalidReason: 'authorization_expired', payer }
      }
      if (
        permitPayload.permit2Authorization.spender.toLowerCase() !==
        PERMIT2_TOKEN_COLLECTOR_ADDRESS.toLowerCase()
      ) {
        return { isValid: false, invalidReason: 'token_collector_mismatch', payer }
      }
      if (
        permitPayload.permit2Authorization.permitted.token.toLowerCase() !==
        requirements.asset.toLowerCase()
      ) {
        return { isValid: false, invalidReason: 'token_mismatch', payer }
      }

      const parsed = parseErc6492Signature(permitPayload.signature)
      signatureForVerify = parsed.signature
      signatureValid = await verifyPermit2Signature(
        this.signer,
        permitPayload.permit2Authorization,
        signatureForVerify,
        chainId,
      )
    }

    if (!signatureValid) {
      return { isValid: false, invalidReason: 'invalid_authCapture_signature', payer }
    }

    if (amount !== BigInt(requirements.amount)) {
      return { isValid: false, invalidReason: 'amount_mismatch', payer }
    }

    if (preApprovalExpiry > extra.captureDeadline) {
      // AuthCaptureEscrow._validatePayment requires preApprovalExp <= authorizationExp <= refundExp.
      // Surface this as the same invalid_deadline_ordering reason rather than letting the
      // contract revert with InvalidExpiries on settle.
      return { isValid: false, invalidReason: 'invalid_deadline_ordering', payer }
    }

    // Reconstruct PaymentInfo and verify the wire nonce matches the
    // payer-agnostic hash. This binds the signature to all PaymentInfo fields.
    const paymentInfo = reconstructPaymentInfo(
      payer,
      preApprovalExpiry,
      wirePayload.salt,
      requirements,
      extra,
    )
    const expectedNonce = computePayerAgnosticPaymentInfoHash(chainId, paymentInfo)

    if (assetTransferMethod === 'eip3009') {
      const wireNonce = (wirePayload as Eip3009Payload).authorization.nonce
      if (wireNonce.toLowerCase() !== expectedNonce.toLowerCase()) {
        return { isValid: false, invalidReason: 'nonce_mismatch', payer }
      }
    } else {
      const wireNonce = BigInt((wirePayload as Permit2Payload).permit2Authorization.nonce)
      if (wireNonce !== hexToBigInt(expectedNonce)) {
        return { isValid: false, invalidReason: 'nonce_mismatch', payer }
      }
    }

    // Simulate the settle call to catch issues before spending gas.
    const settleResult = await this.simulateSettle(paymentInfo, amount, wirePayload, extra, payer)
    if (settleResult !== 'ok') {
      // For balance-related failures, return a more actionable reason.
      try {
        const balance = (await this.signer.readContract({
          address: requirements.asset as `0x${string}`,
          abi: ERC20_BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [payer],
        })) as bigint
        if (balance < BigInt(requirements.amount)) {
          return { isValid: false, invalidReason: 'insufficient_balance', payer }
        }
      } catch {
        /* ignore — fall through */
      }
      return { isValid: false, invalidReason: settleResult, payer }
    }

    return { isValid: true, payer }
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<SettleResponse> {
    const verification = await this.verify(payload, requirements)
    if (!verification.isValid) {
      return {
        success: false,
        errorReason: verification.invalidReason ?? 'verification_failed',
        transaction: '',
        network: requirements.network,
        payer: verification.payer,
      }
    }

    const wirePayload = payload.payload as unknown as AuthCapturePayload
    const extra = requirements.extra as unknown as AuthCaptureExtra
    const assetTransferMethod = extra.assetTransferMethod ?? 'eip3009'
    const payer = verification.payer as `0x${string}`

    const { preApprovalExpiry, amount, tokenCollector, collectorData } = unpackForSettle(
      wirePayload,
      assetTransferMethod,
    )
    const paymentInfo = reconstructPaymentInfo(
      payer,
      preApprovalExpiry,
      wirePayload.salt,
      requirements,
      extra,
    )

    const functionName = extra.autoCapture === true ? 'charge' : 'authorize'
    const tuple = paymentInfoToContractTuple(paymentInfo)
    // charge() takes 6 args (adds feeBps + feeReceiver); authorize() takes 4.
    // Use minFeeBps as the safe default within the merchant's signed [min, max]
    // range; feeReceiver mirrors paymentInfo.feeReceiver (= extra.feeRecipient)
    // because _validateFee requires actual to match configured when configured != 0.
    const args =
      functionName === 'charge'
        ? ([
            tuple,
            amount,
            tokenCollector,
            collectorData,
            paymentInfo.minFeeBps,
            paymentInfo.feeReceiver,
          ] as const)
        : ([tuple, amount, tokenCollector, collectorData] as const)

    const settleTarget = await this.resolveSettleTarget(extra.captureAuthorizer)

    try {
      const txHash = await this.signer.writeContract({
        address: settleTarget,
        abi: ESCROW_ABI,
        functionName,
        args,
      })

      const receiptPromise = this.signer.waitForTransactionReceipt({ hash: txHash })
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Transaction receipt timeout after 60s')), 60_000),
      )
      const receipt = await Promise.race([receiptPromise, timeoutPromise])

      if (receipt.status !== 'success') {
        return {
          success: false,
          errorReason: 'transaction_reverted',
          transaction: txHash,
          network: requirements.network,
          payer,
        }
      }

      return {
        success: true,
        transaction: txHash,
        network: requirements.network,
        payer,
      }
    } catch (error) {
      return {
        success: false,
        errorReason: error instanceof Error ? error.message : 'Settlement failed',
        transaction: '',
        network: requirements.network,
        payer,
      }
    }
  }

  /**
   * Simulate the settle call via eth_call. Returns 'ok' on success or a
   * stable invalidReason string on failure.
   *
   * On revert, viem walks the error chain for ContractFunctionRevertedError
   * and decodes the custom-error name against ESCROW_ABI + ESCROW_ERRORS_ABI.
   * Known errors map to typed reasons via ESCROW_ERROR_TO_INVALID_REASON;
   * anything unmapped (e.g. token-collector reverts like consumed ERC-3009
   * nonce) falls through to the generic 'simulation_failed'.
   */
  private async simulateSettle(
    paymentInfo: PaymentInfoStruct,
    amount: bigint,
    wirePayload: AuthCapturePayload,
    extra: AuthCaptureExtra,
    _payer: `0x${string}`,
  ): Promise<'ok' | string> {
    const assetTransferMethod = extra.assetTransferMethod ?? 'eip3009'
    const { tokenCollector, collectorData } = unpackForSettle(wirePayload, assetTransferMethod)
    const functionName = extra.autoCapture === true ? 'charge' : 'authorize'
    const tuple = paymentInfoToContractTuple(paymentInfo)
    const args =
      functionName === 'charge'
        ? ([
            tuple,
            amount,
            tokenCollector,
            collectorData,
            paymentInfo.minFeeBps,
            paymentInfo.feeReceiver,
          ] as const)
        : ([tuple, amount, tokenCollector, collectorData] as const)

    const settleTarget = await this.resolveSettleTarget(extra.captureAuthorizer)

    try {
      await this.signer.readContract({
        address: settleTarget,
        abi: ESCROW_ABI_WITH_ERRORS,
        functionName,
        args,
      })
      return 'ok'
    } catch (err) {
      return decodeRevertReason(err)
    }
  }

  // Spec (scheme_authCapture_evm.md): facilitator calls authorize/charge
  // "either directly or through a smart contract set as the captureAuthorizer".
  // EOA captureAuthorizer ⇒ call escrow directly; contract ⇒ call the
  // captureAuthorizer (which MUST expose the literal `authorize`/`charge`
  // escrow selectors and forward to escrow) so it becomes msg.sender there.
  private async resolveSettleTarget(captureAuthorizer: `0x${string}`): Promise<`0x${string}`> {
    const code = await this.signer.getCode({ address: captureAuthorizer })
    if (!code || code === '0x') return AUTH_CAPTURE_ESCROW_ADDRESS
    return captureAuthorizer
  }
}

// Combined ABI: function definitions + custom-error definitions. viem decodes
// revert data against any error in the ABI passed to the call.
const ESCROW_ABI_WITH_ERRORS = [...ESCROW_ABI, ...ESCROW_ERRORS_ABI] as const

/**
 * Walk a viem error chain to find a decoded custom-error name and map it to
 * a stable invalidReason. Returns 'simulation_failed' for unknown reverts.
 */
function decodeRevertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk(
      (e): e is ContractFunctionRevertedError => e instanceof ContractFunctionRevertedError,
    )
    if (revert instanceof ContractFunctionRevertedError) {
      const errorName = revert.data?.errorName
      if (errorName && errorName in ESCROW_ERROR_TO_INVALID_REASON) {
        return ESCROW_ERROR_TO_INVALID_REASON[errorName]
      }
    }
  }
  return 'simulation_failed'
}

/**
 * Unpack the per-method settle inputs (token collector address + collectorData
 * encoding). EIP-3009 collectors take the full ReceiveWithAuthorization signature
 * directly; Permit2 collectors take the encoded permit signature.
 */
function unpackForSettle(
  wirePayload: AuthCapturePayload,
  assetTransferMethod: 'eip3009' | 'permit2',
): {
  preApprovalExpiry: number
  amount: bigint
  tokenCollector: `0x${string}`
  collectorData: `0x${string}`
} {
  if (assetTransferMethod === 'eip3009') {
    const p = wirePayload as Eip3009Payload
    return {
      preApprovalExpiry: Number(p.authorization.validBefore),
      amount: BigInt(p.authorization.value),
      tokenCollector: EIP3009_TOKEN_COLLECTOR_ADDRESS,
      collectorData: p.signature,
    }
  }
  const p = wirePayload as Permit2Payload
  // Permit2 collector expects the raw signature; the collector itself reconstructs
  // the PermitTransferFrom struct from PaymentInfo (deterministic nonce + payer).
  return {
    preApprovalExpiry: Number(p.permit2Authorization.deadline),
    amount: BigInt(p.permit2Authorization.permitted.amount),
    tokenCollector: PERMIT2_TOKEN_COLLECTOR_ADDRESS,
    collectorData: encodeAbiParameters([{ name: 'signature', type: 'bytes' }], [p.signature]),
  }
}
