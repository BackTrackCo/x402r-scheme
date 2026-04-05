import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommerceEvmScheme } from '../../../src/commerce/client/index'
import { x402Client } from '@x402/core/client'
import { registerCommerceEvmScheme } from '../../../src/commerce/client/index'

describe('CommerceEvmScheme', () => {
  const createMockSigner = () => ({
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
    signTypedData: vi.fn().mockResolvedValue('0xdeadbeef' as `0x${string}`),
  })

  let mockSigner: ReturnType<typeof createMockSigner>

  beforeEach(() => {
    mockSigner = createMockSigner()
  })

  const mockRequirements = {
    scheme: 'commerce',
    network: 'eip155:84532',
    amount: '1000000',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo: '0x1234567890123456789012345678901234567890',
    maxTimeoutSeconds: 3600,
    extra: {
      escrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
      operatorAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as const,
      tokenCollector: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
      name: 'USDC',
      version: '2',
    },
  }

  describe('constructor and properties', () => {
    it('should have scheme set to "commerce"', () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      expect(scheme.scheme).toBe('commerce')
    })
  })

  describe('createPaymentPayload', () => {
    it('should create a valid payment payload for x402Version 2', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      const result = await scheme.createPaymentPayload(2, mockRequirements)

      expect(result.x402Version).toBe(2)
      expect(result.payload).toBeDefined()
      expect(result.payload.authorization).toBeDefined()
      expect(result.payload.signature).toBe('0xdeadbeef')
      expect(result.payload.paymentInfo).toBeDefined()
    })

    it('should throw for unsupported x402Version', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)

      await expect(scheme.createPaymentPayload(1, mockRequirements)).rejects.toThrow(
        'Unsupported x402Version: 1. Only version 2 is supported.',
      )
    })

    it('should throw for x402Version 0', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)

      await expect(scheme.createPaymentPayload(0, mockRequirements)).rejects.toThrow(
        'Unsupported x402Version: 0',
      )
    })

    it('should throw for x402Version 3', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)

      await expect(scheme.createPaymentPayload(3, mockRequirements)).rejects.toThrow(
        'Unsupported x402Version: 3',
      )
    })

    it('should throw when EIP-712 name is missing', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      const requirementsNoName = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, name: '' },
      }

      await expect(scheme.createPaymentPayload(2, requirementsNoName)).rejects.toThrow(
        "EIP-712 domain parameter 'name' is required",
      )
    })

    it('should throw when EIP-712 version is missing', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      const requirementsNoVersion = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, version: '' },
      }

      await expect(scheme.createPaymentPayload(2, requirementsNoVersion)).rejects.toThrow(
        "EIP-712 domain parameter 'version' is required",
      )
    })

    it('should set authorization.from to signer address', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      const result = await scheme.createPaymentPayload(2, mockRequirements)

      expect(result.payload.authorization.from).toBe(mockSigner.address)
    })

    it('should set authorization.to to tokenCollector', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      const result = await scheme.createPaymentPayload(2, mockRequirements)

      expect(result.payload.authorization.to).toBe(mockRequirements.extra.tokenCollector)
    })

    it('should set authorization.value to requirements amount', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      const result = await scheme.createPaymentPayload(2, mockRequirements)

      expect(result.payload.authorization.value).toBe('1000000')
    })

    it('should set paymentInfo fields correctly', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      const result = await scheme.createPaymentPayload(2, mockRequirements)

      expect(result.payload.paymentInfo.operator).toBe(mockRequirements.extra.operatorAddress)
      expect(result.payload.paymentInfo.receiver).toBe(mockRequirements.payTo)
      expect(result.payload.paymentInfo.token).toBe(mockRequirements.asset)
    })

    it('should default feeReceiver to zeroAddress when not specified', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      const result = await scheme.createPaymentPayload(2, mockRequirements)

      expect(result.payload.paymentInfo.feeReceiver).toBe(
        '0x0000000000000000000000000000000000000000',
      )
    })

    it('should use provided feeReceiver when specified', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      const requirementsWithFeeReceiver = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          feeReceiver: '0x1111111111111111111111111111111111111111' as const,
        },
      }
      const result = await scheme.createPaymentPayload(2, requirementsWithFeeReceiver)

      expect(result.payload.paymentInfo.feeReceiver).toBe(
        '0x1111111111111111111111111111111111111111',
      )
    })

    it('should convert expirySeconds to absolute timestamps', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      const nowSeconds = Math.floor(Date.now() / 1000)
      const requirementsWithExpiries = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          preApprovalExpirySeconds: 3600,
          authorizationExpirySeconds: 86400,
          refundExpirySeconds: 604800,
        },
      }
      const result = await scheme.createPaymentPayload(2, requirementsWithExpiries)

      // Allow 5s tolerance for test execution time
      expect(result.payload.paymentInfo.preApprovalExpiry).toBeGreaterThanOrEqual(
        nowSeconds + 3600 - 5,
      )
      expect(result.payload.paymentInfo.preApprovalExpiry).toBeLessThanOrEqual(
        nowSeconds + 3600 + 5,
      )
      expect(result.payload.paymentInfo.authorizationExpiry).toBeGreaterThanOrEqual(
        nowSeconds + 86400 - 5,
      )
      expect(result.payload.paymentInfo.authorizationExpiry).toBeLessThanOrEqual(
        nowSeconds + 86400 + 5,
      )
      expect(result.payload.paymentInfo.refundExpiry).toBeGreaterThanOrEqual(
        nowSeconds + 604800 - 5,
      )
      expect(result.payload.paymentInfo.refundExpiry).toBeLessThanOrEqual(nowSeconds + 604800 + 5)
    })

    it('should throw for invalid network format', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      const badNetworkRequirements = {
        ...mockRequirements,
        network: 'solana:mainnet',
      }

      await expect(scheme.createPaymentPayload(2, badNetworkRequirements)).rejects.toThrow(
        'Invalid network format',
      )
    })

    it('should call signTypedData on signer', async () => {
      const scheme = new CommerceEvmScheme(mockSigner)
      await scheme.createPaymentPayload(2, mockRequirements)

      expect(mockSigner.signTypedData).toHaveBeenCalledOnce()
    })
  })

  describe('registerCommerceEvmScheme', () => {
    it('should register scheme without throwing', () => {
      const client = new x402Client()
      expect(() =>
        registerCommerceEvmScheme(client, {
          signer: mockSigner,
          networks: 'eip155:84532',
        }),
      ).not.toThrow()
    })

    it('should register scheme for multiple networks without throwing', () => {
      const client = new x402Client()
      expect(() =>
        registerCommerceEvmScheme(client, {
          signer: mockSigner,
          networks: ['eip155:84532', 'eip155:8453'],
        }),
      ).not.toThrow()
    })

    it('should return the client for chaining', () => {
      const client = new x402Client()
      const result = registerCommerceEvmScheme(client, {
        signer: mockSigner,
        networks: 'eip155:84532',
      })

      expect(result).toBe(client)
    })
  })
})
