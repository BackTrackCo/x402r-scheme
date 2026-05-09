# AuthCapture Payment Scheme for Solana Virtual Machine (SVM) (`authCapture`)

This document specifies the `authCapture` payment scheme for the x402 protocol on Solana.

This scheme facilitates payments of an SPL token where funds can be held in escrow and settled later (two-phase, default) or sent directly with refund capability (single-shot). Direct port of `base/commerce-payments`'s `AuthCaptureEscrow` and token-collector primitives. Higher-level patterns (operator factories, multisig operators, plugin slots) sit in front of this scheme as separate extensions and are out of scope here.

> **Status: Pilot, unaudited.** Mainnet usage is at users' own risk.

## Scheme Name

`authCapture`

## Protocol Flow

The protocol flow for `authCapture` on Solana is client-driven. The initial settlement instruction is selected by `extra.autoCapture`: `false` (default) locks funds in escrow for later capture; `true` settles atomically.

1.  **Client** makes a request to a **Resource Server**.
2.  **Resource Server** responds with a payment required signal containing `PaymentRequired`. The `extra` field in the requirements carries the `feePayer` (typically the facilitator), the `escrowProgramId` and `collectorProgramId`, the `captureAuthorizer` authorized to capture/void/refund, the deadlines, and the fee policy.
3.  **Client** creates a Solana transaction whose only meaningful inner instruction is `auth_capture_escrow::authorize` (when `autoCapture: false`) or `auth_capture_escrow::charge` (when `autoCapture: true`). The instruction data Borsh-encodes a `PaymentInfo` struct that binds every payment parameter, including a fresh client-generated 32-byte salt.
4.  **Client** signs the transaction with their wallet. This results in a partially-signed transaction (the facilitator's signature as `feePayer`, and the captureAuthorizer's signature as `paymentInfo.operator`, are still missing).
5.  **Client** serializes the partially-signed transaction and encodes it as a Base64 string.
6.  **Client** sends a new request to the resource server with the `PaymentPayload` containing the Base64-encoded partially-signed transaction.
7.  **Resource Server** receives the request and forwards the `PaymentPayload` and `PaymentRequirements` to a **Facilitator Server's** `/verify` endpoint.
8.  **Facilitator** decodes and deserializes the proposed transaction, decodes the inner `PaymentInfo` Borsh blob, and validates the layout, the field bindings, and the deadlines.
9.  **Facilitator** returns a `VerifyResponse` to the **Resource Server**.
10. **Resource Server**, upon successful verification, forwards the payload to the facilitator's `/settle` endpoint.
11. **Facilitator Server** provides its signatures as `feePayer` (and as `captureAuthorizer` if it is also the captureAuthorizer) and submits the now fully-signed transaction.
12. The escrow CPIs into the configured `ITokenCollector` to move funds (payer ATA → vault for `authorize`, vault → splits for `charge`). For `charge`, distribution to receiver / protocol-fee / operator-fee ATAs happens in the same instruction.
13. Upon successful on-chain settlement, the **Facilitator Server** responds with a `SettlementResponse` to the **Resource Server**.
14. **Resource Server** grants the **Client** access to the resource in its response.

For two-phase payments, the captureAuthorizer subsequently calls `auth_capture_escrow::capture` (settlement, with splits) or `auth_capture_escrow::void` (release back to payer). After settlement, the captureAuthorizer can call `auth_capture_escrow::refund` until `refundDeadline` to return funds to the payer (the collector handles the source-ATA → payer-ATA transfer). If the captureAuthorizer never captures, the payer can call `auth_capture_escrow::reclaim` after `captureDeadline` to recover their funds — the escape hatch bypasses the captureAuthorizer entirely.

## `PaymentRequirements` for `authCapture`

In addition to the standard x402 `PaymentRequirements` fields, the `authCapture` scheme on Solana requires the following inside the `extra` field:

