# @x402r/evm

AuthCapture payment scheme for x402 HTTP 402 flows. Bridges the x402 protocol with x402r commerce contracts on Base.

## Install

```bash
npm install @x402r/evm
```

## Usage

### Client — Create payment payloads

```typescript
import { AuthCaptureEvmScheme, registerAuthCaptureEvmScheme } from '@x402r/evm/authCapture/client'
import { x402Client } from '@x402/core/client'

const client = new x402Client()
registerAuthCaptureEvmScheme(client, { signer })
// or with specific networks:
registerAuthCaptureEvmScheme(client, { signer, networks: 'eip155:84532' })
```

### Server — Register with x402 resource server

```typescript
import {
  AuthCaptureServerScheme,
  registerAuthCaptureEvmScheme,
} from '@x402r/evm/authCapture/server'
import { x402ResourceServer } from '@x402/core/server'

const server = new x402ResourceServer(facilitatorConfig)
registerAuthCaptureEvmScheme(server)
// or with specific networks:
registerAuthCaptureEvmScheme(server, { networks: 'eip155:84532' })
```

### Facilitator — Verify and settle payments

```typescript
import {
  AuthCaptureFacilitatorScheme,
  registerAuthCaptureEvmScheme,
} from '@x402r/evm/authCapture/facilitator'
import { x402Facilitator } from '@x402/core/facilitator'

const facilitator = new x402Facilitator()
registerAuthCaptureEvmScheme(facilitator, { signer, networks: 'eip155:84532' })
```

## Exports

- `@x402r/evm` — `AuthCaptureEvmScheme` (client scheme class)
- `@x402r/evm/authCapture/client` — `AuthCaptureEvmScheme`, `registerAuthCaptureEvmScheme()`, `EvmClientConfig`
- `@x402r/evm/authCapture/server` — `AuthCaptureServerScheme`, `registerAuthCaptureEvmScheme()`, `EvmResourceServerConfig`
- `@x402r/evm/authCapture/facilitator` — `AuthCaptureFacilitatorScheme`, `registerAuthCaptureEvmScheme()`, `EvmFacilitatorConfig`

## Links

- [Documentation](https://docs.x402r.org)
- [GitHub](https://github.com/BackTrackCo/x402r-scheme)

## License

MIT
