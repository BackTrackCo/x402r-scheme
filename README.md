# x402r-scheme

Escrow payment scheme for x402 using Base Commerce Payments.

## Packages

- **[@x402r/evm](./packages/evm)** - Escrow scheme implementation for EVM chains

## Installation

```bash
pnpm add @x402r/evm
```

## Usage

### Client

```typescript
import { EscrowScheme } from '@x402r/evm/escrow/client';

const payload = await EscrowScheme.createPaymentPayload(requirements, wallet);
```

### Server

```typescript
import { EscrowServerScheme } from '@x402r/evm/escrow/server';

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register('eip155:84532', new EscrowServerScheme());
```

### Facilitator

```typescript
import { registerEscrowScheme } from '@x402r/evm/escrow/facilitator';

const facilitator = new x402Facilitator();
registerEscrowScheme(facilitator, { signer, networks: 'eip155:84532' });
```

## Examples

See the [examples](./examples) directory for complete working examples:

- **[client](./examples/client)** - Client making escrow payments
- **[server](./examples/server)** - Resource server accepting escrow payments
- **[facilitator](./examples/facilitator)** - Facilitator verifying and settling payments

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run examples
cd examples/server && pnpm dev
cd examples/facilitator && pnpm dev
cd examples/client && pnpm dev
```

## License

MIT
