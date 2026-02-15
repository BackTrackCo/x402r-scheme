# @x402r/evm

Escrow payment scheme for x402 HTTP 402 flows. Bridges the x402 protocol with x402r escrow contracts on Base.

## Install

```bash
npm install @x402r/evm
```

## Usage

### Client — Create payment payloads

```typescript
import { createPaymentPayload } from "@x402r/evm/escrow/client";

const payload = await createPaymentPayload(requirements, walletClient);
```

### Server — Register with x402 resource server

```typescript
import { EscrowServerScheme } from "@x402r/evm/escrow/server";

const scheme = new EscrowServerScheme();
server.register("eip155:84532", scheme);
```

## Exports

- `@x402r/evm/escrow/client` — `createPaymentPayload()`, `EscrowScheme`
- `@x402r/evm/escrow/server` — `EscrowServerScheme`
- `@x402r/evm/escrow/facilitator` — Settlement and verification
- `@x402r/evm/escrow/types` — `EscrowExtra`, `EscrowPayload`

## Links

- [Documentation](https://docs.x402r.org)
- [GitHub](https://github.com/BackTrackCo/x402r-scheme)

## License

MIT