```json
{
  "scheme": "authCapture",
  "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "amount": "1000000",
  "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "payTo": "ReceiverPubkey...",
  "maxTimeoutSeconds": 60,
  "extra": {
    "feePayer": "FacilitatorFeePayerPubkey...",
    "escrowProgramId": "AuthCaptureEscrowProgramIdForCluster...",
    "collectorProgramId": "SplTokenCollectorProgramIdForCluster...",
    "captureAuthorizer": "CaptureAuthorizerPubkey...",
    "captureDeadline": 1740758554,
    "refundDeadline": 1741276954,
    "feeRecipient": "OperatorFeeReceiverPubkey...",
    "minFeeBps": 0,
    "maxFeeBps": 1000,
    "protocolFeeBps": 10,
    "protocolFeeReceiver": "ProtocolFeeReceiverPubkey...",
    "autoCapture": false
  }
}
```

- `asset`: The public key of the token mint.
- `extra.feePayer`: The public key of the account that will pay for the transaction fees. Typically the facilitator's public key.
- `extra.escrowProgramId`: The `auth-capture-escrow` program ID for the cluster.
- `extra.collectorProgramId`: The `ITokenCollector` program ID. The pilot ships `spl-token-collector`.
- `extra.captureAuthorizer`: The public key authorized to call `authorize`, `capture`, `void`, `refund`, or `charge`. Committed on-chain as `paymentInfo.operator`. In x402's facilitator-submits flow this is typically the facilitator itself.
- `extra.captureDeadline`: Absolute Unix seconds. The captureAuthorizer must capture before this time. Committed on-chain as `paymentInfo.authorization_expiry`. After this passes, the payer can call `reclaim`.
- `extra.refundDeadline`: Absolute Unix seconds. Refunds are allowed until this time. Committed on-chain as `paymentInfo.refund_expiry`. MUST satisfy `refundDeadline >= captureDeadline`.
- `extra.feeRecipient`: The operator-fee recipient. Committed on-chain as `paymentInfo.fee_receiver`.
- `extra.minFeeBps` / `extra.maxFeeBps`: Bounds on the operator fee. The captureAuthorizer chooses an operator-fee bps within these bounds at capture/charge time. Both values MUST be ≤ 10,000.
- `extra.protocolFeeBps`: Read from the escrow program state at requirements-build time. Immutable per deploy.
- `extra.protocolFeeReceiver`: Read from the escrow program state at requirements-build time. Immutable per deploy.
- `extra.autoCapture`: `true` → facilitator submits `charge()` (atomic settlement). `false` → `authorize()` (two-phase). Default: `false`.

The on-chain `PaymentInfo` struct uses canonical commerce-payments-style field names: `extra.captureAuthorizer` → `operator`, `extra.captureDeadline` → `authorization_expiry`, `extra.refundDeadline` → `refund_expiry`, `extra.feeRecipient` → `fee_receiver`. The SDK translates before computing the canonical SHA-256-of-Borsh `payment_info_hash`.

## PaymentPayload `payload` Field

The `payload` field of the `PaymentPayload` contains:

```json
{
  "transaction": "AAAAAAAAAAAAA...AAAAAAAAAAAAA="
}
```

The `transaction` field contains the base64-encoded, serialized, **partially-signed** versioned Solana transaction. The 32-byte salt rides inside the inner instruction's Borsh-encoded `PaymentInfo`, not as a separate payload field. A fresh salt MUST be generated per signing call.

