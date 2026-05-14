/**
 * AuthCapture (SVM) client scheme.
 *
 * Builds a partial-signed Solana transaction whose inner instruction is
 * `auth_capture_escrow::authorize` or `auth_capture_escrow::charge`. Direct
 * port of the EVM commerce-payments flow: client signs an authorization,
 * facilitator submits to escrow. The escrow CPIs into the canonical
 * `spl-token-collector` for the cluster for the actual SPL transfer. Escrow
 * and collector program IDs are resolved from `requirements.network` via the
 * SDK pin table — not from `extra`.
 *
 * The captureAuthorizer (= `paymentInfo.operator`) must sign at the partial-tx
 * level (typically the facilitator co-signs as both feePayer and operator
 * before submitting). The simplest production setup is
 * `extra.captureAuthorizer == feePayer`.
 */

import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  prependTransactionMessageInstruction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  setTransactionMessageComputeUnitPrice,
} from "@solana-program/compute-budget";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import type { ClientSvmSigner, ClientSvmConfig } from "@x402/svm";
import { createRpcClient } from "@x402/svm";

import { PROGRAM_IDS } from "../shared/constants";
import { generateSalt, paymentInfoHash } from "../shared/nonce";
import {
  findPaymentStatePda,
  findProtocolFeeConfigPda,
} from "../shared/pda";
import {
  isAuthCaptureSvmExtra,
  type AuthCaptureSvmExtra,
  type AuthCaptureSvmPayload,
  type PaymentInfoSvm,
  type SplitEntry,
} from "../shared/types";
import { parseSvmCluster } from "../shared/utils";
import { encodeEscrowAuthorizeIx, encodeEscrowChargeIx } from "./encoder";

const DEFAULT_COMPUTE_UNIT_LIMIT = 300_000;
const DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1n;

export interface AuthCaptureSvmClientOptions {
  signer: ClientSvmSigner;
  config?: ClientSvmConfig;
  /** Operator-fee bps the captureAuthorizer will request on `charge`. Must
   *  satisfy `[minFeeBps, maxFeeBps]` from extra. Defaults to `minFeeBps`. */
  defaultChargeOperatorBps?: number;
}

export class AuthCaptureSvmScheme implements SchemeNetworkClient {
  readonly scheme = "authCapture";

  constructor(private readonly opts: AuthCaptureSvmClientOptions) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    if (x402Version !== 2) {
      throw new Error(`Unsupported x402Version: ${x402Version}. Only version 2 is supported.`);
    }
    if (!isAuthCaptureSvmExtra(requirements.extra)) {
      throw new Error("requirements.extra is not a valid AuthCaptureSvmExtra");
    }
    const extra = requirements.extra as AuthCaptureSvmExtra;
    if (typeof requirements.maxTimeoutSeconds !== "number") {
      throw new Error(
        "requirements.maxTimeoutSeconds is required (preApprovalExpiry derives from it)",
      );
    }

    const cluster = parseSvmCluster(requirements.network);
    const { authCaptureEscrow: escrowProgramId, splTokenCollector: collectorProgramId } =
      PROGRAM_IDS[cluster];

    const rpc = createRpcClient(
      requirements.network as `${string}:${string}`,
      this.opts.config?.rpcUrl,
    );
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const preApprovalExpiry = nowSeconds + BigInt(requirements.maxTimeoutSeconds);
    const salt = generateSalt();
    const amount = BigInt(requirements.amount);

    const paymentInfo: PaymentInfoSvm = {
      operator: extra.captureAuthorizer, // direct — matches EVM commerce-payments
      payer: this.opts.signer.address,
      receiver: requirements.payTo as Address,
      mint: requirements.asset as Address,
      maxAmount: amount,
      preApprovalExpiry,
      authorizationExpiry: BigInt(extra.captureDeadline),
      refundExpiry: BigInt(extra.refundDeadline),
      minFeeBps: extra.minFeeBps,
      maxFeeBps: extra.maxFeeBps,
      feeReceiver: extra.feeRecipient,
      salt,
    };

    const piHash = paymentInfoHash(paymentInfo);
    const [paymentStatePda] = await findPaymentStatePda(escrowProgramId, piHash);
    const [protocolFeeConfigPda] = await findProtocolFeeConfigPda(escrowProgramId);

    const ataDerivations = await this.deriveAtas(extra, paymentInfo, paymentStatePda, requirements);

