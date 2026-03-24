# x402r-scheme

Commerce payment scheme for x402 using Base Commerce Payments.

## Packages

- **[@x402r/evm](./packages/evm)** - Commerce scheme implementation for EVM chains

## Installation

```bash
pnpm add @x402r/evm
```

Peer dependencies: `@x402/core`, `@x402/evm`, `viem`

## Usage

### Client

```typescript
import { CommerceEvmScheme, registerCommerceEvmScheme } from '@x402r/evm/commerce/client'
import { x402Client } from '@x402/core/client'

const client = new x402Client()
registerCommerceEvmScheme(client, { signer, networks: 'eip155:84532' })
```

### Server

```typescript
import { CommerceServerScheme, registerCommerceEvmScheme } from '@x402r/evm/commerce/server'
import { x402ResourceServer } from '@x402/core/server'

const server = new x402ResourceServer(facilitatorConfig)
registerCommerceEvmScheme(server, { networks: 'eip155:84532' })
```

### Facilitator

The commerce scheme integrates with x402's facilitator via `registerCommerceEvmScheme()`, using the same `FacilitatorEvmSigner` as x402's exact scheme:

```typescript
import { x402Facilitator } from '@x402/core/facilitator'
import { toFacilitatorEvmSigner } from '@x402/evm'
import { registerCommerceEvmScheme } from '@x402r/evm/commerce/facilitator'

const evmSigner = toFacilitatorEvmSigner({ address, ...clients })

const facilitator = new x402Facilitator()
registerCommerceEvmScheme(facilitator, { signer: evmSigner, networks: 'eip155:84532' })
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
