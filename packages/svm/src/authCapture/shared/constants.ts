/**
 * Per-cluster program IDs.
 *
 * Solana program IDs are keypair-derived; SVM has no CREATE2 equivalent so
 * these differ across clusters. Update each constant after `pnpm deploy:devnet`
 * / `pnpm deploy:mainnet` and the `migrations/pin-program-ids.ts` script in
 * the contracts repo.
 *
 * Pilot placeholders match the `declare_id!` lines so the SDK type-checks;
 * they will not validate at runtime.
 */

import type { Address } from "@solana/kit";

export const SVM_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;
export const SVM_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;
export type SvmCluster = typeof SVM_DEVNET | typeof SVM_MAINNET;

interface ClusterProgramIds {
  authCaptureEscrow: Address;
  splTokenCollector: Address;
}

const PLACEHOLDERS: ClusterProgramIds = {
  authCaptureEscrow: "AcESCRow1111111111111111111111111111111111" as Address,
  splTokenCollector: "SPLCo11ector1111111111111111111111111111111" as Address,
};

/**
 * Per-cluster program IDs. **Replace these placeholders** with the IDs
 * pinned post-deploy.
 */
export const PROGRAM_IDS: Record<SvmCluster, ClusterProgramIds> = {
  [SVM_DEVNET]: PLACEHOLDERS,
  [SVM_MAINNET]: PLACEHOLDERS,
};

/** Default USDC mints per cluster. */
export const USDC_MINTS: Record<SvmCluster, Address> = {
  [SVM_DEVNET]: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as Address,
  [SVM_MAINNET]: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address,
};

/**
 * Anchor 8-byte instruction discriminators (`sha256("global:<name>")[..8]`).
 * Hard-coded so the SDK doesn't parse the IDL at runtime.
 *
 * NOTE: placeholders until the IDL is generated. Replace with the real
 * values from `target/idl/*.json`.
 */
export const ESCROW_IX_DISC = {
  initializeProtocolFeeConfig: new Uint8Array([155, 47, 100, 13, 232, 109, 0, 250]),
  authorize: new Uint8Array([46, 9, 7, 154, 184, 220, 197, 87]),
  charge: new Uint8Array([146, 158, 35, 245, 197, 6, 235, 27]),
  capture: new Uint8Array([105, 251, 160, 9, 26, 247, 187, 187]),
  void: new Uint8Array([147, 218, 58, 239, 81, 31, 91, 98]),
  refund: new Uint8Array([2, 96, 183, 251, 63, 208, 46, 46]),
  reclaim: new Uint8Array([146, 144, 196, 238, 185, 217, 120, 18]),
} as const;

export const COLLECTOR_IX_DISC = {
  collectAuthorize: new Uint8Array([187, 156, 174, 70, 195, 87, 21, 173]),
  collectRefund: new Uint8Array([33, 122, 8, 154, 42, 119, 207, 44]),
} as const;

/** PDA seeds — keep in sync with the escrow program. */
export const SEEDS = {
  payment: new TextEncoder().encode("payment"),
  protocolFeeConfig: new TextEncoder().encode("protocol-fee-config"),
} as const;
