# x402r-scheme

Commerce scheme bridging x402 protocol with x402r commerce contracts.

## Commands

```bash
pnpm build / pnpm test / pnpm format
```

## Structure

Single package `@x402r/evm` at `packages/evm/`:

```
commerce/client      → createPaymentPayload()
commerce/server      → CommerceServerScheme
commerce/facilitator → Settlement and verification
```

## Dependencies

- Types from `@x402/core` and `@x402/evm` (base x402 protocol)
- Calls on-chain AuthCaptureEscrow and PaymentOperator (commerce-payments)
- Extends base x402 scheme pattern (x402/)
