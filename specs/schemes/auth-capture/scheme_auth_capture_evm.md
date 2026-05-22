# Scheme: `auth-capture` on `EVM`

## Summary

The `auth-capture` scheme on EVM uses the [base/commerce-payments](https://github.com/base/commerce-payments) contract stack:

- **AuthCaptureEscrow**: Singleton — locks funds, enforces expiries, distributes on capture/refund. Universal canonical address (same address on every supported chain).
- **Token Collectors**: Universal canonical addresses, one per `assetTransferMethod`:
  - `EIP3009_TOKEN_COLLECTOR_ADDRESS` — collects funds via `receiveWithAuthorization` signatures (USDC, EURC, etc.)
  - `PERMIT2_TOKEN_COLLECTOR_ADDRESS` — collects funds via Uniswap Permit2 `permitTransferFrom` (any ERC-20)
- **`captureAuthorizer`**: Address authorized to authorize, capture, void, refund, or charge a payment. The escrow contract gates those operations on `msg.sender` matching this address. In x402's facilitator-submits flow that means either **the facilitator's EOA**, or **any smart contract** that ends up calling the escrow (e.g., an arbiter contract with dispute logic, a multisig, etc.).

The client signs a single signature (ERC-3009 or Permit2). The facilitator calls `AuthCaptureEscrow.authorize()` (two-phase) or `AuthCaptureEscrow.charge()` (single-shot via `autoCapture: true`), either directly or through a smart contract set as the captureAuthorizer.

## PaymentRequirements

Servers accepting auth-capture payments advertise with scheme `auth-capture`:

```json
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "auth-capture",
      "network": "eip155:8453",
      "amount": "1000000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xReceiverAddress",
      "maxTimeoutSeconds": 60,
      "extra": {
        "name": "USDC",
        "version": "2",
        "captureAuthorizer": "0xCaptureAuthorizerAddress",
        "captureDeadline": 1740758554,
        "refundDeadline": 1741276954,
        "minFeeBps": 0,
        "maxFeeBps": 1000,
        "feeRecipient": "0xFeeRecipientAddress",
        "autoCapture": false,
        "assetTransferMethod": "eip3009"
      }
    }
  ]
}
```

### `extra` Fields

| Field                 | Required | Type                     | Description                                                                                                                                                                                                   |
| :-------------------- | :------- | :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                | Yes      | `string`                 | EIP-712 token-domain name (e.g., `"USDC"`). Used for ERC-3009 signing only.                                                                                                                                   |
| `version`             | Yes      | `string`                 | EIP-712 token-domain version (e.g., `"2"`).                                                                                                                                                                   |
| `captureAuthorizer`   | Yes      | `address`                | Address authorized to authorize/capture/void/refund/charge. Committed on-chain as `PaymentInfo.operator`.                                                                                                     |
| `captureDeadline`     | Yes      | `uint48`                 | Absolute Unix seconds — capture must occur before this. Encoded as `authorizationExpiry`.                                                                                                                     |
| `refundDeadline`      | Yes      | `uint48`                 | Absolute Unix seconds — refunds allowed until this. Encoded as `refundExpiry`.                                                                                                                                |
| `feeRecipient`        | Yes      | `address`                | Fee recipient (committed on-chain as `PaymentInfo.feeReceiver`). Set to `address(0)` to let the captureAuthorizer specify any non-zero recipient at capture/charge time.                                      |
| `minFeeBps`           | Yes      | `uint16`                 | Minimum fee in basis points (the fee floor the captureAuthorizer must take). `0` = no minimum.                                                                                                                |
| `maxFeeBps`           | Yes      | `uint16`                 | Maximum fee in basis points (the cap on the captureAuthorizer's fee).                                                                                                                                         |
| `autoCapture`         | No       | `bool`                   | `true` → facilitator calls `charge()` (atomic). `false` → `authorize()` (two-phase). Default: `false`.                                                                                                        |
| `assetTransferMethod` | No       | `"eip3009" \| "permit2"` | Which token collector to use. Default: `"eip3009"`. A server MAY list multiple `accepts[]` entries with different `assetTransferMethod` values so clients can pick the method matching their token approvals. |

### Spec → on-chain field name mapping

The wire-format extra uses spec-level field names. The on-chain `PaymentInfo` struct keeps canonical Solidity names so the EIP-712 typehash matches the AuthCaptureEscrow contract byte-for-byte.

| Wire (`extra`)                       | On-chain (`PaymentInfo`) |
| :----------------------------------- | :----------------------- |
| `captureAuthorizer`                  | `operator`               |
| `captureDeadline`                    | `authorizationExpiry`    |
| `refundDeadline`                     | `refundExpiry`           |
| `feeRecipient`                       | `feeReceiver`            |
| (derived: `now + maxTimeoutSeconds`) | `preApprovalExpiry`      |

## PaymentPayload

The payload carries the signature and the client-generated `salt`. The facilitator reconstructs the full `PaymentInfo` from `extra` + `salt` + payer + top-level requirements (`payTo`, `asset`, `amount`).

### EIP-3009 (default)

```json
{
  "x402Version": 2,
  "resource": { "url": "https://api.example.com/resource", "method": "GET" },
  "accepted": { "scheme": "auth-capture", "...": "..." },
  "payload": {
    "authorization": {
      "from": "0xPayerAddress",
      "to": "0xEIP3009TokenCollectorAddress",
      "value": "1000000",
      "validAfter": "0",
      "validBefore": "1740675754",
      "nonce": "0xf374...3480"
    },
    "signature": "0x2d6a...571c",
    "salt": "0x0000000000000000000000000000000000000000000000000000000000000abc"
  }
}
```

**Field derivation (EIP-3009):**

| Payload field               | Derived from                                                                                                |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------- |
| `authorization.from`        | Client's own address                                                                                        |
| `authorization.to`          | `EIP3009_TOKEN_COLLECTOR_ADDRESS` (universal constant)                                                      |
| `authorization.value`       | `requirements.amount`                                                                                       |
| `authorization.validAfter`  | `0` (the token collector hardcodes the lower bound)                                                         |
| `authorization.validBefore` | `now + requirements.maxTimeoutSeconds` (also used as `preApprovalExpiry` when reconstructing `PaymentInfo`) |
| `authorization.nonce`       | Payer-agnostic `PaymentInfo` hash — see [Nonce Derivation](#nonce-derivation-both-methods)                  |
| `salt`                      | Fresh `bytes32` generated client-side per signing call                                                      |
| EIP-712 domain              | `{ name, version }` from `extra`; `chainId` from `network`; `verifyingContract = requirements.asset`        |

### Permit2

```json
{
  "x402Version": 2,
  "resource": { "url": "https://api.example.com/resource", "method": "GET" },
  "accepted": { "scheme": "auth-capture", "...": "..." },
  "payload": {
    "permit2Authorization": {
      "from": "0xPayerAddress",
      "permitted": {
        "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "amount": "1000000"
      },
      "spender": "0xPermit2TokenCollectorAddress",
      "nonce": "110210486920734568342928534950928740912034856789012345678901234567890123456789",
      "deadline": "1740675754"
    },
    "signature": "0x2d6a...571c",
    "salt": "0x0000000000000000000000000000000000000000000000000000000000000abc"
  }
}
```

**Field derivation (Permit2):**

| Payload field                           | Derived from                                                                                                |
| :-------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| `permit2Authorization.from`             | Client's own address                                                                                        |
| `permit2Authorization.permitted.token`  | `requirements.asset`                                                                                        |
| `permit2Authorization.permitted.amount` | `requirements.amount`                                                                                       |
| `permit2Authorization.spender`          | `PERMIT2_TOKEN_COLLECTOR_ADDRESS` (universal constant)                                                      |
| `permit2Authorization.nonce`            | `uint256(payerAgnosticPaymentInfoHash)` — see [Nonce Derivation](#nonce-derivation-both-methods)            |
| `permit2Authorization.deadline`         | `now + requirements.maxTimeoutSeconds` (also used as `preApprovalExpiry` when reconstructing `PaymentInfo`) |
| `salt`                                  | Fresh `bytes32` generated client-side per signing call                                                      |
| EIP-712 domain                          | Canonical Permit2 contract; `chainId` from `network`                                                        |

**No witness** — the merchant address is bound through the deterministic nonce, not a separate witness struct.

### Nonce Derivation (both methods)

The signature nonce is the payer-agnostic `PaymentInfo` hash. Payer is zeroed; everything else is the values that will appear on-chain.

```
paymentInfoHash = keccak256(abi.encode(PAYMENT_INFO_TYPEHASH, paymentInfoWithZeroPayer))
nonce           = keccak256(abi.encode(chainId, AUTH_CAPTURE_ESCROW_ADDRESS, paymentInfoHash))
```

Freshness is enforced by `salt`: each signing call generates a fresh `bytes32` salt, so two payers signing concurrently produce distinct nonces with no collision risk.

## Verification Logic

The facilitator performs these checks in order:

1. **Type guard**: Verify payload matches one of `Eip3009Payload` or `Permit2Payload` (must include `signature` and `salt`).
2. **Scheme match**: `requirements.scheme === "auth-capture"` and `payload.accepted.scheme === "auth-capture"`.
3. **Network match**: `payload.accepted.network === requirements.network` and format is `eip155:<chainId>`.
4. **Extra validation**: `requirements.extra` contains all required fields (`captureAuthorizer`, `captureDeadline`, `refundDeadline`, `feeRecipient`, `minFeeBps`, `maxFeeBps`, `name`, `version`).
5. **Method routing**: `extra.assetTransferMethod` (default `"eip3009"`) matches the payload shape.
6. **Deadline ordering**: `refundDeadline >= captureDeadline`, `captureDeadline > now + 6s`, and `payload.validBefore` (EIP-3009) / `payload.deadline` (Permit2) `<= captureDeadline`.
7. **Time window**: `payload.deadline / validBefore > now + 6s` (not expired) and `validAfter <= now` (active, EIP-3009 only).
8. **Spender / collector match**: `payload.to === EIP3009_TOKEN_COLLECTOR_ADDRESS` (EIP-3009) or `payload.spender === PERMIT2_TOKEN_COLLECTOR_ADDRESS` (Permit2).
9. **Token match**: `payload.permitted.token === requirements.asset` (Permit2 only — EIP-3009 binds via signing domain).
10. **Signature verify**: Recover signer from EIP-712 (`ReceiveWithAuthorization` or `PermitTransferFrom`); must match `payer`.
11. **Amount**: `authorization.value` (EIP-3009) or `permit2Authorization.permitted.amount` (Permit2) matches `requirements.amount`.
12. **Nonce match**: Reconstruct `PaymentInfo` from extra + payload.salt + payer + requirements; recompute payer-agnostic hash; assert it matches the wire nonce. This transitively enforces equality on every field encoded in `PaymentInfo` (receiver, token, deadlines, fee bounds, feeRecipient), so individual field-by-field checks for those values are unnecessary.
13. **Simulate** the settle call to ensure success. The simulation target depends on whether `extra.captureAuthorizer` is an EOA or a smart contract (see [Smart Contract `captureAuthorizer`](#smart-contract-captureauthorizer)). When the captureAuthorizer is a smart contract, the simulation MUST be performed at trace level (e.g. `eth_simulateV1`), with the additional checks described in that section, and MUST apply the gas cap defined there.

### EIP-6492 Support

For smart wallet clients, the signature may be EIP-6492 wrapped (containing deployment bytecode). The facilitator extracts the inner ECDSA signature for verification. The on-chain `ERC6492SignatureHandler` in the token collector handles wallet deployment during settlement.

### Smart Contract `captureAuthorizer`

`extra.captureAuthorizer` MAY be either an EOA or a smart contract. The escrow gates `authorize` / `capture` / `void` / `refund` / `charge` on `msg.sender` matching `paymentInfo.operator`, so a smart contract captureAuthorizer must end up calling escrow itself, with the facilitator's transaction passing through that contract first.

Facilitators detect the path by probing `getCode(captureAuthorizer)`:

- **Empty bytecode (EOA path)**: the facilitator submits the settle transaction directly to `AUTH_CAPTURE_ESCROW_ADDRESS` with `msg.sender = facilitator EOA = captureAuthorizer`. Standard simulation via `eth_call` is sufficient.
- **Non-empty bytecode (contract path)**: the facilitator submits the settle transaction to the captureAuthorizer contract, which is then responsible for calling escrow with `msg.sender = captureAuthorizer`.

The captureAuthorizer contract is merchant-set and not on any allowlist (every new arbiter or wrapper deploys at a new address). Facilitators MUST treat smart contract captureAuthorizers as untrusted code.

#### Required checks on the contract path

In addition to the standard verification logic, a facilitator MUST:

1. **Trace-level simulation**. Simulate the settle call at trace level (`eth_simulateV1` or equivalent), capturing emitted logs and asset changes. A revert-only simulation is NOT sufficient.
2. **Escrow call verification**. Assert that the trace contains the expected `AuthCaptureEscrow` event for the chosen entrypoint, emitted by `AUTH_CAPTURE_ESCROW_ADDRESS`, with `paymentInfoHash` matching the payer-agnostic hash recomputed in verification step 12. This confirms the captureAuthorizer actually forwards into escrow with the signed `PaymentInfo`.
3. **Asset-delta verification**. Reconstruct ERC-20 `Transfer(from, to, value)` deltas for `requirements.asset` from the trace and assert that they match the signed `PaymentInfo`:
   - On `authorize`: payer balance decreases by `amount`; escrow balance increases by `amount`; `receiver` and `feeReceiver` are unchanged.
   - On `charge`: payer balance decreases by `amount`; receiver and `feeReceiver` receive the split implied by some `feeBps ∈ [minFeeBps, maxFeeBps]`.
   - No `requirements.asset` transfer to any address outside `{payer, receiver, feeReceiver, escrow}`.
4. **Gas cap**. Apply an explicit gas cap to both the simulation and the broadcast transaction. A misbehaving captureAuthorizer can consume up to the gas field provided by the facilitator; the cap bounds the facilitator's gas exposure.

The recommended cap is **400,000 gas**. This is approximately twice the worst-case legitimate `charge` path through the audited escrow with the ERC-3009 collector (measured at ~181k gas on Base via the upstream gas benchmark), with headroom for a thin passthrough wrapper. Permit2 is cheaper than ERC-3009, so the cap is not gated by Permit2.

Facilitators MAY raise the cap for known-heavier captureAuthorizer contracts they advertise support for, but MUST NOT remove it.

#### Operational hardening

Facilitators that support contract-path captureAuthorizers SHOULD:

- Submit settle transactions from a gas-only hot wallet that holds no token balances and has no token approvals. The captureAuthorizer cannot exfiltrate value from such a wallet even on a successful unexpected call path.
- Reject any settle attempt that requires sending native value. The auth-capture flow is ERC-20 only; a `value > 0` transaction to a captureAuthorizer indicates the contract is requesting funds the facilitator should not grant.
- Apply the gas cap before broadcast, not just during simulation. A captureAuthorizer that simulates within the cap but executes above it would still be bounded.

## Settlement Logic

1. **Re-verify** the payload (catches expired/invalid payloads before spending gas).
2. **Determine function**: `extra.autoCapture === true ? "charge" : "authorize"`.
3. **Resolve collector**: `EIP3009_TOKEN_COLLECTOR_ADDRESS` or `PERMIT2_TOKEN_COLLECTOR_ADDRESS` (per `assetTransferMethod`).
4. **Encode `collectorData`**: raw ERC-3009 signature, or ABI-encoded Permit2 signature.
5. **Resolve target**: when `extra.captureAuthorizer` is an EOA, the target is `AUTH_CAPTURE_ESCROW_ADDRESS`; when it is a smart contract, the target is the captureAuthorizer contract itself (see [Smart Contract `captureAuthorizer`](#smart-contract-captureauthorizer)).
6. **Call target**: `<target>.<functionName>(paymentInfo, amount, tokenCollector, collectorData)`. When the target is a smart contract captureAuthorizer, the transaction MUST be submitted with the gas cap defined in that section.
7. **Wait for receipt**: 60s timeout.
8. **Return result**: tx hash, network, payer.

## Error Codes

The auth-capture scheme uses the standard x402 error codes plus these scheme-specific codes:

### Verification Errors

| Error Code                          | Description                                                                       |
| :---------------------------------- | :-------------------------------------------------------------------------------- |
| `invalid_payload_format`            | Payload doesn't match `Eip3009Payload` or `Permit2Payload`.                       |
| `unsupported_scheme`                | Scheme is not `auth-capture`.                                                      |
| `network_mismatch`                  | Payload network doesn't match requirements.                                       |
| `invalid_network`                   | Network format is not `eip155:<chainId>`.                                         |
| `invalid_auth_capture_extra`         | Extra is missing required fields.                                                 |
| `unsupported_asset_transfer_method` | `assetTransferMethod` is not `"eip3009"` or `"permit2"`.                          |
| `payload_method_mismatch`           | Payload shape doesn't match `assetTransferMethod`.                                |
| `capture_deadline_expired`          | `captureDeadline <= now + 6s`.                                                    |
| `invalid_deadline_ordering`         | Deadlines violate `now + maxTimeoutSeconds <= captureDeadline <= refundDeadline`. |
| `authorization_expired`             | EIP-3009 `validBefore` (or Permit2 `deadline`) `<= now + 6s`.                     |
| `authorization_not_yet_valid`       | EIP-3009 `validAfter > now`.                                                      |
| `invalid_auth_capture_signature`     | Signature verification failed.                                                    |
| `amount_mismatch`                   | Authorization value doesn't match `requirements.amount`.                          |
| `token_collector_mismatch`          | `to` / `spender` doesn't match the canonical collector for the method.            |
| `token_mismatch`                    | Permit2 `permitted.token` doesn't match `requirements.asset`.                     |
| `nonce_mismatch`                    | Wire nonce doesn't match the recomputed payer-agnostic PaymentInfo hash.          |
| `insufficient_balance`              | Payer balance is less than required amount.                                       |
| `simulation_failed`                 | Settlement simulation reverted with an unmapped error.                            |
| `capture_authorizer_escrow_call_missing` | Trace-level simulation of a smart contract captureAuthorizer did not show the expected `AuthCaptureEscrow` event with a matching `paymentInfoHash`. |
| `capture_authorizer_payment_info_mismatch` | The escrow event surfaced in the contract-path simulation references a `paymentInfoHash` that does not match the signed `PaymentInfo`.        |
| `capture_authorizer_asset_divergence` | Contract-path simulation showed an ERC-20 transfer of `requirements.asset` to an address outside `{payer, receiver, feeReceiver, escrow}`, or split deltas inconsistent with `minFeeBps` / `maxFeeBps`. |
| `capture_authorizer_gas_exceeded`   | Contract-path simulation reported `gasUsed` greater than the facilitator's gas cap. |

### Typed simulation reverts

If the simulate call reverts with an `AuthCaptureEscrow` custom error declared in the call's ABI, the facilitator decodes it via `BaseError.walk()` + `ContractFunctionRevertedError` and surfaces a stable reason instead of the opaque `simulation_failed` fallback:

| Custom error                    | `invalidReason`                       |
| :------------------------------ | :------------------------------------ |
| `AfterPreApprovalExpiry`        | `authorization_expired`               |
| `InvalidExpiries`               | `invalid_deadline_ordering`           |
| `ExceedsMaxAmount`              | `amount_mismatch`                     |
| `PaymentAlreadyCollected`       | `payment_already_collected`           |
| `TokenCollectionFailed`         | `token_collection_failed`             |
| `InvalidCollectorForOperation`  | `invalid_collector`                   |
| `InvalidSender`                 | `invalid_capture_authorizer`          |
| `ZeroAmount` / `AmountOverflow` | `amount_mismatch` / `amount_overflow` |
| `FeeBpsOverflow`                | `invalid_fee_bps`                     |
| `InvalidFeeBpsRange`            | `invalid_fee_bps_range`               |
| `FeeBpsOutOfRange`              | `fee_bps_out_of_range`                |
| `ZeroFeeReceiver`               | `zero_fee_receiver`                   |
| `InvalidFeeReceiver`            | `invalid_fee_receiver`                |
| `AfterAuthorizationExpiry`      | `capture_deadline_expired`            |
| `InsufficientAuthorization`     | `insufficient_authorization`          |
| `ZeroAuthorization`             | `zero_authorization`                  |

### Settlement Errors

| Error Code             | Description                                       |
| :--------------------- | :------------------------------------------------ |
| `verification_failed`  | Re-verification before settlement failed.         |
| `transaction_reverted` | On-chain transaction reverted after confirmation. |

## Appendix

### PaymentInfo Struct (canonical Solidity — wire-level field names map per the table above)

```solidity
struct PaymentInfo {
    address operator;            // = extra.captureAuthorizer
    address payer;               // payload-derived
    address receiver;            // = requirements.payTo
    address token;               // = requirements.asset
    uint120 maxAmount;           // = requirements.amount
    uint48  preApprovalExpiry;   // = now + maxTimeoutSeconds (client-derived)
    uint48  authorizationExpiry; // = extra.captureDeadline
    uint48  refundExpiry;        // = extra.refundDeadline
    uint16  minFeeBps;
    uint16  maxFeeBps;
    address feeReceiver;         // = extra.feeRecipient
    uint256 salt;                // = payload.salt (client-generated, fresh per request)
}
```

### Expiry Ordering

The contract enforces: `preApprovalExpiry <= authorizationExpiry <= refundExpiry`.

| Expiry                | Wire field        | Enforced at                | Effect                              |
| :-------------------- | :---------------- | :------------------------- | :---------------------------------- |
| `preApprovalExpiry`   | derived           | `authorize()` / `charge()` | Blocks settlement after this time   |
| `authorizationExpiry` | `captureDeadline` | `capture()`                | Blocks capture; enables `reclaim()` |
| `refundExpiry`        | `refundDeadline`  | `refund()`                 | Blocks refund requests              |

### Fee System

Fees are enforced on-chain by the escrow contract:

- `minFeeBps` and `maxFeeBps` set by the client in `PaymentInfo` (0–10,000 bps)
- `feeBps` at capture/charge must fall within `[minFeeBps, maxFeeBps]`
- If `feeReceiver` (`extra.feeRecipient`) is set in `PaymentInfo`, actual `feeReceiver` at capture/charge must match
- If `feeReceiver` is `address(0)`, the caller can specify any non-zero address
- Fee distribution: `feeAmount = amount * feeBps / 10000`, remainder goes to receiver

### Canonical Addresses

The `AUTH_CAPTURE_ESCROW_ADDRESS`, `EIP3009_TOKEN_COLLECTOR_ADDRESS`, and `PERMIT2_TOKEN_COLLECTOR_ADDRESS` constants resolve to the canonical [Base Commerce-Payments contracts](https://github.com/base/commerce-payments/releases/tag/v1.0.0).

The `PERMIT2_ADDRESS` constant resolves to the canonical [Uniswap Permit2 contract](https://docs.uniswap.org/contracts/v4/deployments).
