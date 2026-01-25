/**
 * Escrow Scheme - Server
 * Handles price parsing and requirement enhancement for resource servers
 */

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  extra?: Record<string, unknown>;
}

export interface SupportedKind {
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}

export interface AssetAmount {
  value: bigint;
  decimals: number;
}

export type Network = `eip155:${string}`;

/**
 * Server scheme - handles price parsing and requirement enhancement
 */
export class EscrowServerScheme {
  readonly scheme = 'escrow';
  private readonly decimals: number;

  constructor(config?: { decimals?: number }) {
    this.decimals = config?.decimals ?? 6; // USDC default
  }

  /**
   * Parse a price string like "$0.01" into an asset amount
   */
  async parsePrice(price: string, _network: Network): Promise<AssetAmount> {
    const cleaned = price.replace(/[$,]/g, '').trim();
    const amount = parseFloat(cleaned);
    const value = BigInt(Math.round(amount * 10 ** this.decimals));
    return { value, decimals: this.decimals };
  }

  /**
   * Enhance payment requirements with facilitator's extra fields
   */
  async enhancePaymentRequirements(
    requirements: PaymentRequirements,
    supportedKind: SupportedKind,
    _facilitatorExtensions: string[]
  ): Promise<PaymentRequirements> {
    return {
      ...requirements,
      extra: {
        ...supportedKind.extra,
        ...requirements.extra,
      },
    };
  }
}

export type { EscrowExtra, EscrowPayload } from '../../shared/types.js';
