import type { Network } from "@x402/core/types";
import { x402ResourceServer } from "@x402/core/server";
import { AuthCaptureServerScheme } from "./scheme";

export interface EvmResourceServerConfig {
  networks?: Network | Network[];
}

/**
 * Register authCapture server scheme with x402ResourceServer
 *
 * @example
 * ```typescript
 * const server = new x402ResourceServer(facilitatorConfig);
 * registerAuthCaptureEvmScheme(server);
 * // or with specific networks:
 * registerAuthCaptureEvmScheme(server, { networks: "eip155:84532" });
 * ```
 */
export function registerAuthCaptureEvmScheme(
  server: x402ResourceServer,
  config: EvmResourceServerConfig = {},
): x402ResourceServer {
  const scheme = new AuthCaptureServerScheme();
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
