# x402r-scheme

Escrow scheme implementation for x402 HTTP 402 payment flows. Bridges the x402 protocol with x402r escrow contracts.

## Commands

```bash
pnpm install
pnpm build              # Build all packages
pnpm test               # Run tests (Vitest)
pnpm format             # Prettier
```

## Package Structure

Single package at `packages/evm/` published as `@x402r/evm`:

```
@x402r/evm/escrow/client      → createPaymentPayload()
@x402r/evm/escrow/server      → EscrowServerScheme
@x402r/evm/escrow/facilitator → Settlement and verification
```

## Relationship to Other Repos

- **x402r-sdk** — The SDK uses this scheme for payment payload creation and server-side verification. Contract addresses and types come from `@x402r/core`.
- **x402r-contracts** — This scheme calls the on-chain escrow contracts (AuthCaptureEscrow, PaymentOperator).
- **x402/** — Extends the base x402 protocol's scheme pattern with escrow capabilities.

## Key Files

| Path                  | Purpose      |
| --------------------- | ------------ |
| `packages/evm/src/`   | Source code  |
| `packages/evm/tests/` | Test suite   |
| `packages/evm/dist/`  | Build output |

## Coding Conventions

- TypeScript strict mode
- Use `viem` for blockchain interactions (never ethers.js)
- Follow the x402 scheme interface pattern
