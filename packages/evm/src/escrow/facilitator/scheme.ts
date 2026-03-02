/**
 * Escrow Scheme - Facilitator
 * Handles verification and settlement of escrow payments.
 *
 * Implements x402's SchemeNetworkFacilitator interface so the escrow scheme
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
import { OPERATOR_ABI, ERC20_BALANCE_OF_ABI } from '../shared/constants'
import { verifyERC3009Signature } from '../shared/nonce'
import { isEscrowPayload, isEscrowExtra } from '../shared/types'
import type { EscrowExtra, EscrowPayload } from '../shared/types'
import { parseChainId } from '../shared/utils'

/**
 * Escrow Facilitator Scheme - implements x402's SchemeNetworkFacilitator
 *
 * The facilitator is operator-agnostic: it does not store operator/escrow/tokenCollector
 * config. Those values are set by the merchant via `refundable()` and arrive in
 * `requirements.extra` at verify/settle time.
 */
export class EscrowFacilitatorScheme implements SchemeNetworkFacilitator {
  readonly scheme = 'escrow'
  readonly caipFamily = 'eip155:*'

  constructor(private signer: FacilitatorEvmSigner) {}

  getSigners(_network: string): string[] {
    return [...this.signer.getAddresses()]
  }

  // C4: name/version now come from server's parsePrice() via AssetAmount.extra.
  // The facilitator should not hardcode token-specific metadata.
  getExtra(_network: string): Record<string, unknown> | undefined {
    return undefined
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    // M5: Type guard instead of double cast
    if (!isEscrowPayload(payload.payload)) {
      return {
        isValid: false,
        invalidReason: 'invalid_payload_format',
      }
    }
    const escrowPayload = payload.payload as EscrowPayload
    const payer = escrowPayload.authorization.from

    // Validate scheme on both payload and requirements
    if (payload.accepted.scheme !== 'escrow' || requirements.scheme !== 'escrow') {
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
    if (!isEscrowExtra(requirements.extra)) {
      return {
        isValid: false,
        invalidReason: 'invalid_escrow_extra',
        payer,
      }
    }
    const extra = requirements.extra as EscrowExtra
    const chainId = parseChainId(requirements.network)

    // Time window validation
    const now = Math.floor(Date.now() / 1000)
    const validBefore = Number(escrowPayload.authorization.validBefore)
    const validAfter = Number(escrowPayload.authorization.validAfter)

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
    const { signature: signatureForVerify } = parseErc6492Signature(escrowPayload.signature)

    // Verify ERC-3009 signature
    const isValidSignature = await verifyERC3009Signature(
      this.signer,
      escrowPayload.authorization,
      signatureForVerify,
      { ...extra, chainId },
      requirements.asset as `0x${string}`,
    )

    if (!isValidSignature) {
      return {
        isValid: false,
        invalidReason: 'invalid_escrow_signature',
        payer,
      }
    }

    // Verify amount meets requirements
    if (BigInt(escrowPayload.authorization.value) < BigInt(requirements.amount)) {
      return {
        isValid: false,
        invalidReason: 'insufficient_amount',
        payer,
      }
    }

    // Verify token matches
    if (escrowPayload.paymentInfo.token.toLowerCase() !== requirements.asset.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: 'token_mismatch',
        payer,
      }
    }

    // Verify receiver matches
    if (escrowPayload.paymentInfo.receiver.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: 'receiver_mismatch',
        payer,
      }
    }

    // H4: Balance check — verify payer has sufficient token balance
    try {
      const balance = await this.signer.readContract({
        address: requirements.asset as `0x${string}`,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [payer],
      })

      if (BigInt(balance as string) < BigInt(requirements.amount)) {
        return {
          isValid: false,
          invalidReason: 'insufficient_balance',
          payer,
        }
      }
    } catch {
      // If balance check fails (e.g., non-standard token), skip it.
      // The on-chain transaction will fail anyway if balance is insufficient.
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

    const escrowPayload = payload.payload as unknown as EscrowPayload
    const extra = requirements.extra as unknown as EscrowExtra
    const { operatorAddress, tokenCollector } = extra

    const paymentInfo = {
      operator: escrowPayload.paymentInfo.operator,
      payer: escrowPayload.authorization.from,
      receiver: escrowPayload.paymentInfo.receiver,
      token: escrowPayload.paymentInfo.token,
      maxAmount: BigInt(escrowPayload.paymentInfo.maxAmount),
      preApprovalExpiry: escrowPayload.paymentInfo.preApprovalExpiry,
      authorizationExpiry: escrowPayload.paymentInfo.authorizationExpiry,
      refundExpiry: escrowPayload.paymentInfo.refundExpiry,
      minFeeBps: escrowPayload.paymentInfo.minFeeBps,
      maxFeeBps: escrowPayload.paymentInfo.maxFeeBps,
      feeReceiver: escrowPayload.paymentInfo.feeReceiver,
      salt: BigInt(escrowPayload.paymentInfo.salt),
    }

    // Pass raw signature — ERC3009PaymentCollector/ERC6492SignatureHandler
    // handles EIP-6492 unwrapping and wallet deployment on-chain
    const collectorData = escrowPayload.signature

    const target = operatorAddress
    const settlementMethod = extra.settlementMethod ?? 'authorize'
    const functionName = settlementMethod === 'charge' ? 'charge' : 'authorize'

    try {
      const txHash = await this.signer.writeContract({
        address: target,
        abi: OPERATOR_ABI,
        functionName,
        args: [
          paymentInfo,
          BigInt(escrowPayload.authorization.value),
          tokenCollector,
          collectorData,
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
          payer: escrowPayload.authorization.from,
        }
      }

      return {
        success: true,
        transaction: txHash,
        network: requirements.network,
        payer: escrowPayload.authorization.from,
      }
    } catch (error) {
      return {
        success: false,
        errorReason: error instanceof Error ? error.message : 'Settlement failed',
        transaction: '',
        network: requirements.network,
        payer: escrowPayload.authorization.from,
      }
    }
  }
}
