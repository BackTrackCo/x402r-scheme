import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hexToBigInt } from 'viem'
import { AuthCaptureFacilitatorScheme } from '../../../src/authCapture/facilitator/scheme'
import {
  AUTH_CAPTURE_ESCROW_ADDRESS,
  EIP3009_TOKEN_COLLECTOR_ADDRESS,
  PERMIT2_TOKEN_COLLECTOR_ADDRESS,
} from '../../../src/authCapture/shared/constants'
import { computePayerAgnosticPaymentInfoHash } from '../../../src/authCapture/shared/nonce'
import type { PaymentInfoStruct } from '../../../src/authCapture/shared/types'

describe('AuthCaptureFacilitatorScheme', () => {
  const createMockSigner = () => ({
    getAddresses: () => ['0x1234567890123456789012345678901234567890'] as readonly `0x${string}`[],
    readContract: vi.fn().mockResolvedValue(BigInt('1000000000')),
    writeContract: vi.fn().mockResolvedValue('0xabcdef1234567890' as `0x${string}`),
    verifyTypedData: vi.fn().mockResolvedValue(true),
    sendTransaction: vi.fn(),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    getCode: vi.fn(),
  })

  let mockSigner: ReturnType<typeof createMockSigner>

  beforeEach(() => {
    vi.clearAllMocks()
    mockSigner = createMockSigner()
  })

  const futureSeconds = Math.floor(Date.now() / 1000) + 3600
  const captureDeadline = futureSeconds + 86400
  const refundDeadline = captureDeadline + 86400

  const PAYER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`
  const ASSET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`
  const PAY_TO = '0xdddddddddddddddddddddddddddddddddddddddd' as `0x${string}`
  const CAPTURE_AUTHORIZER = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`
  const FEE_RECIPIENT = '0x4444444444444444444444444444444444444444' as `0x${string}`
  const SALT = '0x0000000000000000000000000000000000000000000000000000000000000abc' as `0x${string}`

  const mockRequirements = {
    scheme: 'authCapture',
    network: 'eip155:84532',
    amount: '1000000',
    asset: ASSET,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: {
      captureAuthorizer: CAPTURE_AUTHORIZER,
      captureDeadline,
      refundDeadline,
      feeRecipient: FEE_RECIPIENT,
      maxFeeBps: 100,
      name: 'USDC',
      version: '2',
    },
  }

  // Build a PaymentInfoStruct that matches what the facilitator will reconstruct.
  function buildPaymentInfo(): PaymentInfoStruct {
    return {
      operator: CAPTURE_AUTHORIZER,
      payer: PAYER,
      receiver: PAY_TO,
      token: ASSET,
      maxAmount: '1000000',
      preApprovalExpiry: futureSeconds,
      authorizationExpiry: captureDeadline,
      refundExpiry: refundDeadline,
      minFeeBps: 0,
      maxFeeBps: 100,
      feeReceiver: FEE_RECIPIENT,
      salt: SALT,
    }
  }

  function buildEip3009Payload() {
    const paymentInfo = buildPaymentInfo()
    const nonce = computePayerAgnosticPaymentInfoHash(84532, paymentInfo)
    return {
      x402Version: 2,
      scheme: 'authCapture',
      resource: { url: 'https://example.com/weather', method: 'GET' },
      accepted: { ...mockRequirements },
      payload: {
        authorization: {
          from: PAYER,
          to: EIP3009_TOKEN_COLLECTOR_ADDRESS,
          value: '1000000',
          validAfter: '0',
          validBefore: String(futureSeconds),
          nonce,
        },
        signature: '0xabcd' as `0x${string}`,
        salt: SALT,
      },
    }
  }

  function buildPermit2Payload() {
    const paymentInfo = buildPaymentInfo()
    const nonce = computePayerAgnosticPaymentInfoHash(84532, paymentInfo)
    return {
      x402Version: 2,
      scheme: 'authCapture',
      resource: { url: 'https://example.com/weather', method: 'GET' },
      accepted: { ...mockRequirements },
      payload: {
        permit2Authorization: {
          from: PAYER,
          permitted: { token: ASSET, amount: '1000000' },
          spender: PERMIT2_TOKEN_COLLECTOR_ADDRESS,
          nonce: hexToBigInt(nonce).toString(),
          deadline: String(futureSeconds),
        },
        signature: '0xabcd' as `0x${string}`,
        salt: SALT,
      },
    }
  }

  describe('settle — autoCapture routing', () => {
    it('should default to authorize when autoCapture is absent', async () => {
      const scheme = new AuthCaptureFacilitatorScheme(mockSigner)
      await scheme.settle(buildEip3009Payload(), mockRequirements)

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'authorize' }),
      )
    })

    it('should call charge when autoCapture is true', async () => {
      const scheme = new AuthCaptureFacilitatorScheme(mockSigner)
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, autoCapture: true },
      }
      await scheme.settle(buildEip3009Payload(), reqs)

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'charge' }),
      )
    })

    it('should call authorize when autoCapture is false', async () => {
      const scheme = new AuthCaptureFacilitatorScheme(mockSigner)
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, autoCapture: false },
      }
      await scheme.settle(buildEip3009Payload(), reqs)

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'authorize' }),
      )
    })
  })

  describe('settle — target address', () => {
    it('should target the canonical AuthCaptureEscrow address', async () => {
      const scheme = new AuthCaptureFacilitatorScheme(mockSigner)
      await scheme.settle(buildEip3009Payload(), mockRequirements)

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ address: AUTH_CAPTURE_ESCROW_ADDRESS }),
      )
    })

    it('should pass EIP3009_TOKEN_COLLECTOR as the tokenCollector arg for eip3009', async () => {
      const scheme = new AuthCaptureFacilitatorScheme(mockSigner)
      await scheme.settle(buildEip3009Payload(), mockRequirements)

      const call = mockSigner.writeContract.mock.calls[0][0]
      expect(call.args[2]).toBe(EIP3009_TOKEN_COLLECTOR_ADDRESS)
    })

    it('should pass PERMIT2_TOKEN_COLLECTOR as the tokenCollector arg for permit2', async () => {
      const scheme = new AuthCaptureFacilitatorScheme(mockSigner)
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, assetTransferMethod: 'permit2' as const },
      }
      await scheme.settle(buildPermit2Payload(), reqs)

      const call = mockSigner.writeContract.mock.calls[0][0]
      expect(call.args[2]).toBe(PERMIT2_TOKEN_COLLECTOR_ADDRESS)
    })
  })

  describe('verify — invariants', () => {
    it('should reject when extra is missing required fields', async () => {
      const scheme = new AuthCaptureFacilitatorScheme(mockSigner)
      const bad = {
        ...mockRequirements,
        extra: { name: 'USDC', version: '2' } as unknown as typeof mockRequirements.extra,
      }
      const result = await scheme.verify(buildEip3009Payload(), bad)
      expect(result.isValid).toBe(false)
      expect(result.invalidReason).toBe('invalid_authCapture_extra')
    })

    it('should reject when refundDeadline is not after captureDeadline', async () => {
      const scheme = new AuthCaptureFacilitatorScheme(mockSigner)
      const bad = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, refundDeadline: captureDeadline - 1 },
      }
      const result = await scheme.verify(buildEip3009Payload(), bad)
      expect(result.isValid).toBe(false)
      expect(result.invalidReason).toBe('invalid_deadline_ordering')
    })

    it('should reject when payload method does not match assetTransferMethod', async () => {
      const scheme = new AuthCaptureFacilitatorScheme(mockSigner)
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, assetTransferMethod: 'permit2' as const },
      }
      const result = await scheme.verify(buildEip3009Payload(), reqs)
      expect(result.isValid).toBe(false)
      expect(result.invalidReason).toBe('payload_method_mismatch')
    })

    it('should reject when EIP-3009 payload.to is not the canonical collector', async () => {
      const scheme = new AuthCaptureFacilitatorScheme(mockSigner)
      const payload = buildEip3009Payload()
      payload.payload.authorization.to =
        '0x9999999999999999999999999999999999999999' as `0x${string}`
      const result = await scheme.verify(payload, mockRequirements)
      expect(result.isValid).toBe(false)
      expect(result.invalidReason).toBe('token_collector_mismatch')
    })
  })

  describe('getExtra', () => {
    it('should return undefined — escrow + tokenCollector are constants, not advertised', () => {
      const scheme = new AuthCaptureFacilitatorScheme(mockSigner)
      expect(scheme.getExtra('eip155:8453')).toBeUndefined()
    })
  })
})
