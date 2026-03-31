/**
 * Commerce Scheme - Facilitator
 * Handles verification and settlement of commerce payments.
 *
 * Implements x402's SchemeNetworkFacilitator interface so the commerce scheme
 * is a drop-in for the x402 facilitator, just like ExactEvmScheme.
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
import { parseErc6492Signature } from 'viem'
import {
  OPERATOR_ABI,
  ERC20_BALANCE_OF_ABI,
  COMMERCE_PAYMENTS_ESCROW,
  COMMERCE_PAYMENTS_TOKEN_COLLECTOR,
} from '../shared/constants'
import { verifyERC3009Signature } from '../shared/nonce'
import { isCommercePayload, isCommerceExtra } from '../shared/types'
import type { CommerceExtra, CommercePayload } from '../shared/types'
import { parseChainId } from '../shared/utils'

/** Resolve CommerceExtra with commerce-payments defaults for optional fields. */
function resolveExtra(raw: CommerceExtra): CommerceExtra & { tokenCollector: `0x${string}` } {
  return {
    ...raw,
    tokenCollector: raw.tokenCollector ?? COMMERCE_PAYMENTS_TOKEN_COLLECTOR,
  }
}

/**
 * Build the on-chain PaymentInfo struct from the client's payload.
 * Used by both verify (simulation) and settle (transaction).
 */
function buildPaymentInfo(commercePayload: CommercePayload) {
  return {
    operator: commercePayload.paymentInfo.operator,
    payer: commercePayload.authorization.from,
    receiver: commercePayload.paymentInfo.receiver,
    token: commercePayload.paymentInfo.token,
    maxAmount: BigInt(commercePayload.paymentInfo.maxAmount),
    preApprovalExpiry: commercePayload.paymentInfo.preApprovalExpiry,
    authorizationExpiry: commercePayload.paymentInfo.authorizationExpiry,
    refundExpiry: commercePayload.paymentInfo.refundExpiry,
    minFeeBps: commercePayload.paymentInfo.minFeeBps,
    maxFeeBps: commercePayload.paymentInfo.maxFeeBps,
    feeReceiver: commercePayload.paymentInfo.feeReceiver,
    salt: BigInt(commercePayload.paymentInfo.salt),
  }
}

/**
 * Commerce Facilitator Scheme - implements x402's SchemeNetworkFacilitator
 *
 * The facilitator is operator-agnostic: operator addresses are set by the merchant
 * and arrive in `requirements.extra` at verify/settle time. Base commerce-payments
 * addresses (escrow, tokenCollector) are provided as defaults via `getExtra()` and
 * can be overridden by the merchant's `extra` config.
 */
export class CommerceFacilitatorScheme implements SchemeNetworkFacilitator {
  readonly scheme = 'commerce'
  readonly caipFamily = 'eip155:*'

  constructor(private signer: FacilitatorEvmSigner) {}

  getSigners(_network: string): string[] {
    return [...this.signer.getAddresses()]
  }

  // Provide default commerce-payments addresses from Base's commerce-payments.
  // Merchant's extra overrides these (enhancePaymentRequirements merges facilitator
  // extras under merchant extras), so merchants with custom escrow addresses win.
  getExtra(_network: string): Record<string, unknown> {
    return {
      escrowAddress: COMMERCE_PAYMENTS_ESCROW,
      tokenCollector: COMMERCE_PAYMENTS_TOKEN_COLLECTOR,
    }
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    // M5: Type guard instead of double cast
    if (!isCommercePayload(payload.payload)) {
      return {
        isValid: false,
        invalidReason: 'invalid_payload_format',
      }
    }
    const commercePayload = payload.payload as CommercePayload
    const payer = commercePayload.authorization.from

    // Validate scheme on both payload and requirements
    if (payload.accepted.scheme !== 'commerce' || requirements.scheme !== 'commerce') {
      return {
        isValid: false,
        invalidReason: 'unsupported_scheme',
        payer,
      }
    }

    // Validate network matches between payload and requirements
    if (payload.accepted.network !== requirements.network) {
      return {
        isValid: false,
        invalidReason: 'network_mismatch',
        payer,
      }
    }

    // Validate network format
    const networkParts = requirements.network.split(':')
    if (networkParts.length !== 2 || networkParts[0] !== 'eip155') {
      return {
        isValid: false,
        invalidReason: 'invalid_network',
        payer,
      }
    }

    // M5: Type guard for extra
    if (!isCommerceExtra(requirements.extra)) {
      return {
        isValid: false,
        invalidReason: 'invalid_commerce_extra',
        payer,
      }
    }
    const extra = resolveExtra(requirements.extra as CommerceExtra)
    const chainId = parseChainId(requirements.network)

    // Time window validation
    const now = Math.floor(Date.now() / 1000)
    const validBefore = Number(commercePayload.authorization.validBefore)
    const validAfter = Number(commercePayload.authorization.validAfter)

    if (validBefore <= now + 6) {
      return {
        isValid: false,
        invalidReason: 'authorization_expired',
        payer,
      }
    }

    if (validAfter > now) {
      return {
        isValid: false,
        invalidReason: 'authorization_not_yet_valid',
        payer,
      }
    }

    // Extract inner signature for verification if EIP-6492 wrapped.
    // The contract's ERC6492SignatureHandler handles deployment; the facilitator
    // only needs the inner ECDSA signature for ecrecover verification.
    const { signature: signatureForVerify } = parseErc6492Signature(commercePayload.signature)

    // Verify ERC-3009 signature
    const isValidSignature = await verifyERC3009Signature(
      this.signer,
      commercePayload.authorization,
      signatureForVerify,
      { ...extra, chainId },
      requirements.asset as `0x${string}`,
    )

    if (!isValidSignature) {
      return {
        isValid: false,
        invalidReason: 'invalid_commerce_signature',
        payer,
      }
    }

    // Verify amount exactly matches requirements
    if (BigInt(commercePayload.authorization.value) !== BigInt(requirements.amount)) {
      return {
        isValid: false,
        invalidReason: 'amount_mismatch',
        payer,
      }
    }

    // Verify authorization recipient is the token collector
    if (commercePayload.authorization.to.toLowerCase() !== extra.tokenCollector.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: 'token_collector_mismatch',
        payer,
      }
    }

