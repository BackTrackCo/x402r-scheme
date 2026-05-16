/**
 * AuthCapture Scheme - Server
 * Handles price parsing and requirement enhancement for resource servers.
 *
 * Implements x402's SchemeNetworkServer interface so it can be registered
 * on an x402ResourceServer via server.register('eip155:84532', new AuthCaptureEvmScheme()).
 */

import type {
  AssetAmount,
  MoneyParser,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from "@x402/core/types";
import { convertToTokenAmount, numberToDecimalString } from "@x402/core/utils";
import { getDefaultAsset } from "@x402/evm";
import { AUTH_CAPTURE_SCHEME } from "../constants";

/**
 * Construction-time options for the authCapture server scheme. Both windows
 * are required: they're arbiter policy (a description-mismatch refund arbiter
 * needs a wildly different envelope from a delivery-confirmation arbiter,
 * and a one-shot AI call wants minutes where a SaaS subscription wants weeks)
 * and the SDK has no business guessing on the merchant's behalf. The values
 * are committed on-chain as `paymentInfo.authorizationExpiry` /
 * `paymentInfo.refundExpiry` and enforced literally by escrow: wrong values
 * mean stuck funds or denied refunds. Merchants who need per-request
 * overrides can still set absolute `captureDeadline` / `refundDeadline` on
 * `requirements.extra` directly.
 */
export interface AuthCaptureServerOptions {
  /**
   * Seconds-from-now used to compute `extra.captureDeadline` for each request.
   * Overridden when the merchant has already set `requirements.extra.captureDeadline`.
   */
  captureDeadlineSeconds: number;
  /**
   * Seconds-from-now used to compute `extra.refundDeadline` for each request.
   * Overridden when the merchant has already set `requirements.extra.refundDeadline`.
   */
  refundDeadlineSeconds: number;
}

/**
 * Server-side implementation of the authCapture scheme: maps merchant-friendly
 * prices (`"$0.01"`, decimal numbers, or pre-built `AssetAmount`) to the
 * stablecoin asset + base-unit amount needed in `PaymentRequirements`, computes
 * per-request capture/refund deadlines from merchant-configured windows, and
 * merges facilitator-advertised `extra` fields into the published requirements.
 * Implements `SchemeNetworkServer`.
 */
export class AuthCaptureEvmScheme implements SchemeNetworkServer {
  readonly scheme = AUTH_CAPTURE_SCHEME;
  private moneyParsers: MoneyParser[] = [];
  private readonly captureDeadlineSeconds: number;
  private readonly refundDeadlineSeconds: number;

  /**
   * Construct an authCapture server scheme.
   *
   * @param options - Required per-request deadline windows. See {@link AuthCaptureServerOptions}.
   * @throws If either window is missing, non-positive, or non-finite.
   */
  constructor(options: AuthCaptureServerOptions) {
    if (
      !options ||
      typeof options.captureDeadlineSeconds !== "number" ||
      !Number.isFinite(options.captureDeadlineSeconds) ||
      options.captureDeadlineSeconds <= 0
    ) {
      throw new Error(
        "AuthCaptureEvmScheme requires `captureDeadlineSeconds` (positive seconds-from-now). This is arbiter policy and has no safe default; configure it explicitly.",
      );
    }
    if (
      typeof options.refundDeadlineSeconds !== "number" ||
      !Number.isFinite(options.refundDeadlineSeconds) ||
      options.refundDeadlineSeconds <= 0
    ) {
      throw new Error(
        "AuthCaptureEvmScheme requires `refundDeadlineSeconds` (positive seconds-from-now). This is arbiter policy and has no safe default; configure it explicitly.",
      );
    }
    this.captureDeadlineSeconds = options.captureDeadlineSeconds;
    this.refundDeadlineSeconds = options.refundDeadlineSeconds;
  }

  /**
   * Add a custom money parser to the chain. Parsers run in registration order;
   * the first one to return a non-null `AssetAmount` wins. If every parser
   * returns null, the default network-stablecoin conversion is used.
   *
   * @param parser - Function that maps a decimal amount to an `AssetAmount`, or `null` to defer.
   * @returns This server scheme instance, for fluent chaining.
   */
  registerMoneyParser(parser: MoneyParser): AuthCaptureEvmScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  /**
   * Translate a merchant-supplied `Price` into a fully-resolved `AssetAmount`.
   * Pass-through for `AssetAmount` inputs (with required `asset` validation);
   * otherwise normalizes the input to a decimal, then runs the registered
   * money parser chain, falling back to the default stablecoin for the network.
   *
   * @param price - `"$0.01"` / `0.01` / `{ asset, amount }`.
   * @param network - CAIP-2 network identifier used for default-asset lookup.
   * @returns The resolved `AssetAmount` containing token address and base units.
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === "object" && price !== null && "amount" in price) {
      if (!price.asset) {
        throw new Error(`Asset address must be specified for AssetAmount on network ${network}`);
      }
      return {
        amount: price.amount,
        asset: price.asset,
        extra: price.extra || {},
      };
    }

    const numericAmount = this.parseMoneyToDecimal(price);

    for (const parser of this.moneyParsers) {
      const result = await parser(numericAmount, network);
      if (result !== null) {
        return result;
      }
    }

    return this.defaultMoneyConversion(numericAmount, network);
  }

  /**
   * Merge facilitator-advertised `extra` (from `/supported`) into the
   * merchant's payment requirements, fill in per-request capture/refund
   * deadlines from the configured offsets when the merchant has not set them
   * explicitly, and let the merchant's own `extra` win on collisions. This
   * runs on every request, so `captureDeadline` / `refundDeadline` track the
   * current clock instead of being frozen at server start.
   *
   * @param requirements - The merchant-authored payment requirements.
   * @param supportedKind - The facilitator's advertised support entry for this scheme/network.
   * @param supportedKind.x402Version - Protocol version the facilitator advertises.
   * @param supportedKind.scheme - Scheme identifier (`"authCapture"`).
   * @param supportedKind.network - CAIP-2 network identifier.
   * @param supportedKind.extra - Facilitator-injected `extra` fields (lowest priority on collision).
   * @param _ - Unused list of facilitator extensions (interface compatibility).
   * @returns Enhanced `PaymentRequirements` with merged `extra` and computed deadlines.
   */
  async enhancePaymentRequirements(
    requirements: PaymentRequirements,
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    _: string[],
  ): Promise<PaymentRequirements> {
    const now = Math.floor(Date.now() / 1000);
    return {
      ...requirements,
      extra: {
        ...supportedKind.extra,
        captureDeadline: now + this.captureDeadlineSeconds,
        refundDeadline: now + this.refundDeadlineSeconds,
        ...requirements.extra,
      },
    };
  }

  /**
   * Normalize a `Price` (string or number) to a decimal `number`. Strips `$`
   * and `,` formatting characters from strings before parsing.
   *
   * @param money - Decimal money expressed as a number or formatted string.
   * @returns The parsed decimal amount.
   * @throws If the string does not parse as a number.
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
   * Fall-through converter: resolves a decimal amount against the default
   * stablecoin registered for the network in `@x402/evm`'s `getDefaultAsset`.
   * The EIP-712 token-domain fields (`name` / `version`) are included for
   * tokens used via ERC-3009 or EIP-2612 paths, and `assetTransferMethod` is
   * propagated for chains whose default token does not support ERC-3009.
   *
   * @param amount - Decimal amount in the token's display units.
   * @param network - CAIP-2 network identifier.
   * @returns Resolved `AssetAmount` with the network's default stablecoin.
   * @throws If no default stablecoin is configured for `network`.
   */
  private defaultMoneyConversion(amount: number, network: Network): AssetAmount {
    const assetInfo = getDefaultAsset(network);
    const tokenAmount = convertToTokenAmount(numberToDecimalString(amount), assetInfo.decimals);
    const includeEip712Domain = !assetInfo.assetTransferMethod || assetInfo.supportsEip2612;
    return {
      asset: assetInfo.address,
      amount: tokenAmount,
      extra: {
        ...(includeEip712Domain && {
          name: assetInfo.name,
          version: assetInfo.version,
        }),
        ...(assetInfo.assetTransferMethod && {
          assetTransferMethod: assetInfo.assetTransferMethod,
        }),
      },
    };
  }
}
