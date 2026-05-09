import { SVM_DEVNET, SVM_MAINNET, type SvmCluster } from "./constants";

/**
 * Map a CAIP-2 network identifier to one of the supported SVM clusters.
 */
export function parseSvmCluster(network: string): SvmCluster {
  if (network === SVM_DEVNET) return SVM_DEVNET;
  if (network === SVM_MAINNET) return SVM_MAINNET;
  throw new Error(`Unsupported SVM cluster: ${network}`);
}

/** Borsh-encode a `Vec<T>` length prefix (u32 LE). */
export function vecLen(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n, true);
  return buf;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
