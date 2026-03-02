import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EscrowFacilitatorScheme } from '../../../src/escrow/facilitator/scheme'

describe('EscrowFacilitatorScheme', () => {
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

  describe('settle — settlementMethod routing', () => {
    const futureTimestamp = '2000000000'

    const mockPayload = {
      x402Version: 2,
      scheme: 'escrow',
      resource: { url: 'https://example.com/weather', method: 'GET' },
      accepted: {
        scheme: 'escrow',
        network: 'eip155:84532',
        amount: '1000000',
        asset: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        payTo: '0xdddddddddddddddddddddddddddddddddddddddd',
        maxTimeoutSeconds: 60,
        extra: {},
      },
      payload: {
        authorization: {
          from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
          to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
          value: '1000000',
          validAfter: '0',
          validBefore: futureTimestamp,
          nonce: '0x1234567890123456789012345678901234567890123456789012345678901234' as const,
        },
        signature: '0xabcd' as const,
        paymentInfo: {
          operator: '0xcccccccccccccccccccccccccccccccccccccccc' as const,
          receiver: '0xdddddddddddddddddddddddddddddddddddddddd' as const,
          token: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
          maxAmount: '1000000',
          preApprovalExpiry: 0,
          authorizationExpiry: 4294967295,
          refundExpiry: 281474976710655,
          minFeeBps: 0,
          maxFeeBps: 100,
          feeReceiver: '0xcccccccccccccccccccccccccccccccccccccccc' as const,
          salt: '0x0000000000000000000000000000000000000000000000000000000000000001' as const,
        },
      },
    }

    const mockRequirements = {
      scheme: 'escrow',
      network: 'eip155:84532',
      amount: '1000000',
      asset: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
      payTo: '0xdddddddddddddddddddddddddddddddddddddddd' as const,
      maxTimeoutSeconds: 60,
      extra: {
        escrowAddress: '0xffffffffffffffffffffffffffffffffffffffffffff' as const,
        operatorAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as const,
        tokenCollector: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
        name: 'USDC',
        version: '2',
      },
    }

    it('should default to authorize when settlementMethod is absent', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner)
      await scheme.settle(mockPayload, mockRequirements)

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'authorize',
        }),
      )
    })

    it('should call authorize when settlementMethod is explicitly "authorize"', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner)

      const requirementsWithAuthorize = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          settlementMethod: 'authorize' as const,
        },
      }

      await scheme.settle(mockPayload, requirementsWithAuthorize)

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'authorize',
        }),
      )
    })

    it('should call charge when settlementMethod is "charge"', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner)

      const requirementsWithCharge = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          settlementMethod: 'charge' as const,
        },
      }

      await scheme.settle(mockPayload, requirementsWithCharge)

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'charge',
        }),
      )
    })

    it('should fall back to authorize for unknown settlementMethod', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner)

      const requirementsWithUnknown = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          settlementMethod: 'unknown' as unknown,
        },
      }

      await scheme.settle(mockPayload, requirementsWithUnknown)

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'authorize',
        }),
      )
    })

    it('should always target operatorAddress', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner)
      await scheme.settle(mockPayload, mockRequirements)

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: '0xcccccccccccccccccccccccccccccccccccccccc',
        }),
      )
    })
  })
})
