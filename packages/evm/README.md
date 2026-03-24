# @x402r/evm

Commerce payment scheme for x402 HTTP 402 flows. Bridges the x402 protocol with x402r commerce contracts on Base.

## Install

```bash
npm install @x402r/evm
```

## Usage

### Client — Create payment payloads

```typescript
import { CommerceEvmScheme, registerCommerceEvmScheme } from '@x402r/evm/commerce/client'
import { x402Client } from '@x402/core/client'

const client = new x402Client()
registerCommerceEvmScheme(client, { signer })
// or with specific networks:
registerCommerceEvmScheme(client, { signer, networks: 'eip155:84532' })
```

### Server — Register with x402 resource server

```typescript
import { CommerceServerScheme, registerCommerceEvmScheme } from '@x402r/evm/commerce/server'
import { x402ResourceServer } from '@x402/core/server'

const server = new x402ResourceServer(facilitatorConfig)
registerCommerceEvmScheme(server)
// or with specific networks:
registerCommerceEvmScheme(server, { networks: 'eip155:84532' })
```

### Facilitator — Verify and settle payments

```typescript
import { CommerceFacilitatorScheme, registerCommerceEvmScheme } from '@x402r/evm/commerce/facilitator'
import { x402Facilitator } from '@x402/core/facilitator'

const facilitator = new x402Facilitator()
registerCommerceEvmScheme(facilitator, { signer, networks: 'eip155:84532' })
```

## Exports

- `@x402r/evm` — `CommerceEvmScheme` (client scheme class)
- `@x402r/evm/commerce/client` — `CommerceEvmScheme`, `registerCommerceEvmScheme()`, `EvmClientConfig`
- `@x402r/evm/commerce/server` — `CommerceServerScheme`, `registerCommerceEvmScheme()`, `EvmResourceServerConfig`
- `@x402r/evm/commerce/facilitator` — `CommerceFacilitatorScheme`, `registerCommerceEvmScheme()`, `EvmFacilitatorConfig`

## Links

- [Documentation](https://docs.x402r.org)
- [GitHub](https://github.com/BackTrackCo/x402r-scheme)

## License

MIT
