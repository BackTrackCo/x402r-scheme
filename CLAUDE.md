# x402r-scheme

Escrow scheme bridging x402 protocol with x402r escrow contracts.

## Commands

```bash
pnpm build / pnpm test / pnpm format
```

## Structure

Single package `@x402r/evm` at `packages/evm/`:

```
escrow/client      → createPaymentPayload()
escrow/server      → EscrowServerScheme
escrow/facilitator → Settlement and verification
```

## Dependencies

- Types and addresses from `@x402r/core` (x402r-sdk)
- Calls on-chain AuthCaptureEscrow and PaymentOperator (x402r-contracts)
- Extends base x402 scheme pattern (x402/)
