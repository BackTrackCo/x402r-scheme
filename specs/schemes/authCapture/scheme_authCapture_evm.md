# Scheme: `authCapture` on `EVM`

## Summary

The `authCapture` scheme on EVM uses the [base/commerce-payments](https://github.com/base/commerce-payments) contract stack:

- **AuthCaptureEscrow**: Singleton — locks funds, enforces expiries, distributes on capture/refund. Universal canonical address (CREATE2-deployed; same address on every supported chain).
- **Token Collectors**: Universal canonical addresses, one per `assetTransferMethod`:
  - `EIP3009_TOKEN_COLLECTOR_ADDRESS` — collects funds via `receiveWithAuthorization` signatures (USDC, EURC, etc.)
  - `PERMIT2_TOKEN_COLLECTOR_ADDRESS` — collects funds via Uniswap Permit2 `permitTransferFrom` (any ERC-20)
- **CaptureAuthorizer**: Address authorized to authorize, capture, void, refund, or charge a payment. Each of those methods on `AuthCaptureEscrow` is gated by `onlySender(paymentInfo.operator)`, so this address must be `msg.sender` of the "Authorize" call. In x402's facilitator-submits flow that means either **the facilitator's EOA**, or **any smart contract** that ends up calling the escrow (e.g., an arbiter contract with dispute logic, a multisig, etc.).

The client signs a single signature (ERC-3009 or Permit2). The facilitator submits it to `AuthCaptureEscrow.authorize()` (two-phase) or `AuthCaptureEscrow.charge()` (single-shot via `autoCapture: true`).

The escrow + token-collector addresses are **not configurable per merchant** — they are universal constants. The wire format never carries them.

## PaymentRequirements

AuthCapture-accepting servers advertise with scheme `authCapture`:

```json
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "authCapture",
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

| Field                 | Required | Type                     | Description                                                                                               |
| :-------------------- | :------- | :----------------------- | :-------------------------------------------------------------------------------------------------------- |
| `name`                | Yes      | `string`                 | EIP-712 token-domain name (e.g., `"USDC"`). Used for ERC-3009 signing only.                               |
| `version`             | Yes      | `string`                 | EIP-712 token-domain version (e.g., `"2"`).                                                               |
| `captureAuthorizer`   | Yes      | `address`                | Address authorized to authorize/capture/void/refund/charge. Committed on-chain as `PaymentInfo.operator`. |
| `captureDeadline`     | Yes      | `uint48`                 | Absolute Unix seconds — capture must occur before this. Encoded as `authorizationExpiry`.                 |
| `refundDeadline`      | Yes      | `uint48`                 | Absolute Unix seconds — refunds allowed until this. Encoded as `refundExpiry`.                            |
| `feeRecipient`        | Yes      | `address`                | Fee recipient (committed on-chain as `PaymentInfo.feeReceiver`).                                          |
| `minFeeBps`           | Yes      | `uint16`                 | Minimum fee in basis points (the fee floor the captureAuthorizer must take). `0` = no minimum.            |
| `maxFeeBps`           | Yes      | `uint16`                 | Maximum fee in basis points (the cap on the captureAuthorizer's fee).                                     |
| `autoCapture`         | No       | `bool`                   | `true` → facilitator calls `charge()` (atomic). `false` → `authorize()` (two-phase). Default: `false`.    |
| `assetTransferMethod` | No       | `"eip3009" \| "permit2"` | Which token collector to use. Default: `"eip3009"`.                                                       |

> **`salt` is NOT in `extra`.** It is generated client-side per signing call and rides on `PaymentPayload`. See "PaymentPayload" below.
>
> **Escrow + token-collector addresses are NOT in `extra`.** They are universal constants — same address on every supported EVM chain via deterministic CREATE2:
>
> | Constant                              | Address                                      |
> | :------------------------------------ | :------------------------------------------- |
> | `AUTH_CAPTURE_ESCROW_ADDRESS`         | `0xF8211868187974a7Fb9d99b8fFB171AD70665Dc6` |
> | `EIP3009_TOKEN_COLLECTOR_ADDRESS`     | `0x7561DC178D9aD5bc5fb103C01f448A510d2A36D0` |
> | `PERMIT2_TOKEN_COLLECTOR_ADDRESS`     | `0xD8490609d2da0ee626b0e676941b225cbc1A8C08` |
> | `PERMIT2_ADDRESS` (Uniswap canonical) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
>
> See [Canonical Addresses](#canonical-addresses) for the deployed-chain list and the salt scheme.

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
  "accepted": { "scheme": "authCapture", "...": "..." },
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

`authorization.to` is the universal `EIP3009_TOKEN_COLLECTOR_ADDRESS` constant. `validBefore` is `now + maxTimeoutSeconds`, also used as `preApprovalExpiry` when reconstructing PaymentInfo.

### Permit2

```json
{
  "x402Version": 2,
  "resource": { "url": "https://api.example.com/resource", "method": "GET" },
  "accepted": { "scheme": "authCapture", "...": "..." },
  "payload": {
    "permit2Authorization": {
      "from": "0xPayerAddress",
      "permitted": {
        "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "amount": "1000000"
      },
      "spender": "0xPermit2TokenCollectorAddress",
      "nonce": "12345678901234567890",
      "deadline": "1740675754"
    },
    "signature": "0x2d6a...571c",
    "salt": "0x0000000000000000000000000000000000000000000000000000000000000abc"
  }
}
```

`spender` is the universal `PERMIT2_TOKEN_COLLECTOR_ADDRESS` constant. `nonce` is `uint256(payerAgnosticPaymentInfoHash)`. The `deadline` matches `now + maxTimeoutSeconds`. **No witness** — the merchant address is bound through the deterministic nonce.

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
2. **Scheme match**: `requirements.scheme === "authCapture"` and `payload.accepted.scheme === "authCapture"`.
3. **Network match**: `payload.accepted.network === requirements.network` and format is `eip155:<chainId>`.
4. **Extra validation**: `requirements.extra` contains all required fields (`captureAuthorizer`, `captureDeadline`, `refundDeadline`, `feeRecipient`, `maxFeeBps`, `name`, `version`).
5. **Method routing**: `extra.assetTransferMethod` (default `"eip3009"`) matches the payload shape.
6. **Deadline ordering**: `refundDeadline > captureDeadline` and `captureDeadline > now + 6s`.
7. **Time window**: `payload.deadline / validBefore > now + 6s` (not expired) and `validAfter <= now` (active, EIP-3009 only).
8. **Spender / collector match**: `payload.to === EIP3009_TOKEN_COLLECTOR_ADDRESS` (EIP-3009) or `payload.spender === PERMIT2_TOKEN_COLLECTOR_ADDRESS` (Permit2).
9. **Token match**: `payload.permitted.token === requirements.asset` (Permit2 only — EIP-3009 binds via signing domain).
10. **Signature verify**: Recover signer from EIP-712 (`ReceiveWithAuthorization` or `PermitTransferFrom`); must match `payer`.
11. **Amount**: Authorization value matches `requirements.amount`.
12. **Nonce match**: Reconstruct `PaymentInfo` from extra + payload.salt + payer + requirements; recompute payer-agnostic hash; assert it matches the wire nonce.
13. **Simulate** `AUTH_CAPTURE_ESCROW.authorize(...)` or `.charge(...)` to ensure success.

### EIP-6492 Support

For smart wallet clients, the signature may be EIP-6492 wrapped (containing deployment bytecode). The facilitator extracts the inner ECDSA signature for verification. The on-chain `ERC6492SignatureHandler` in the token collector handles wallet deployment during settlement.

## Settlement Logic

1. **Re-verify** the payload (catches expired/invalid payloads before spending gas).
2. **Determine function**: `extra.autoCapture === true ? "charge" : "authorize"`.
3. **Resolve collector**: `EIP3009_TOKEN_COLLECTOR_ADDRESS` or `PERMIT2_TOKEN_COLLECTOR_ADDRESS` (per `assetTransferMethod`).
4. **Encode `collectorData`**: raw ERC-3009 signature, or ABI-encoded Permit2 signature.
5. **Call escrow**: `AUTH_CAPTURE_ESCROW.<functionName>(paymentInfo, amount, tokenCollector, collectorData)`.
6. **Wait for receipt**: 60s timeout.
7. **Return result**: tx hash, network, payer.

## Error Codes

The authCapture scheme uses the standard x402 error codes plus these scheme-specific codes:

### Verification Errors

| Error Code                          | Description                                                              |
| :---------------------------------- | :----------------------------------------------------------------------- |
| `invalid_payload_format`            | Payload doesn't match `Eip3009Payload` or `Permit2Payload`.              |
| `unsupported_scheme`                | Scheme is not `authCapture`.                                             |
| `network_mismatch`                  | Payload network doesn't match requirements.                              |
| `invalid_network`                   | Network format is not `eip155:<chainId>`.                                |
| `invalid_authCapture_extra`         | Extra is missing required fields.                                        |
| `unsupported_asset_transfer_method` | `assetTransferMethod` is not `"eip3009"` or `"permit2"`.                 |
| `payload_method_mismatch`           | Payload shape doesn't match `assetTransferMethod`.                       |
| `capture_deadline_expired`          | `captureDeadline <= now + 6s`.                                           |
| `invalid_deadline_ordering`         | `refundDeadline <= captureDeadline`.                                     |
| `authorization_expired`             | EIP-3009 `validBefore` (or Permit2 `deadline`) `<= now + 6s`.            |
| `authorization_not_yet_valid`       | EIP-3009 `validAfter > now`.                                             |
| `invalid_authCapture_signature`     | Signature verification failed.                                           |
| `amount_mismatch`                   | Authorization value doesn't match `requirements.amount`.                 |
| `token_collector_mismatch`          | `to` / `spender` doesn't match the canonical collector for the method.   |
| `token_mismatch`                    | Permit2 `permitted.token` doesn't match `requirements.asset`.            |
| `nonce_mismatch`                    | Wire nonce doesn't match the recomputed payer-agnostic PaymentInfo hash. |
| `insufficient_balance`              | Payer balance is less than required amount.                              |
| `simulation_failed`                 | Settlement simulation reverted with an unmapped error.                   |

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

> **Requirement**: The escrow and token collectors are deployed at the same address across every supported EVM chain via deterministic CREATE2. Bytecode is byte-identical (locked compiler, optimizer, and dependency pins); anyone with the source can reproduce and verify the addresses, and any first-mover deployer who broadcasts the canonical bytecode at the canonical salt lands at the same address.

**Source**: [base/commerce-payments@v1.0.0](https://github.com/base/commerce-payments/releases/tag/v1.0.0).

**Salt scheme**: `bytes20(0) || 0x00 || bytes11(keccak256(label))`. The leading 21 bytes are constant; the label is the per-contract namespace below.

| Constant                              | Salt label                                        | Canonical Address                            |
| :------------------------------------ | :------------------------------------------------ | :------------------------------------------- |
| `AUTH_CAPTURE_ESCROW_ADDRESS`         | `commerce-payments::v1::AuthCaptureEscrow`        | `0xF8211868187974a7Fb9d99b8fFB171AD70665Dc6` |
| `EIP3009_TOKEN_COLLECTOR_ADDRESS`     | `commerce-payments::v1::ERC3009PaymentCollector`  | `0x7561DC178D9aD5bc5fb103C01f448A510d2A36D0` |
| `PERMIT2_TOKEN_COLLECTOR_ADDRESS`     | `commerce-payments::v1::Permit2PaymentCollector`  | `0xD8490609d2da0ee626b0e676941b225cbc1A8C08` |
| `PERMIT2_ADDRESS` (Uniswap canonical) | (Uniswap canonical, not CREATE2'd by this scheme) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

**Deployed chains**:

| Network           | Chain ID | `assetTransferMethod`                          |
| :---------------- | :------- | :--------------------------------------------- |
| Ethereum          | 1        | `eip3009` (Circle USDC) or `permit2`           |
| Base              | 8453     | `eip3009` (Circle USDC) or `permit2`           |
| Optimism          | 10       | `eip3009` (Circle USDC) or `permit2`           |
| Arbitrum One      | 42161    | `eip3009` (Circle USDC) or `permit2`           |
| Polygon           | 137      | `eip3009` (Circle USDC) or `permit2`           |
| Celo              | 42220    | `eip3009` (Circle USDC) or `permit2`           |
| Avalanche C-Chain | 43114    | `eip3009` (Circle USDC) or `permit2`           |
| Linea             | 59144    | `eip3009` (Circle USDC) or `permit2`           |
| Monad             | 143      | `eip3009` (Circle USDC) or `permit2`           |
| BNB Smart Chain   | 56       | `permit2` only (Binance-Peg USDC, no ERC-3009) |
| Tempo             | 4217     | `permit2` only (pathUSD TIP-20, no ERC-3009)   |
| Ethereum Sepolia  | 11155111 | `eip3009` (Circle USDC) or `permit2`           |
| Base Sepolia      | 84532    | `eip3009` (Circle USDC) or `permit2`           |
| Arbitrum Sepolia  | 421614   | `eip3009` (Circle USDC) or `permit2`           |

Facilitators that wish to add a chain not in this table SHOULD reproduce the canonical bytecode using the source repo's pinned compiler / optimizer settings and broadcast at the salt labels above; the addresses will match the table by construction.
