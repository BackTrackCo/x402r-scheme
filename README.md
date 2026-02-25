# x402r-scheme

Escrow payment scheme for x402 using Base Commerce Payments.

## Packages

- **[@x402r/evm](./packages/evm)** - Escrow scheme implementation for EVM chains

## Installation

```bash
pnpm add @x402r/evm
```

Peer dependencies: `@x402/core`, `@x402/evm`, `viem`

## Usage

### Client

```typescript
import { createPaymentPayload } from "@x402r/evm/escrow/client";

const payload = await createPaymentPayload(requirements, wallet);
```

### Server

```typescript
import { EscrowServerScheme } from "@x402r/evm/escrow/server";

// Register on an x402 resource server — parsePrice returns AssetAmount
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "eip155:84532",
  new EscrowServerScheme(),
);
```

### Facilitator

The escrow scheme integrates with x402's facilitator via `registerEscrowScheme()`, using the same `FacilitatorEvmSigner` as x402's exact scheme:

```typescript
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerEscrowScheme } from "@x402r/evm/escrow/facilitator";

const evmSigner = toFacilitatorEvmSigner({ address, ...clients });

const facilitator = new x402Facilitator();
registerEscrowScheme(facilitator, { signer: evmSigner, networks: "eip155:84532" });
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## License

MIT
