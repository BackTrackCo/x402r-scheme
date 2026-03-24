import type { Network } from '@x402/core/types'
import type { ClientEvmSigner } from '@x402/evm'
import { x402Client } from '@x402/core/client'
import { CommerceEvmScheme } from './scheme'

export interface EvmClientConfig {
  signer: ClientEvmSigner
  networks?: Network | Network[]
}

/**
 * Register commerce client scheme with x402Client
 *
 * @example
 * ```typescript
 * const client = new x402Client();
 * registerCommerceEvmScheme(client, { signer });
 * // or with specific networks:
 * registerCommerceEvmScheme(client, { signer, networks: "eip155:84532" });
 * ```
 */
export function registerCommerceEvmScheme(client: x402Client, config: EvmClientConfig): x402Client {
  const scheme = new CommerceEvmScheme(config.signer)
  const networks = config.networks
    ? Array.isArray(config.networks)
      ? config.networks
      : [config.networks]
    : ['eip155:*' as Network]
  for (const network of networks) {
    client.register(network, scheme)
  }
  return client
}
