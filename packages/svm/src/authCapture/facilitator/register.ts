import type { Network } from "@x402/core/types";
import type { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorSvmSigner } from "@x402/svm";
import { AuthCaptureSvmFacilitatorScheme } from "./scheme";

export interface SvmFacilitatorConfig {
  signer: FacilitatorSvmSigner;
  networks?: Network | Network[];
}

export function registerAuthCaptureSvmFacilitatorScheme(
  facilitator: x402Facilitator,
  config: SvmFacilitatorConfig,
): x402Facilitator {
  const scheme = new AuthCaptureSvmFacilitatorScheme(config.signer);
  const networks = config.networks
    ? Array.isArray(config.networks)
      ? config.networks
      : [config.networks]
    : (["solana:*" as Network]);
  for (const network of networks) {
    facilitator.register(network, scheme);
  }
  return facilitator;
}
