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

## Testing

```bash
pnpm test          # unit tests (mock-only, network-free)
pnpm test:fork     # fork tests (require BASE_SEPOLIA_RPC_URL)
```

Fork tests spawn a local anvil instance forked from Base Sepolia and exercise the full settle path against the canonical `AuthCaptureEscrow` and token-collector deploys. They cover `{authorize, charge} × {eip3009, permit2}` and assert post-settle on-chain state via `escrow.paymentState(hash)`.

Required env:

| Var                       | Purpose                                                             | Default                                                                   |
| :------------------------ | :------------------------------------------------------------------ | :------------------------------------------------------------------------ |
| `BASE_SEPOLIA_RPC_URL`    | Upstream RPC anvil forks from. Any working Base Sepolia endpoint.   | _required_ — fork tests skip cleanly if unset                             |
| `ANVIL_BIN`               | Path to the `anvil` binary.                                         | `anvil` (must be on `PATH`; install via [Foundry](https://getfoundry.sh)) |
| `BASE_SEPOLIA_FORK_BLOCK` | Pin the fork to a specific block (recommended for reproducibility). | _unset_ — uses chain head                                                 |
| `ANVIL_VERBOSE`           | If set, anvil's stdout/stderr is inherited (default: silenced).     | _unset_                                                                   |

## Links

- [Documentation](https://docs.x402r.org)
- [GitHub](https://github.com/BackTrackCo/x402r-scheme)

## License

MIT