    const isCharge = extra.autoCapture === true;
    const innerIx = isCharge
      ? encodeEscrowChargeIx({
          paymentInfo,
          amount,
          splits: this.buildChargeSplits(amount, paymentInfo, extra),
          collectorData: new Uint8Array(),
          escrowProgramId,
          collectorProgramId,
          accounts: {
            operator: extra.captureAuthorizer,
            paymentStatePda,
            vaultAta: ataDerivations.vault,
            payerAta: ataDerivations.payer,
            receiverAta: ataDerivations.receiver,
            receiver: paymentInfo.receiver,
            protocolFeeReceiverAta: ataDerivations.protocolFeeReceiver,
            protocolFeeReceiver: extra.protocolFeeReceiver,
            operatorFeeReceiverAta: ataDerivations.operatorFeeReceiver,
            operatorFeeReceiver: paymentInfo.feeReceiver,
            protocolFeeConfigPda,
            mint: paymentInfo.mint,
            payer: this.opts.signer.address,
            rentPayer: extra.feePayer,
          },
        })
      : encodeEscrowAuthorizeIx({
          paymentInfo,
          amount,
          collectorData: new Uint8Array(),
          escrowProgramId,
          collectorProgramId,
          accounts: {
            operator: extra.captureAuthorizer,
            paymentStatePda,
            vaultAta: ataDerivations.vault,
            payerAta: ataDerivations.payer,
            mint: paymentInfo.mint,
            payer: this.opts.signer.address,
            rentPayer: extra.feePayer,
          },
        });

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      m => setTransactionMessageComputeUnitPrice(DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS, m),
      m => setTransactionMessageFeePayer(extra.feePayer, m),
      m =>
        prependTransactionMessageInstruction(
          getSetComputeUnitLimitInstruction({ units: DEFAULT_COMPUTE_UNIT_LIMIT }),
          m,
        ),
      m => appendTransactionMessageInstructions([innerIx], m),
      m => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    );

    const partiallySigned = await partiallySignTransactionMessageWithSigners(tx);
    const transaction = getBase64EncodedWireTransaction(partiallySigned);
    const payload: AuthCaptureSvmPayload = { transaction };
    return { x402Version, payload: payload as unknown as Record<string, unknown> };
  }

  private buildChargeSplits(
    amount: bigint,
    info: PaymentInfoSvm,
    extra: AuthCaptureSvmExtra,
  ): SplitEntry[] {
    const opBps = BigInt(this.opts.defaultChargeOperatorBps ?? extra.minFeeBps);
    if (opBps < BigInt(extra.minFeeBps) || opBps > BigInt(extra.maxFeeBps)) {
      throw new Error(`defaultChargeOperatorBps out of [${extra.minFeeBps}, ${extra.maxFeeBps}]`);
    }
    const protocolFee = (amount * BigInt(extra.protocolFeeBps)) / 10_000n;
    const operatorFee = (amount * opBps) / 10_000n;
    const receiverAmt = amount - protocolFee - operatorFee;
    const out: SplitEntry[] = [{ recipient: info.receiver, amount: receiverAmt }];
    if (protocolFee > 0n) {
      out.push({ recipient: extra.protocolFeeReceiver, amount: protocolFee });
    }
    if (operatorFee > 0n) {
      out.push({ recipient: info.feeReceiver, amount: operatorFee });
    }
    return out;
  }

  private async deriveAtas(
    extra: AuthCaptureSvmExtra,
    info: PaymentInfoSvm,
    paymentStatePda: Address,
    requirements: PaymentRequirements,
  ) {
    const [vault] = await findAssociatedTokenPda({
      mint: requirements.asset as Address,
      owner: paymentStatePda,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [payer] = await findAssociatedTokenPda({
      mint: requirements.asset as Address,
      owner: this.opts.signer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [receiver] = await findAssociatedTokenPda({
      mint: requirements.asset as Address,
      owner: info.receiver,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [protocolFeeReceiver] = await findAssociatedTokenPda({
      mint: requirements.asset as Address,
      owner: extra.protocolFeeReceiver,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [operatorFeeReceiver] = await findAssociatedTokenPda({
      mint: requirements.asset as Address,
      owner: info.feeReceiver,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    return { vault, payer, receiver, protocolFeeReceiver, operatorFeeReceiver };
  }
}
