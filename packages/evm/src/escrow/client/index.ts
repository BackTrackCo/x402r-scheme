/**
 * Escrow Scheme - Client
 * Creates payment payloads for escrow payments.
 *
 * Implements x402's SchemeNetworkClient interface so it can be registered
 * on an x402Client via client.register('eip155:84532', new EscrowEvmScheme(signer)).
 */

import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import type { ClientEvmSigner } from "@x402/evm";
import { x402Client } from "@x402/core/client";
import {
  computeEscrowNonce,
  signERC3009,
  generateSalt,
} from "../../shared/nonce.js";
import { MAX_UINT48 } from "../../shared/constants.js";
import type { EscrowExtra } from "../../shared/types.js";

/**
 * Parse chainId from CAIP-2 network identifier
 */
function parseChainId(network: string): number {
  const parts = network.split(":");
  if (parts.length !== 2 || parts[0] !== "eip155") {
    throw new Error(
      `Invalid network format: ${network}. Expected 'eip155:<chainId>'`,
    );
  }
  const chainId = parseInt(parts[1], 10);
  if (isNaN(chainId)) {
    throw new Error(`Invalid chainId in network: ${network}`);
  }
  return chainId;
}

/**
 * Escrow Client Scheme - implements x402's SchemeNetworkClient
 */
export class EscrowEvmScheme implements SchemeNetworkClient {
  readonly scheme = "escrow";

  constructor(private readonly signer: ClientEvmSigner) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    const extra = requirements.extra as unknown as EscrowExtra;

    // Validate required EIP-712 domain parameters (M3, M10)
    if (!extra.name) {
      throw new Error(
        `EIP-712 domain parameter 'name' is required in payment requirements for asset ${requirements.asset}`,
      );
    }
    if (!extra.version) {
      throw new Error(
        `EIP-712 domain parameter 'version' is required in payment requirements for asset ${requirements.asset}`,
      );
    }

    const {
      escrowAddress,
      operatorAddress,
      tokenCollector,
      minFeeBps = 0,
      maxFeeBps = 0,
      feeReceiver,
      preApprovalExpirySeconds,
      refundExpirySeconds,
      authorizationExpirySeconds,
    } = extra;

    const chainId = parseChainId(requirements.network);
    const maxAmount = requirements.amount;

    const paymentInfo = {
      operator: operatorAddress,
      receiver: requirements.payTo as `0x${string}`,
      token: requirements.asset as `0x${string}`,
      maxAmount,
      preApprovalExpiry: preApprovalExpirySeconds ?? MAX_UINT48,
      authorizationExpiry: authorizationExpirySeconds ?? MAX_UINT48,
      refundExpiry: refundExpirySeconds ?? MAX_UINT48,
      minFeeBps,
      maxFeeBps,
      feeReceiver: feeReceiver ?? operatorAddress,
      salt: generateSalt(),
    };

    const nonce = computeEscrowNonce(chainId, escrowAddress, paymentInfo);

    // ERC-3009 authorization - validBefore MUST match what contract passes to receiveWithAuthorization
    // The contract uses paymentInfo.preApprovalExpiry as validBefore
    const authorization = {
      from: this.signer.address,
      to: tokenCollector,
      value: maxAmount,
      validAfter: "0",
      validBefore: String(paymentInfo.preApprovalExpiry),
      nonce,
    };

    const signature = await signERC3009(
      this.signer,
      authorization,
      extra,
      requirements.asset as `0x${string}`,
      chainId,
    );

    return {
      x402Version,
      payload: { authorization, signature, paymentInfo },
    };
  }
}

/**
 * Register escrow client scheme with x402Client
 *
 * @example
 * ```typescript
 * const client = new x402Client();
 * registerEscrowScheme(client, { signer, networks: "eip155:84532" });
 * ```
 */
export function registerEscrowScheme(
  client: x402Client,
  config: { signer: ClientEvmSigner; networks: Network | Network[] },
): x402Client {
  const scheme = new EscrowEvmScheme(config.signer);
  const networks = Array.isArray(config.networks)
    ? config.networks
    : [config.networks];
  for (const network of networks) {
    client.register(network, scheme);
  }
  return client;
}

/**
 * @deprecated Use `new EscrowEvmScheme(signer)` directly
 */
export const EscrowScheme = {
  scheme: "escrow" as const,
};

export type { EscrowExtra, EscrowPayload } from "../../shared/types.js";
