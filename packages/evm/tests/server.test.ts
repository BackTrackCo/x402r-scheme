import { describe, it, expect } from 'vitest';
import { EscrowServerScheme } from '../src/escrow/server/index.js';

describe('EscrowServerScheme', () => {
  describe('parsePrice', () => {
    it('should parse dollar amounts with default decimals (6 for USDC)', async () => {
      const scheme = new EscrowServerScheme();
      const result = await scheme.parsePrice('$1.00', 'eip155:84532');

      expect(result.value).toBe(1_000_000n);
      expect(result.decimals).toBe(6);
    });

    it('should parse amounts without dollar sign', async () => {
      const scheme = new EscrowServerScheme();
      const result = await scheme.parsePrice('0.50', 'eip155:84532');

      expect(result.value).toBe(500_000n);
    });

    it('should parse small amounts correctly', async () => {
      const scheme = new EscrowServerScheme();
      const result = await scheme.parsePrice('$0.01', 'eip155:84532');

      expect(result.value).toBe(10_000n);
    });

    it('should parse large amounts correctly', async () => {
      const scheme = new EscrowServerScheme();
      const result = await scheme.parsePrice('$1000.00', 'eip155:84532');

      expect(result.value).toBe(1_000_000_000n);
    });

    it('should handle amounts with commas', async () => {
      const scheme = new EscrowServerScheme();
      const result = await scheme.parsePrice('$1,000.50', 'eip155:84532');

      expect(result.value).toBe(1_000_500_000n);
    });

    it('should use custom decimals when configured', async () => {
      const scheme = new EscrowServerScheme({ decimals: 18 });
      const result = await scheme.parsePrice('$1.00', 'eip155:84532');

      expect(result.value).toBe(1_000_000_000_000_000_000n);
      expect(result.decimals).toBe(18);
    });

    it('should handle zero amounts', async () => {
      const scheme = new EscrowServerScheme();
      const result = await scheme.parsePrice('$0.00', 'eip155:84532');

      expect(result.value).toBe(0n);
    });
  });

  describe('enhancePaymentRequirements', () => {
    it('should merge extra fields from supportedKind', async () => {
      const scheme = new EscrowServerScheme();

      const requirements = {
        scheme: 'escrow',
        network: 'eip155:84532',
        maxAmountRequired: '1000000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
        payTo: '0x1234567890123456789012345678901234567890' as const,
      };

      const supportedKind = {
        scheme: 'escrow',
        network: 'eip155:84532',
        extra: {
          escrowAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          operatorAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      };

      const result = await scheme.enhancePaymentRequirements(
        requirements,
        supportedKind,
        []
      );

      expect(result.extra).toEqual({
        escrowAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        operatorAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });
    });

    it('should preserve existing extra fields from requirements', async () => {
      const scheme = new EscrowServerScheme();

      const requirements = {
        scheme: 'escrow',
        network: 'eip155:84532',
        maxAmountRequired: '1000000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
        payTo: '0x1234567890123456789012345678901234567890' as const,
        extra: {
          customField: 'custom-value',
        },
      };

      const supportedKind = {
        scheme: 'escrow',
        network: 'eip155:84532',
        extra: {
          escrowAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      };

      const result = await scheme.enhancePaymentRequirements(
        requirements,
        supportedKind,
        []
      );

      expect(result.extra).toEqual({
        escrowAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        customField: 'custom-value',
      });
    });

    it('should let requirements extra override supportedKind extra', async () => {
      const scheme = new EscrowServerScheme();

      const requirements = {
        scheme: 'escrow',
        network: 'eip155:84532',
        maxAmountRequired: '1000000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
        payTo: '0x1234567890123456789012345678901234567890' as const,
        extra: {
          escrowAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
        },
      };

      const supportedKind = {
        scheme: 'escrow',
        network: 'eip155:84532',
        extra: {
          escrowAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      };

      const result = await scheme.enhancePaymentRequirements(
        requirements,
        supportedKind,
        []
      );

      // Requirements extra should override supportedKind extra
      expect(result.extra?.escrowAddress).toBe('0xcccccccccccccccccccccccccccccccccccccccc');
    });

    it('should preserve all original requirement fields', async () => {
      const scheme = new EscrowServerScheme();

      const requirements = {
        scheme: 'escrow',
        network: 'eip155:84532',
        maxAmountRequired: '1000000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
        payTo: '0x1234567890123456789012345678901234567890' as const,
      };

      const supportedKind = {
        scheme: 'escrow',
        network: 'eip155:84532',
      };

      const result = await scheme.enhancePaymentRequirements(
        requirements,
        supportedKind,
        []
      );

      expect(result.scheme).toBe('escrow');
      expect(result.network).toBe('eip155:84532');
      expect(result.maxAmountRequired).toBe('1000000');
      expect(result.asset).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
      expect(result.payTo).toBe('0x1234567890123456789012345678901234567890');
    });
  });

  describe('scheme property', () => {
    it('should have scheme set to "escrow"', () => {
      const scheme = new EscrowServerScheme();
      expect(scheme.scheme).toBe('escrow');
    });
  });
});
