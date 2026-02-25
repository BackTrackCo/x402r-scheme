# @x402r/evm

Escrow payment scheme for x402 HTTP 402 flows. Bridges the x402 protocol with x402r escrow contracts on Base.

## Install

```bash
npm install @x402r/evm
```

## Usage

### Client — Create payment payloads

```typescript
import { EscrowEvmScheme, registerEscrowEvmScheme } from "@x402r/evm/escrow/client";
import { x402Client } from "@x402/core/client";

const client = new x402Client();
registerEscrowEvmScheme(client, { signer });
// or with specific networks:
registerEscrowEvmScheme(client, { signer, networks: "eip155:84532" });
```

### Server — Register with x402 resource server

```typescript
import { EscrowServerScheme, registerEscrowEvmScheme } from "@x402r/evm/escrow/server";
import { x402ResourceServer } from "@x402/core/server";

const server = new x402ResourceServer(facilitatorConfig);
registerEscrowEvmScheme(server);
// or with specific networks:
registerEscrowEvmScheme(server, { networks: "eip155:84532" });
```

### Facilitator — Verify and settle payments

```typescript
import { EscrowFacilitatorScheme, registerEscrowEvmScheme } from "@x402r/evm/escrow/facilitator";
import { x402Facilitator } from "@x402/core/facilitator";

const facilitator = new x402Facilitator();
registerEscrowEvmScheme(facilitator, { signer, networks: "eip155:84532" });
```

## Exports

- `@x402r/evm` — `EscrowEvmScheme` (client scheme class)
- `@x402r/evm/escrow/client` — `EscrowEvmScheme`, `registerEscrowEvmScheme()`, `EvmClientConfig`
- `@x402r/evm/escrow/server` — `EscrowServerScheme`, `registerEscrowEvmScheme()`, `EvmResourceServerConfig`
- `@x402r/evm/escrow/facilitator` — `EscrowFacilitatorScheme`, `registerEscrowEvmScheme()`, `EvmFacilitatorConfig`

## Links

- [Documentation](https://docs.x402r.org)
- [GitHub](https://github.com/BackTrackCo/x402r-scheme)

## License

MIT