    // Verify token matches
    if (commercePayload.paymentInfo.token.toLowerCase() !== requirements.asset.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: 'token_mismatch',
        payer,
      }
    }

    // Verify receiver matches
    if (commercePayload.paymentInfo.receiver.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: 'receiver_mismatch',
        payer,
      }
    }

    // Simulate the settlement transaction via eth_call to catch issues before
    // spending gas (balance, consumed nonces, domain mismatches, contract errors).
    const settlementMethod = extra.settlementMethod ?? 'authorize'
    const functionName = settlementMethod === 'charge' ? 'charge' : 'authorize'
    const paymentInfo = buildPaymentInfo(commercePayload)
    const settlementArgs = [
      paymentInfo,
      BigInt(commercePayload.authorization.value),
      extra.tokenCollector,
      commercePayload.signature,
    ] as const

    try {
      await this.signer.readContract({
        address: extra.operatorAddress,
        abi: OPERATOR_ABI,
        functionName,
        args: settlementArgs,
      })
    } catch {
      // Simulation failed — check balance for a more actionable error
      try {
        const balance = (await this.signer.readContract({
          address: requirements.asset as `0x${string}`,
          abi: ERC20_BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [payer],
        })) as bigint

        if (balance < BigInt(requirements.amount)) {
          return {
            isValid: false,
            invalidReason: 'insufficient_balance',
            payer,
          }
        }
      } catch {
        // Balance check also failed (e.g., RPC outage)
      }

      // Hard reject on simulation failure — matches exact scheme behavior.
      // Safer to reject than accept a payment that may revert on-chain.
      return {
        isValid: false,
        invalidReason: 'simulation_failed',
        payer,
      }
    }

    return {
      isValid: true,
      payer,
    }
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<SettleResponse> {
    // H2: Re-verify before settling to catch expired/invalid payloads
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

    const commercePayload = payload.payload as unknown as CommercePayload
    const rawExtra = requirements.extra as unknown as CommerceExtra
    const extra = {
      ...rawExtra,
      tokenCollector:
        rawExtra.tokenCollector ?? (COMMERCE_PAYMENTS_TOKEN_COLLECTOR as `0x${string}`),
    }

    const paymentInfo = buildPaymentInfo(commercePayload)
    const settlementMethod = extra.settlementMethod ?? 'authorize'
    const functionName = settlementMethod === 'charge' ? 'charge' : 'authorize'

    try {
      const txHash = await this.signer.writeContract({
        address: extra.operatorAddress,
        abi: OPERATOR_ABI,
        functionName,
        args: [
          paymentInfo,
          BigInt(commercePayload.authorization.value),
          extra.tokenCollector,
          commercePayload.signature,
        ],
      })

      // Wait for transaction confirmation with 60s timeout to avoid hanging on stuck txs
      const receiptPromise = this.signer.waitForTransactionReceipt({
        hash: txHash,
      })
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
          payer: commercePayload.authorization.from,
        }
      }

      return {
        success: true,
        transaction: txHash,
        network: requirements.network,
        payer: commercePayload.authorization.from,
      }
    } catch (error) {
      return {
        success: false,
        errorReason: error instanceof Error ? error.message : 'Settlement failed',
        transaction: '',
        network: requirements.network,
        payer: commercePayload.authorization.from,
      }
    }
  }
}
