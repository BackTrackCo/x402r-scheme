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
import { EscrowEvmScheme, registerEscrowEvmScheme } from '@x402r/evm/escrow/client'
import { x402Client } from '@x402/core/client'

const client = new x402Client()
registerEscrowEvmScheme(client, { signer, networks: 'eip155:84532' })
```

### Server

```typescript
import { EscrowServerScheme, registerEscrowEvmScheme } from '@x402r/evm/escrow/server'
import { x402ResourceServer } from '@x402/core/server'

const server = new x402ResourceServer(facilitatorConfig)
registerEscrowEvmScheme(server, { networks: 'eip155:84532' })
```

### Facilitator

The escrow scheme integrates with x402's facilitator via `registerEscrowEvmScheme()`, using the same `FacilitatorEvmSigner` as x402's exact scheme:

```typescript
import { x402Facilitator } from '@x402/core/facilitator'
import { toFacilitatorEvmSigner } from '@x402/evm'
import { registerEscrowEvmScheme } from '@x402r/evm/escrow/facilitator'

const evmSigner = toFacilitatorEvmSigner({ address, ...clients })

const facilitator = new x402Facilitator()
registerEscrowEvmScheme(facilitator, { signer: evmSigner, networks: 'eip155:84532' })
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
