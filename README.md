# x402r-scheme

AuthCapture payment scheme for x402 using Base Commerce Payments.

## Packages

- **[@x402r/evm](./packages/evm)** - AuthCapture scheme implementation for EVM chains

## Installation

```bash
pnpm add @x402r/evm
```

Peer dependencies: `@x402/core`, `@x402/evm`, `viem`

## Usage

### Client

```typescript
import { AuthCaptureEvmScheme } from "@x402r/evm/authCapture/client";
import { x402Client } from "@x402/core/client";

const client = new x402Client();
client.register("eip155:84532", new AuthCaptureEvmScheme(signer));
```

### Server

```typescript
import { AuthCaptureEvmScheme } from "@x402r/evm/authCapture/server";
import { x402ResourceServer } from "@x402/core/server";

const server = new x402ResourceServer(facilitatorClient);
server.register("eip155:84532", new AuthCaptureEvmScheme());
```

### Facilitator

The authCapture scheme integrates with x402's facilitator using the same `FacilitatorEvmSigner` as x402's exact scheme:

```typescript
import { AuthCaptureEvmScheme } from "@x402r/evm/authCapture/facilitator";
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";

const evmSigner = toFacilitatorEvmSigner({ address, ...clients });

const facilitator = new x402Facilitator();
facilitator.register("eip155:84532", new AuthCaptureEvmScheme(evmSigner));
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
