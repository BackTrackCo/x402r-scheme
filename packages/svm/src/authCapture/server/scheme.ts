/**
 * AuthCapture (SVM) server scheme. Parses prices, enhances payment
 * requirements with SVM-specific extras (`feePayer`, `captureAuthorizer`,
 * deadlines, fee policy, `protocolFeeBps`, `protocolFeeReceiver`). The escrow
 * and collector program IDs are canonical per cluster and resolved by clients
 * and facilitators from `requirements.network`, not carried on the wire.
 *
 * Mirrors EVM `AuthCaptureServerScheme` shape so a merchant can swap
 * `eip155:*` ↔ `solana:*` and the rest of their integration is unchanged.
 */

import type {
  AssetAmount,
  MoneyParser,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from "@x402/core/types";
import { SVM_DEVNET, SVM_MAINNET, USDC_MINTS, type SvmCluster } from "../shared/constants";

const ASSET_INFO: Record<SvmCluster, { decimals: number; mint: string }> = {
  [SVM_DEVNET]: { decimals: 6, mint: USDC_MINTS[SVM_DEVNET] },
  [SVM_MAINNET]: { decimals: 6, mint: USDC_MINTS[SVM_MAINNET] },
};

function convertToTokenAmount(decimalAmount: string, decimals: number): string {
  const amount = parseFloat(decimalAmount);
  if (isNaN(amount)) throw new Error(`Invalid amount: ${decimalAmount}`);
  const [intPart, decPart = ""] = String(amount).split(".");
  const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
  const tokenAmount = (intPart + paddedDec).replace(/^0+/, "") || "0";
  return tokenAmount;
}

export class AuthCaptureSvmServerScheme implements SchemeNetworkServer {
  readonly scheme = "authCapture";
  private moneyParsers: MoneyParser[] = [];

  registerMoneyParser(parser: MoneyParser): AuthCaptureSvmServerScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === "object" && price !== null && "amount" in price) {
      if (!price.asset) {
        throw new Error(`Asset address must be specified for AssetAmount on network ${network}`);
      }
      return { amount: price.amount, asset: price.asset, extra: price.extra || {} };
    }
    const numericAmount = parseMoneyToDecimal(price);
    for (const parser of this.moneyParsers) {
      const result = await parser(numericAmount, network);
      if (result !== null) return result;
    }
    return this.defaultMoneyConversion(numericAmount, network);
  }

  private defaultMoneyConversion(amount: number, network: Network): AssetAmount {
    if (network !== SVM_DEVNET && network !== SVM_MAINNET) {
      throw new Error(`No USDC mint configured for SVM network: ${network}`);
    }
    const info = ASSET_INFO[network];
    return {
      asset: info.mint,
      amount: convertToTokenAmount(String(amount), info.decimals),
      extra: {},
    };
  }

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
      extra: { ...supportedKind.extra, ...requirements.extra },
    };
  }
}

function parseMoneyToDecimal(money: string | number): number {
  if (typeof money === "number") return money;
  const cleaned = String(money).replace(/[$,]/g, "").trim();
  const amount = parseFloat(cleaned);
  if (isNaN(amount)) throw new Error(`Cannot parse price: ${money}`);
  return amount;
}
