/**
 * Escrow Scheme - Server
 * Handles price parsing and requirement enhancement for resource servers.
 *
 * Implements x402's SchemeNetworkServer interface so it can be registered
 * on an x402ResourceServer via server.register('eip155:84532', new EscrowServerScheme()).
 */

import type { EscrowExtra } from "../../shared/types.js";

/**
 * x402 PaymentRequirements (matches @x402/core/types PaymentRequirements)
 */
export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}

/**
 * x402 AssetAmount (matches @x402/core/types AssetAmount)
 */
export interface AssetAmount {
  asset: string;
  amount: string;
  extra?: Record<string, unknown>;
}

/**
 * x402 Price type (matches @x402/core/types Price)
 */
export type Price = string | number | AssetAmount;

export type Network = `${string}:${string}`;

/**
 * Known USDC addresses per network
 */
const USDC_ADDRESSES: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

/**
 * Server scheme - handles price parsing and requirement enhancement.
 * Implements x402's SchemeNetworkServer interface.
 */
export class EscrowServerScheme {
  readonly scheme = "escrow";
  private readonly decimals: number;

  constructor(config?: { decimals?: number }) {
    this.decimals = config?.decimals ?? 6; // USDC default
  }

  /**
   * Parse a price into an x402 AssetAmount.
   *
   * Accepts x402's Price type:
   * - string: "$0.01", "0.01", "10000"
   * - number: 0.01
   * - AssetAmount: { asset: "0x...", amount: "10000" }
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    // If already an AssetAmount, pass through
    if (
      typeof price === "object" &&
      price !== null &&
      "amount" in price &&
      "asset" in price
    ) {
      return price as AssetAmount;
    }

    // Convert to number for calculation
    let numericAmount: number;
    if (typeof price === "number") {
      numericAmount = price;
    } else {
      const cleaned = String(price).replace(/[$,]/g, "").trim();
      numericAmount = parseFloat(cleaned);
    }

    if (isNaN(numericAmount)) {
      throw new Error(`Cannot parse price: ${price}`);
    }

    const rawAmount = BigInt(Math.round(numericAmount * 10 ** this.decimals));
    const asset = USDC_ADDRESSES[network];
    if (!asset) {
      throw new Error(`No USDC address configured for network: ${network}`);
    }

    return {
      asset,
      amount: rawAmount.toString(),
    };
  }

  /**
   * Enhance payment requirements with facilitator's extra fields.
   *
   * Merges supportedKind.extra (from facilitator's /supported endpoint) into
   * the requirements, so escrow addresses flow from facilitator → merchant
   * requirements automatically.
   */
  async enhancePaymentRequirements(
    requirements: PaymentRequirements,
    supportedKind: SupportedKind,
    _facilitatorExtensions: string[],
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

export type { EscrowExtra, EscrowPayload } from "../../shared/types.js";
