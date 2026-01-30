import { describe, it, expect } from 'vitest';
import { computeEscrowNonce, generateSalt } from '../src/shared/nonce.js';

describe('nonce utilities', () => {
  describe('computeEscrowNonce', () => {
    const mockPaymentInfo = {
      operator: '0x1111111111111111111111111111111111111111' as const,
      receiver: '0x2222222222222222222222222222222222222222' as const,
      token: '0x3333333333333333333333333333333333333333' as const,
      maxAmount: '1000000',
      preApprovalExpiry: 281474976710655,
      authorizationExpiry: 281474976710655,
      refundExpiry: 281474976710655,
      minFeeBps: 0,
      maxFeeBps: 100,
      feeReceiver: '0x4444444444444444444444444444444444444444' as const,
      salt: '0x0000000000000000000000000000000000000000000000000000000000000001' as const,
    };

    it('should produce a 32-byte hex string', () => {
      const escrowAddress = '0x5555555555555555555555555555555555555555' as const;
      const chainId = 84532;

      const nonce = computeEscrowNonce(chainId, escrowAddress, mockPaymentInfo);

      expect(nonce).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should produce deterministic results for same inputs', () => {
      const escrowAddress = '0x5555555555555555555555555555555555555555' as const;
      const chainId = 84532;

      const nonce1 = computeEscrowNonce(chainId, escrowAddress, mockPaymentInfo);
      const nonce2 = computeEscrowNonce(chainId, escrowAddress, mockPaymentInfo);

      expect(nonce1).toBe(nonce2);
    });

    it('should produce different results for different chainIds', () => {
      const escrowAddress = '0x5555555555555555555555555555555555555555' as const;

      const nonce1 = computeEscrowNonce(84532, escrowAddress, mockPaymentInfo);
      const nonce2 = computeEscrowNonce(8453, escrowAddress, mockPaymentInfo);

      expect(nonce1).not.toBe(nonce2);
    });

    it('should produce different results for different escrow addresses', () => {
      const chainId = 84532;

      const nonce1 = computeEscrowNonce(
        chainId,
        '0x5555555555555555555555555555555555555555' as const,
        mockPaymentInfo
      );
      const nonce2 = computeEscrowNonce(
        chainId,
        '0x6666666666666666666666666666666666666666' as const,
        mockPaymentInfo
      );

      expect(nonce1).not.toBe(nonce2);
    });

    it('should produce different results for different payment info', () => {
      const escrowAddress = '0x5555555555555555555555555555555555555555' as const;
      const chainId = 84532;

      const nonce1 = computeEscrowNonce(chainId, escrowAddress, mockPaymentInfo);
      const nonce2 = computeEscrowNonce(chainId, escrowAddress, {
        ...mockPaymentInfo,
        maxAmount: '2000000',
      });

      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('generateSalt', () => {
    it('should produce a 32-byte hex string', () => {
      const salt = generateSalt();

      expect(salt).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should produce unique values on each call', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      const salt3 = generateSalt();

      expect(salt1).not.toBe(salt2);
      expect(salt2).not.toBe(salt3);
      expect(salt1).not.toBe(salt3);
    });

    it('should produce valid hex characters only', () => {
      const salt = generateSalt();

      // Remove 0x prefix and check all characters are valid hex
      const hexPart = salt.slice(2);
      expect(hexPart).toMatch(/^[0-9a-f]+$/);
    });
  });
});
