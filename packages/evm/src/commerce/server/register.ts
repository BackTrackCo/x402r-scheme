import type { Network } from '@x402/core/types'
import { x402ResourceServer } from '@x402/core/server'
import { CommerceServerScheme } from './scheme'

export interface EvmResourceServerConfig {
  networks?: Network | Network[]
}

/**
 * Register commerce server scheme with x402ResourceServer
 *
 * @example
 * ```typescript
 * const server = new x402ResourceServer(facilitatorConfig);
 * registerCommerceEvmScheme(server);
 * // or with specific networks:
 * registerCommerceEvmScheme(server, { networks: "eip155:84532" });
 * ```
 */
export function registerCommerceEvmScheme(
  server: x402ResourceServer,
  config: EvmResourceServerConfig = {},
): x402ResourceServer {
  const scheme = new CommerceServerScheme()
  const networks = config.networks
    ? Array.isArray(config.networks)
      ? config.networks
      : [config.networks]
    : ['eip155:*' as Network]
  for (const network of networks) {
    server.register(network, scheme)
  }
  return server
}
