# x402r-scheme

authCapture scheme bridging the x402 protocol with the canonical AuthCaptureEscrow contracts (base/commerce-payments).

## Commands

```bash
pnpm build / pnpm test / pnpm format
```

## Structure

Single package `@x402r/evm` at `packages/evm/`:

```
authCapture/client      → createPaymentPayload()
authCapture/server      → AuthCaptureServerScheme
authCapture/facilitator → Settlement and verification
authCapture/shared      → types, constants, nonce + signing helpers
```

## Dependencies

- Types from `@x402/core` and `@x402/evm` (base x402 protocol)
- Calls on-chain AuthCaptureEscrow directly (canonical universal CREATE2 deploy from base/commerce-payments)
- Extends base x402 scheme pattern
