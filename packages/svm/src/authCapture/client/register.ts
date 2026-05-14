import type { Network } from "@x402/core/types";
import { x402Client } from "@x402/core/client";
import type { ClientSvmSigner, ClientSvmConfig } from "@x402/svm";
import { AuthCaptureSvmScheme } from "./scheme";

export interface SvmClientConfig {
  signer: ClientSvmSigner;
  config?: ClientSvmConfig;
  defaultChargeOperatorBps?: number;
  networks?: Network | Network[];
}

/**
 * Register the SVM authCapture client scheme with x402Client.
 *
 * @example
 * ```ts
 * const client = new x402Client();
 * registerAuthCaptureSvmScheme(client, { signer, networks: SVM_DEVNET });
 * ```
 */
export function registerAuthCaptureSvmScheme(
  client: x402Client,
  config: SvmClientConfig,
): x402Client {
  const scheme = new AuthCaptureSvmScheme({
    signer: config.signer,
    config: config.config,
    defaultChargeOperatorBps: config.defaultChargeOperatorBps,
  });
  const networks = config.networks
    ? Array.isArray(config.networks)
      ? config.networks
      : [config.networks]
    : (["solana:*" as Network]);
  for (const network of networks) {
    client.register(network, scheme);
  }
  return client;
}
