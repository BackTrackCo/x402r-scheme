/**
 * AuthCapture Scheme - Facilitator
 * Handles verification and settlement of authCapture payments.
 *
 * Implements x402's SchemeNetworkFacilitator interface so the authCapture scheme
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
  BASE_CHAIN_IDS,
} from '../shared/constants'
import { verifyERC3009Signature } from '../shared/nonce'
import { isAuthCapturePayload, isAuthCaptureExtra } from '../shared/types'
import type { AuthCaptureExtra, AuthCapturePayload } from '../shared/types'
import { parseChainId } from '../shared/utils'

/**
 * Build the on-chain PaymentInfo struct from the client's payload.
 * Used by both verify (simulation) and settle (transaction).
 */
function buildPaymentInfo(authCapturePayload: AuthCapturePayload) {
  return {
    operator: authCapturePayload.paymentInfo.operator,
    payer: authCapturePayload.authorization.from,
    receiver: authCapturePayload.paymentInfo.receiver,
    token: authCapturePayload.paymentInfo.token,
    maxAmount: BigInt(authCapturePayload.paymentInfo.maxAmount),
    preApprovalExpiry: authCapturePayload.paymentInfo.preApprovalExpiry,
    authorizationExpiry: authCapturePayload.paymentInfo.authorizationExpiry,
    refundExpiry: authCapturePayload.paymentInfo.refundExpiry,
    minFeeBps: authCapturePayload.paymentInfo.minFeeBps,
    maxFeeBps: authCapturePayload.paymentInfo.maxFeeBps,
    feeReceiver: authCapturePayload.paymentInfo.feeReceiver,
    salt: BigInt(authCapturePayload.paymentInfo.salt),
  }
}

export interface AuthCaptureFacilitatorOptions {
  /** Override default escrowAddress in /supported (default: commerce-payments AuthCaptureEscrow) */
  escrowAddress?: `0x${string}`
  /** Override default tokenCollector in /supported (default: commerce-payments ERC3009PaymentCollector) */
  tokenCollector?: `0x${string}`
}

/**
 * AuthCapture Facilitator Scheme - implements x402's SchemeNetworkFacilitator
 *
 * The facilitator is operator-agnostic: operator addresses are set by the merchant
 * and arrive in `requirements.extra` at verify/settle time.
 *
 * `getExtra()` provides default escrow/tokenCollector addresses (commerce-payments
 * canonical addresses, or custom ones via constructor options). These flow into
 * `enhancePaymentRequirements` which merges them under the merchant's extra —
 * so the merchant can override, but doesn't have to set them if the defaults are fine.
 */
export class AuthCaptureFacilitatorScheme implements SchemeNetworkFacilitator {
  readonly scheme = 'authCapture'
  readonly caipFamily = 'eip155:*'
  private defaultEscrow: `0x${string}`
  private defaultTokenCollector: `0x${string}`
  private hasCustomDefaults: boolean

  constructor(
    private signer: FacilitatorEvmSigner,
    options?: AuthCaptureFacilitatorOptions,
  ) {
    this.defaultEscrow = options?.escrowAddress ?? COMMERCE_PAYMENTS_ESCROW
    this.defaultTokenCollector = options?.tokenCollector ?? COMMERCE_PAYMENTS_TOKEN_COLLECTOR
    this.hasCustomDefaults = !!(options?.escrowAddress || options?.tokenCollector)
  }

  getSigners(_network: string): string[] {
    return [...this.signer.getAddresses()]
  }

  // Default addresses for /supported — enhancePaymentRequirements merges these
  // under the merchant's extra, so merchants override but don't have to specify.
  // Only returns defaults for Base chains where commerce-payments is deployed.
  // On other networks the merchant must provide escrowAddress + tokenCollector.
  getExtra(network: string): Record<string, unknown> | undefined {
    if (!BASE_CHAIN_IDS.has(network) && !this.hasCustomDefaults) {
      return undefined
    }
    return {
      escrowAddress: this.defaultEscrow,
      tokenCollector: this.defaultTokenCollector,
    }
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    // M5: Type guard instead of double cast
    if (!isAuthCapturePayload(payload.payload)) {
      return {
        isValid: false,
        invalidReason: 'invalid_payload_format',
      }
    }
    const authCapturePayload = payload.payload as AuthCapturePayload
    const payer = authCapturePayload.authorization.from

    // Validate scheme on both payload and requirements
    if (payload.accepted.scheme !== 'authCapture' || requirements.scheme !== 'authCapture') {
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
    if (!isAuthCaptureExtra(requirements.extra)) {
      return {
        isValid: false,
        invalidReason: 'invalid_authCapture_extra',
        payer,
      }
    }
    const extra = requirements.extra as AuthCaptureExtra
    const chainId = parseChainId(requirements.network)

    // Time window validation
    const now = Math.floor(Date.now() / 1000)
    const validBefore = Number(authCapturePayload.authorization.validBefore)
    const validAfter = Number(authCapturePayload.authorization.validAfter)

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
    const { signature: signatureForVerify } = parseErc6492Signature(authCapturePayload.signature)

    // Verify ERC-3009 signature
    const isValidSignature = await verifyERC3009Signature(
      this.signer,
      authCapturePayload.authorization,
      signatureForVerify,
      { ...extra, chainId },
      requirements.asset as `0x${string}`,
    )

    if (!isValidSignature) {
      return {
        isValid: false,
        invalidReason: 'invalid_authCapture_signature',
        payer,
      }
    }

    // Verify amount exactly matches requirements
    if (BigInt(authCapturePayload.authorization.value) !== BigInt(requirements.amount)) {
      return {
        isValid: false,
        invalidReason: 'amount_mismatch',
        payer,
      }
    }

    // Verify authorization recipient is the token collector
    if (authCapturePayload.authorization.to.toLowerCase() !== extra.tokenCollector.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: 'token_collector_mismatch',
        payer,
      }
    }

    // Verify token matches
    if (authCapturePayload.paymentInfo.token.toLowerCase() !== requirements.asset.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: 'token_mismatch',
        payer,
      }
    }

    // Verify receiver matches
    if (
      authCapturePayload.paymentInfo.receiver.toLowerCase() !== requirements.payTo.toLowerCase()
    ) {
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
    const paymentInfo = buildPaymentInfo(authCapturePayload)
    const settlementArgs = [
      paymentInfo,
      BigInt(authCapturePayload.authorization.value),
      extra.tokenCollector,
      authCapturePayload.signature,
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

    const authCapturePayload = payload.payload as unknown as AuthCapturePayload
    const extra = requirements.extra as unknown as AuthCaptureExtra

    const paymentInfo = buildPaymentInfo(authCapturePayload)
    const settlementMethod = extra.settlementMethod ?? 'authorize'
    const functionName = settlementMethod === 'charge' ? 'charge' : 'authorize'

    try {
      const txHash = await this.signer.writeContract({
        address: extra.operatorAddress,
        abi: OPERATOR_ABI,
        functionName,
        args: [
          paymentInfo,
          BigInt(authCapturePayload.authorization.value),
          extra.tokenCollector,
          authCapturePayload.signature,
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
          payer: authCapturePayload.authorization.from,
        }
      }

      return {
        success: true,
        transaction: txHash,
        network: requirements.network,
        payer: authCapturePayload.authorization.from,
      }
    } catch (error) {
      return {
        success: false,
        errorReason: error instanceof Error ? error.message : 'Settlement failed',
        transaction: '',
        network: requirements.network,
        payer: authCapturePayload.authorization.from,
      }
    }
  }
}
