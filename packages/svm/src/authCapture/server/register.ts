import type { Network } from "@x402/core/types";
import type { x402ResourceServer } from "@x402/core/server";
import { AuthCaptureSvmServerScheme } from "./scheme";

export interface SvmServerConfig {
  networks?: Network | Network[];
}

export function registerAuthCaptureSvmServerScheme(
  server: x402ResourceServer,
  config: SvmServerConfig = {},
): x402ResourceServer {
  const scheme = new AuthCaptureSvmServerScheme();
  const networks = config.networks
    ? Array.isArray(config.networks)
      ? config.networks
      : [config.networks]
    : (["solana:*" as Network]);
  for (const network of networks) {
    server.register(network, scheme);
  }
  return server;
}
