import type { Network } from "@x402/core/types";
import type { ClientEvmSigner } from "@x402/evm";
import { x402Client } from "@x402/core/client";
import { AuthCaptureEvmScheme } from "./scheme";

export interface EvmClientConfig {
  signer: ClientEvmSigner;
  networks?: Network | Network[];
}

/**
 * Register authCapture client scheme with x402Client
 *
 * @example
 * ```typescript
 * const client = new x402Client();
 * registerAuthCaptureEvmScheme(client, { signer });
 * // or with specific networks:
 * registerAuthCaptureEvmScheme(client, { signer, networks: "eip155:84532" });
 * ```
 */
export function registerAuthCaptureEvmScheme(
  client: x402Client,
  config: EvmClientConfig,
): x402Client {
  const scheme = new AuthCaptureEvmScheme(config.signer);
  const networks = config.networks
    ? Array.isArray(config.networks)
      ? config.networks
      : [config.networks]
    : ["eip155:*" as Network];
  for (const network of networks) {
    client.register(network, scheme);
  }
  return client;
}