Full `PaymentPayload` object:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://example.com/weather",
    "description": "Access to protected content",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "authCapture",
    "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "amount": "1000000",
    "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "payTo": "ReceiverPubkey...",
    "maxTimeoutSeconds": 60,
    "extra": {
      "feePayer": "FacilitatorFeePayerPubkey...",
      "escrowProgramId": "AuthCaptureEscrowProgramIdForCluster...",
      "collectorProgramId": "SplTokenCollectorProgramIdForCluster...",
      "captureAuthorizer": "CaptureAuthorizerPubkey...",
      "captureDeadline": 1740758554,
      "refundDeadline": 1741276954,
      "feeRecipient": "OperatorFeeReceiverPubkey...",
      "minFeeBps": 0,
      "maxFeeBps": 1000,
      "protocolFeeBps": 10,
      "protocolFeeReceiver": "ProtocolFeeReceiverPubkey...",
      "autoCapture": false
    }
  },
  "payload": {
    "transaction": "AAAAAAAAAAAAA...AAAAAAAAAAAAA="
  }
}
```

## `SettlementResponse`

The `SettlementResponse` for the authCapture scheme on Solana:

```json
{
  "success": true,
  "transaction": "base58 encoded transaction signature",
  "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "payer": "base58 encoded public address of the payer"
}
```

## Facilitator Verification Rules (MUST)

A facilitator verifying an `authCapture`-scheme SVM payment MUST enforce all of the following checks before sponsoring and signing the transaction:

1. Instruction layout

- The decompiled transaction MUST contain 3 to 5 instructions in this order:
  1. Compute Budget: Set Compute Unit Limit
  2. Compute Budget: Set Compute Unit Price
  3. `auth_capture_escrow::authorize` (when `extra.autoCapture: false`) OR `auth_capture_escrow::charge` (when `extra.autoCapture: true`)
  4. (Optional) Lighthouse program instruction (Phantom wallet protection)
  5. (Optional) Lighthouse program instruction (Solflare wallet protection)

- The Anchor 8-byte discriminator at `data[0..8]` of the inner instruction MUST match the expected `authorize` or `charge` discriminator per `extra.autoCapture`.
- If a 4th or 5th instruction is present, the program MUST be the Lighthouse program (`L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95`).

2. Inner program identity

- The inner instruction's `programAddress` MUST equal `extra.escrowProgramId`.

3. Fee payer (facilitator) safety

- The configured `extra.feePayer` MUST be one of the addresses returned by the facilitator's signer.
- The fee payer MUST NOT appear in the `accounts` of the inner instruction.

4. Compute budget validity

- The program for instructions (1) and (2) MUST be `ComputeBudget` with the correct discriminators (2 = SetLimit, 3 = SetPrice).
- The compute unit price MUST be ≤ 5 lamports per compute unit.

5. PaymentInfo binding

- The Borsh-decoded `PaymentInfo` from the inner instruction's data MUST byte-match `requirements` and `extra`:
  - `paymentInfo.operator == extra.captureAuthorizer`
  - `paymentInfo.receiver == requirements.payTo`
  - `paymentInfo.mint == requirements.asset`
  - `paymentInfo.maxAmount == requirements.amount`
  - `paymentInfo.authorization_expiry == extra.captureDeadline`
  - `paymentInfo.refund_expiry == extra.refundDeadline`
  - `paymentInfo.fee_receiver == extra.feeRecipient`
  - `paymentInfo.minFeeBps == extra.minFeeBps`
  - `paymentInfo.maxFeeBps == extra.maxFeeBps`

6. Deadline ordering

- `paymentInfo.pre_approval_expiry <= paymentInfo.authorization_expiry <= paymentInfo.refund_expiry`.
- `paymentInfo.pre_approval_expiry` MUST be ≥ now + 6 seconds (safety margin) to avoid the transaction landing after the client-signed window has closed.

7. Simulation

- The facilitator MUST sign the transaction as `feePayer`, simulate it, and reject on simulation failure.

These checks are security-critical to ensure the fee payer cannot be tricked into transferring their own funds or sponsoring unintended actions. Implementations MAY introduce stricter limits (e.g., lower compute price caps) but MUST NOT relax the above constraints.

## `ITokenCollector` Interface

The escrow's `authorize`, `charge`, and `refund` instructions take a `token_collector` program account and `collector_data: Vec<u8>` argument and CPI into the collector for the actual asset transfer. The escrow itself is asset-method-agnostic; new transfer methods plug in by implementing this interface without escrow changes.

The pilot ships `spl-token-collector`. Future Token-2022, cross-chain bridge, or streaming collectors slot in by implementing the same two instructions:

- `collect_authorize(payment_info_hash: [u8;32], amount: u64, data: Vec<u8>)` — Anchor discriminator `sha256("global:collect_authorize")[..8]`. Moves `amount` from an external party into the escrow vault. For `spl-token-collector`: payer ATA → vault ATA, authority = payer.
- `collect_refund(payment_info_hash: [u8;32], amount: u64, data: Vec<u8>)` — Anchor discriminator `sha256("global:collect_refund")[..8]`. Moves `amount` from an external party to the payer ATA. For `spl-token-collector`: source ATA → payer ATA.

The collector's account list is collector-defined; the escrow forwards its parent's `remaining_accounts` to the collector unchanged. `data` is opaque per collector — `spl-token-collector` ignores it; future collectors that need extra context (Token-2022 transfer hooks, signed receipts, bridge attestations) use it without breaking the escrow CPI shape.
