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
  // Base
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  // Ethereum
  "eip155:11155111": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  "eip155:1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  // Polygon
  "eip155:80002": "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
  "eip155:137": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  // Arbitrum
  "eip155:421614": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "eip155:42161": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  // Celo
  "eip155:44787": "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
  "eip155:42220": "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
  // Monad
  "eip155:10143": "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  "eip155:143": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  // Avalanche
  "eip155:43113": "0x5425890298aed601595a70AB815c96711a31Bc65",
  "eip155:43114": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
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
