/**
 * Escrow Scheme - Facilitator
 * Handles verification and settlement of escrow payments
 */

import type { PublicClient, WalletClient } from "viem";
import { OPERATOR_ABI } from "../../shared/constants.js";
import { verifyERC3009Signature } from "../../shared/nonce.js";
import type { EscrowExtra, EscrowPayload } from "../../shared/types.js";

/**
 * Parse chainId from CAIP-2 network identifier
 * @param network - CAIP-2 network identifier (e.g., 'eip155:84532')
 * @returns The chain ID as a number
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

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  payload: unknown;
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  extra: EscrowExtra;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  transaction?: string;
  network: string;
  payer?: string;
}

export type Network = `eip155:${string}`;

export interface FacilitatorEvmSigner {
  address: `0x${string}`;
  writeContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<`0x${string}`>;
  verifyTypedData: (args: {
    address: `0x${string}`;
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: `0x${string}`;
  }) => Promise<boolean>;
}

export interface x402Facilitator {
  register(
    networks: Network | Network[],
    scheme: SchemeNetworkFacilitator,
  ): void;
}

export interface SchemeNetworkFacilitator {
  scheme: string;
  caipFamily: string;
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse>;
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse>;
  getSigners(network: Network): FacilitatorEvmSigner[];
  getExtra(network: Network): Record<string, unknown>;
}

/**
 * Create a FacilitatorEvmSigner from viem clients.
 *
 * Bridges viem's WalletClient and PublicClient into the FacilitatorEvmSigner
 * interface required by EscrowFacilitatorScheme.
 *
 * @param walletClient - viem WalletClient with an account for write operations
 * @param publicClient - viem PublicClient for signature verification
 * @returns A FacilitatorEvmSigner ready for use with EscrowFacilitatorScheme
 *
 * @example
 * ```typescript
 * import { createFacilitatorSigner, EscrowFacilitatorScheme } from '@x402r/evm/escrow/facilitator';
 *
 * const signer = createFacilitatorSigner(walletClient, publicClient);
 * const facilitator = new EscrowFacilitatorScheme(signer);
 * ```
 */
export function createFacilitatorSigner(
  walletClient: WalletClient,
  publicClient: PublicClient,
): FacilitatorEvmSigner {
  const account = walletClient.account!;

  return {
    address: account.address,
    async writeContract(args) {
      const hash = await walletClient.writeContract({
        chain: walletClient.chain,
        account,
        address: args.address,
        abi: args.abi,
        functionName: args.functionName,
        args: args.args as unknown[],
      });
      return hash;
    },
    async verifyTypedData(args) {
      const valid = await publicClient.verifyTypedData({
        address: args.address,
        domain: args.domain,
        types: args.types,
        primaryType: args.primaryType,
        message: args.message,
        signature: args.signature,
      } as Parameters<typeof publicClient.verifyTypedData>[0]);
      return valid;
    },
  };
}

/**
 * Escrow Facilitator Scheme - implements SchemeNetworkFacilitator
 */
export class EscrowFacilitatorScheme implements SchemeNetworkFacilitator {
  readonly scheme = "escrow";
  readonly caipFamily = "eip155";

  constructor(private signer: FacilitatorEvmSigner) {}

  getSigners(_network: Network): FacilitatorEvmSigner[] {
    return [this.signer];
  }

  getExtra(_network: Network): Record<string, unknown> {
    return {};
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const escrowPayload = payload.payload as EscrowPayload;
    const extra = requirements.extra;
    const chainId = parseChainId(requirements.network);

    // Verify ERC-3009 signature
    const isValidSignature = await verifyERC3009Signature(
      this.signer,
      escrowPayload.authorization,
      escrowPayload.signature,
      { ...extra, chainId },
      requirements.asset,
    );

    if (!isValidSignature) {
      return { isValid: false, invalidReason: "Invalid ERC-3009 signature" };
    }

    // Verify amount meets requirements
    if (
      BigInt(escrowPayload.authorization.value) <
      BigInt(requirements.maxAmountRequired)
    ) {
      return { isValid: false, invalidReason: "Insufficient payment amount" };
    }

    // Verify token matches
    if (
      escrowPayload.paymentInfo.token.toLowerCase() !==
      requirements.asset.toLowerCase()
    ) {
      return { isValid: false, invalidReason: "Token mismatch" };
    }

    // Verify receiver matches
    if (
      escrowPayload.paymentInfo.receiver.toLowerCase() !==
      requirements.payTo.toLowerCase()
    ) {
      return { isValid: false, invalidReason: "Receiver mismatch" };
    }

    return {
      isValid: true,
      payer: escrowPayload.authorization.from,
    };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const escrowPayload = payload.payload as EscrowPayload;
    const { authorizeAddress, operatorAddress, tokenCollector } =
      requirements.extra;

    const paymentInfo = {
      operator: escrowPayload.paymentInfo.operator,
      payer: escrowPayload.authorization.from,
      receiver: escrowPayload.paymentInfo.receiver,
      token: escrowPayload.paymentInfo.token,
      maxAmount: BigInt(escrowPayload.paymentInfo.maxAmount),
      preApprovalExpiry: escrowPayload.paymentInfo.preApprovalExpiry,
      authorizationExpiry: escrowPayload.paymentInfo.authorizationExpiry,
      refundExpiry: escrowPayload.paymentInfo.refundExpiry,
      minFeeBps: escrowPayload.paymentInfo.minFeeBps,
      maxFeeBps: escrowPayload.paymentInfo.maxFeeBps,
      feeReceiver: escrowPayload.paymentInfo.feeReceiver,
      salt: BigInt(escrowPayload.paymentInfo.salt),
    };

    // Pass raw signature - ERC3009PaymentCollector expects raw bytes, not ABI-encoded
    const collectorData = escrowPayload.signature;

    const target = authorizeAddress ?? operatorAddress;

    try {
      const txHash = await this.signer.writeContract({
        address: target,
        abi: OPERATOR_ABI,
        functionName: "authorize",
        args: [
          paymentInfo,
          BigInt(escrowPayload.authorization.value),
          tokenCollector,
          collectorData,
        ],
      });

      return {
        success: true,
        transaction: txHash,
        network: requirements.network,
        payer: escrowPayload.authorization.from,
      };
    } catch (error) {
      return {
        success: false,
        errorReason:
          error instanceof Error ? error.message : "Settlement failed",
        network: requirements.network,
        payer: escrowPayload.authorization.from,
      };
    }
  }
}

/**
 * Register escrow scheme with x402Facilitator
 */
export function registerEscrowScheme(
  facilitator: x402Facilitator,
  options: { signer: FacilitatorEvmSigner; networks: Network | Network[] },
): void {
  const scheme = new EscrowFacilitatorScheme(options.signer);
  facilitator.register(options.networks, scheme);
}

export type { EscrowExtra, EscrowPayload } from "../../shared/types.js";
