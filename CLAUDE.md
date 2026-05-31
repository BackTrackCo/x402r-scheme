# x402r-scheme

auth-capture scheme bridging the x402 protocol with the canonical AuthCaptureEscrow contracts (base/commerce-payments).

## Commands

```bash
pnpm build / pnpm test / pnpm format
```

## Structure

Single package `@x402r/evm` at `packages/mechanisms/evm/`:

```
auth-capture/client      → re-exports AuthCaptureEvmScheme from @x402/evm/auth-capture/client (upstreamed; not implemented here)
auth-capture/server      → AuthCaptureEvmScheme (parsePrice, enhancePaymentRequirements)
auth-capture/facilitator → AuthCaptureEvmScheme (verify, settle) + errors.ts
auth-capture/{types,constants,abi,nonce,utils}.ts → cross-layer code at scheme root
```

## Dependencies

- Types from `@x402/core` and `@x402/evm` (base x402 protocol)
- Calls on-chain AuthCaptureEscrow directly (canonical universal CREATE2 deploy from base/commerce-payments)
- Extends base x402 scheme pattern
