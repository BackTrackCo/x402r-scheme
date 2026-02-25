import type { Network } from "@x402/core/types";
import { x402ResourceServer } from "@x402/core/server";
import { EscrowServerScheme } from "./scheme.js";

export interface EvmResourceServerConfig {
  networks?: Network | Network[];
}

/**
 * Register escrow server scheme with x402ResourceServer
 *
 * @example
 * ```typescript
 * const server = new x402ResourceServer(facilitatorConfig);
 * registerEscrowEvmScheme(server);
 * // or with specific networks:
 * registerEscrowEvmScheme(server, { networks: "eip155:84532" });
 * ```
 */
export function registerEscrowEvmScheme(
  server: x402ResourceServer,
  config: EvmResourceServerConfig = {},
): x402ResourceServer {
  const scheme = new EscrowServerScheme();
  const networks = config.networks
    ? Array.isArray(config.networks)
      ? config.networks
      : [config.networks]
    : ["eip155:*" as Network];
  for (const network of networks) {
    server.register(network, scheme);
  }
  return server;
}
