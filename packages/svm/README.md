# @x402r/svm

AuthCapture payment scheme for x402 on **Solana**.

> **Pilot. Unaudited.** Mainnet usage is at users' own risk.

Direct port of `base/commerce-payments`'s authCapture primitives to SVM:

| `base/commerce-payments` (EVM) | This scheme (SVM) |
| :--- | :--- |
| `AuthCaptureEscrow` | `auth-capture-escrow` Anchor program |
| `EIP3009TokenCollector` / `Permit2TokenCollector` | `spl-token-collector` Anchor program (and any future `ITokenCollector`) |

Higher-level patterns (operator factories, plugin slots, condition / hook programs, multisig operators) are x402r-specific extensions and live outside this package — see `x402r-contracts-svm/programs/payment-operator/` if you want one.

## Layout

```
authCapture/client       → AuthCaptureSvmScheme (createPaymentPayload)
authCapture/server       → AuthCaptureSvmServerScheme
authCapture/facilitator  → AuthCaptureSvmFacilitatorScheme (verify + settle)
authCapture/shared       → types, constants, Borsh encoder/decoder, PDA helpers
```

## Toolchain

- `@solana/kit` (no `@solana/web3.js` v1)
- Codama-generated client (consumed by tests AND this SDK)
- Vitest, tsup, TypeScript 5.7+

## Versioning

Starts at `0.2.0` to match `@x402r/evm`. Both packages move in lockstep on the x402r release line.

## Status

Until the Anchor IDL is generated and Codama-generated clients land at `src/codama-generated/`, a few helpers throw `stub:` errors at runtime (see `shared/pda.ts`). Run `pnpm codama:generate` from `x402r-contracts-svm/` after `anchor build` to wire those in.
