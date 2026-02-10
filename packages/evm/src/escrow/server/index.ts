/**
 * Escrow Scheme - Server
 * Handles price parsing and requirement enhancement for resource servers.
 *
 * Implements x402's SchemeNetworkServer interface so it can be registered
 * on an x402ResourceServer via server.register('eip155:84532', new EscrowServerScheme()).
 */

import type {
  AssetAmount,
  MoneyParser,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from "@x402/core/types";
import { x402ResourceServer } from "@x402/core/server";

/**
 * Asset info including EIP-712 domain parameters per network
 */
const ASSET_INFO: Record<
  string,
  { address: string; name: string; version: string; decimals: number }
> = {
  // Base Sepolia
  "eip155:84532": {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    name: "USDC",
    version: "2",
    decimals: 6,
  },
  // Base mainnet
  "eip155:8453": {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    name: "USD Coin",
    version: "2",
    decimals: 6,
  },
  // Ethereum Sepolia
  "eip155:11155111": {
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    name: "USDC",
    version: "2",
    decimals: 6,
  },
  // Ethereum mainnet
  "eip155:1": {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    name: "USD Coin",
    version: "2",
    decimals: 6,
  },
  // Polygon
  "eip155:137": {
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    name: "USD Coin",
    version: "2",
    decimals: 6,
  },
  // Arbitrum
  "eip155:42161": {
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    name: "USD Coin",
    version: "2",
    decimals: 6,
  },
  // Celo
  "eip155:42220": {
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    name: "USD Coin",
    version: "2",
    decimals: 6,
  },
  // Monad
  "eip155:143": {
    address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    name: "USDC",
    version: "2",
    decimals: 6,
  },
  // Avalanche
  "eip155:43114": {
    address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    name: "USD Coin",
    version: "2",
    decimals: 6,
  },
};

/**
 * Convert decimal amount to token units using string-based conversion
 * (e.g., 0.10 -> 100000 for 6-decimal tokens)
 * Avoids floating-point precision issues from BigInt(Math.round(...))
 */
function convertToTokenAmount(decimalAmount: string, decimals: number): string {
  const amount = parseFloat(decimalAmount);
  if (isNaN(amount)) {
    throw new Error(`Invalid amount: ${decimalAmount}`);
  }
  const [intPart, decPart = ""] = String(amount).split(".");
  const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
  const tokenAmount = (intPart + paddedDec).replace(/^0+/, "") || "0";
  return tokenAmount;
}

/**
 * Server scheme - handles price parsing and requirement enhancement.
 * Implements x402's SchemeNetworkServer interface.
 */
export class EscrowServerScheme implements SchemeNetworkServer {
  readonly scheme = "escrow";
  private moneyParsers: MoneyParser[] = [];

  /**
   * Register a custom money parser in the parser chain.
   * Multiple parsers can be registered — they will be tried in registration order.
   * Each parser receives a decimal amount (e.g., 1.50 for $1.50).
   * If a parser returns null, the next parser in the chain will be tried.
   * The default parser (USDC) is always the final fallback.
   *
   * @param parser - Custom function to convert amount to AssetAmount (or null to skip)
   * @returns The server instance for chaining
   */
  registerMoneyParser(parser: MoneyParser): EscrowServerScheme {
    this.moneyParsers.push(parser);
    return this;
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
    // If already an AssetAmount, pass through with validation
    if (
      typeof price === "object" &&
      price !== null &&
      "amount" in price
    ) {
      if (!price.asset) {
        throw new Error(
          `Asset address must be specified for AssetAmount on network ${network}`,
        );
      }
      return {
        amount: price.amount,
        asset: price.asset,
        extra: price.extra || {},
      };
    }

    // Parse Money to decimal number
    const numericAmount = this.parseMoneyToDecimal(price);

    // Try each custom money parser in order
    for (const parser of this.moneyParsers) {
      const result = await parser(numericAmount, network);
      if (result !== null) {
        return result;
      }
    }

    // All custom parsers returned null (or none registered), use default conversion
    return this.defaultMoneyConversion(numericAmount, network);
  }

  /**
   * Parse Money (string | number) to a decimal number.
   */
  private parseMoneyToDecimal(money: string | number): number {
    if (typeof money === "number") {
      return money;
    }
    const cleaned = String(money).replace(/[$,]/g, "").trim();
    const amount = parseFloat(cleaned);
    if (isNaN(amount)) {
      throw new Error(`Cannot parse price: ${money}`);
    }
    return amount;
  }

  /**
   * Default money conversion — converts decimal amount to the default stablecoin on the network.
   */
  private defaultMoneyConversion(amount: number, network: Network): AssetAmount {
    const assetInfo = ASSET_INFO[network];
    if (!assetInfo) {
      throw new Error(`No USDC address configured for network: ${network}`);
    }

    const tokenAmount = convertToTokenAmount(
      String(amount),
      assetInfo.decimals,
    );

    return {
      asset: assetInfo.address,
      amount: tokenAmount,
      extra: {
        name: assetInfo.name,
        version: assetInfo.version,
      },
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
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
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

/**
 * Register escrow server scheme with x402ResourceServer
 *
 * @example
 * ```typescript
 * const server = new x402ResourceServer(facilitatorConfig);
 * registerEscrowServerScheme(server, { networks: "eip155:84532" });
 * ```
 */
export function registerEscrowServerScheme(
  server: x402ResourceServer,
  config: { networks: Network | Network[] },
): x402ResourceServer {
  const scheme = new EscrowServerScheme();
  const networks = Array.isArray(config.networks)
    ? config.networks
    : [config.networks];
  for (const network of networks) {
    server.register(network, scheme);
  }
  return server;
}

export type { EscrowExtra, EscrowPayload } from "../../shared/types.js";
