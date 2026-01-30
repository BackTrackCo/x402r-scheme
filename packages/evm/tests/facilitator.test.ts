import { describe, it, expect, vi } from 'vitest';
import { EscrowFacilitatorScheme } from '../src/escrow/facilitator/index.js';

describe('EscrowFacilitatorScheme', () => {
  // Mock signer for testing
  const mockSigner = {
    address: '0x1234567890123456789012345678901234567890' as const,
    writeContract: vi.fn().mockResolvedValue('0xabcdef1234567890' as `0x${string}`),
    verifyTypedData: vi.fn().mockResolvedValue(true),
  };

  describe('constructor and properties', () => {
    it('should have scheme set to "escrow"', () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);
      expect(scheme.scheme).toBe('escrow');
    });

    it('should have caipFamily set to "eip155"', () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);
      expect(scheme.caipFamily).toBe('eip155');
    });
  });

  describe('getSigners', () => {
    it('should return array containing the configured signer', () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);
      const signers = scheme.getSigners('eip155:84532');

      expect(signers).toHaveLength(1);
      expect(signers[0]).toBe(mockSigner);
    });
  });

  describe('getExtra', () => {
    it('should return empty object', () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);
      const extra = scheme.getExtra('eip155:84532');

      expect(extra).toEqual({});
    });
  });

  describe('verify', () => {
    const mockPayload = {
      x402Version: 1,
      scheme: 'escrow',
      payload: {
        authorization: {
          from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
          to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
          value: '1000000',
          validAfter: '0',
          validBefore: '9999999999',
          nonce: '0x1234567890123456789012345678901234567890123456789012345678901234' as const,
        },
        signature: '0xabcd' as const,
        paymentInfo: {
          operator: '0xcccccccccccccccccccccccccccccccccccccccc' as const,
          receiver: '0xdddddddddddddddddddddddddddddddddddddddd' as const,
          token: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
          maxAmount: '1000000',
          authorizationExpiry: 4294967295,
          refundExpiry: 281474976710655,
          minFeeBps: 0,
          maxFeeBps: 100,
          feeReceiver: '0xcccccccccccccccccccccccccccccccccccccccc' as const,
          salt: '0x0000000000000000000000000000000000000000000000000000000000000001' as const,
        },
      },
    };

    const mockRequirements = {
      scheme: 'escrow',
      network: 'eip155:84532',
      maxAmountRequired: '1000000',
      asset: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
      payTo: '0xdddddddddddddddddddddddddddddddddddddddd' as const,
      extra: {
        escrowAddress: '0xffffffffffffffffffffffffffffffffffffffffffff' as const,
        operatorAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as const,
        tokenCollector: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
      },
    };

    it('should return valid when signature is valid and amounts match', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);
      const result = await scheme.verify(mockPayload, mockRequirements);

      expect(result.isValid).toBe(true);
      expect(result.payer).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    });

    it('should return invalid when signature verification fails', async () => {
      const failingSigner = {
        ...mockSigner,
        verifyTypedData: vi.fn().mockResolvedValue(false),
      };

      const scheme = new EscrowFacilitatorScheme(failingSigner);
      const result = await scheme.verify(mockPayload, mockRequirements);

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('Invalid ERC-3009 signature');
    });

    it('should return invalid when amount is insufficient', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);

      const insufficientPayload = {
        ...mockPayload,
        payload: {
          ...mockPayload.payload,
          authorization: {
            ...mockPayload.payload.authorization,
            value: '500000', // Less than required
          },
        },
      };

      const result = await scheme.verify(insufficientPayload, mockRequirements);

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('Insufficient payment amount');
    });

    it('should return invalid when token mismatches', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);

      const wrongTokenPayload = {
        ...mockPayload,
        payload: {
          ...mockPayload.payload,
          paymentInfo: {
            ...mockPayload.payload.paymentInfo,
            token: '0x1111111111111111111111111111111111111111' as const,
          },
        },
      };

      const result = await scheme.verify(wrongTokenPayload, mockRequirements);

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('Token mismatch');
    });

    it('should return invalid when receiver mismatches', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);

      const wrongReceiverPayload = {
        ...mockPayload,
        payload: {
          ...mockPayload.payload,
          paymentInfo: {
            ...mockPayload.payload.paymentInfo,
            receiver: '0x1111111111111111111111111111111111111111' as const,
          },
        },
      };

      const result = await scheme.verify(wrongReceiverPayload, mockRequirements);

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('Receiver mismatch');
    });

    it('should parse chainId from network correctly', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);

      // This tests that parseChainId is called correctly internally
      // by checking verify works with different network formats
      const mainnetRequirements = {
        ...mockRequirements,
        network: 'eip155:8453',
      };

      const result = await scheme.verify(mockPayload, mainnetRequirements);
      expect(result.isValid).toBe(true);
    });
  });

  describe('settle', () => {
    const mockPayload = {
      x402Version: 1,
      scheme: 'escrow',
      payload: {
        authorization: {
          from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
          to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
          value: '1000000',
          validAfter: '0',
          validBefore: '9999999999',
          nonce: '0x1234567890123456789012345678901234567890123456789012345678901234' as const,
        },
        signature: '0xabcd' as const,
        paymentInfo: {
          operator: '0xcccccccccccccccccccccccccccccccccccccccc' as const,
          receiver: '0xdddddddddddddddddddddddddddddddddddddddd' as const,
          token: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
          maxAmount: '1000000',
          authorizationExpiry: 4294967295,
          refundExpiry: 281474976710655,
          minFeeBps: 0,
          maxFeeBps: 100,
          feeReceiver: '0xcccccccccccccccccccccccccccccccccccccccc' as const,
          salt: '0x0000000000000000000000000000000000000000000000000000000000000001' as const,
        },
      },
    };

    const mockRequirements = {
      scheme: 'escrow',
      network: 'eip155:84532',
      maxAmountRequired: '1000000',
      asset: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
      payTo: '0xdddddddddddddddddddddddddddddddddddddddd' as const,
      extra: {
        escrowAddress: '0xffffffffffffffffffffffffffffffffffffffffffff' as const,
        operatorAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as const,
        tokenCollector: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
      },
    };

    it('should return success with transaction hash on successful settlement', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);
      const result = await scheme.settle(mockPayload, mockRequirements);

      expect(result.success).toBe(true);
      expect(result.transaction).toBe('0xabcdef1234567890');
      expect(result.network).toBe('eip155:84532');
      expect(result.payer).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    });

    it('should call writeContract with correct parameters', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);
      await scheme.settle(mockPayload, mockRequirements);

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: '0xcccccccccccccccccccccccccccccccccccccccc',
          functionName: 'authorize',
        })
      );
    });

    it('should return error when writeContract fails', async () => {
      const failingSigner = {
        ...mockSigner,
        writeContract: vi.fn().mockRejectedValue(new Error('Transaction failed')),
      };

      const scheme = new EscrowFacilitatorScheme(failingSigner);
      const result = await scheme.settle(mockPayload, mockRequirements);

      expect(result.success).toBe(false);
      expect(result.errorReason).toBe('Transaction failed');
      expect(result.network).toBe('eip155:84532');
    });

    it('should use authorizeAddress if provided in extra', async () => {
      const scheme = new EscrowFacilitatorScheme(mockSigner);

      const requirementsWithAuthorizeAddress = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          authorizeAddress: '0x9999999999999999999999999999999999999999' as const,
        },
      };

      await scheme.settle(mockPayload, requirementsWithAuthorizeAddress);

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: '0x9999999999999999999999999999999999999999',
        })
      );
    });
  });
});
