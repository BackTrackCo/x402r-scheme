# Scheme: `escrow`

## Summary

`escrow` is a scheme that decouples authorization from final settlement. The client authorizes a maximum amount, and the facilitator settles — either holding funds in escrow (pre-settlement) or sending them directly to the receiver with post-settlement refund capability.

Unlike `exact`, which transfers funds immediately and irrevocably, `escrow` supports refundable payments.

## Example Use Cases

- Refundable payments with buyer protection
- Delayed delivery where the client needs recourse if the service is unsatisfactory
- Subscription or session billing with periodic captures against a single authorization

## Settlement Methods

The scheme supports two settlement paths:

| Method      | Behavior                                                               |
| :---------- | :--------------------------------------------------------------------- |
| `authorize` | Funds held in escrow. Can be captured, refunded, voided, or reclaimed. |
| `charge`    | Funds sent directly to receiver. Refundable post-settlement.           |

### Authorize (default)

```
AUTHORIZE → RESOURCE DELIVERED → CAPTURE / REFUND / VOID
```

1. **Authorize**: Client authorization is submitted — funds locked in escrow
2. **Resource delivered**: Server returns the resource (HTTP 200)
3. **Post-settlement**: Escrowed funds can be captured (finalized to the receiver), refunded (returned to client), or voided (released before capture). If the capture deadline passes without action, the client can reclaim funds directly.

### Charge

```
CHARGE → RESOURCE DELIVERED → (REFUND)
```

1. **Charge**: Client authorization is submitted — funds sent directly to receiver
2. **Resource delivered**: Server returns the resource (HTTP 200)
3. **Post-settlement**: A refund can be issued within the refund window by the operator (which may be a smart contract or an authorized account). Since funds are already with the receiver, the client cannot unilaterally reclaim. This path trades the safety of pre-settlement escrow for simpler settlement, relying on the refund window as the buyer protection mechanism.

## Core Properties

### Fund Safety

- Cannot overcharge — settlement amount is capped by the client-signed maximum
- Authorize path: client can reclaim escrowed funds after the capture deadline if no action is taken
- Fee bounds are client-signed and enforced at settlement

### Replay Prevention

- Each payment has a unique nonce derived from the payment parameters
- Nonce is consumed at settlement, preventing double-spend

### Expiry Enforcement

Three ordered deadlines govern the payment lifecycle:

- **Authorization deadline**: Last moment to submit the client's authorization for settlement
- **Capture deadline**: Last moment to capture escrowed funds (authorize path); after this, the client can reclaim
- **Refund deadline**: Last moment to issue a refund on captured or charged payments

## Settlement Response

On success, the `PAYMENT-RESPONSE` header contains a `SettleResponse` with the settlement transaction hash, network, payer address, and the full payment information from the client's original payload. Including payment information makes the response self-contained — the client can derive the payment nonce, query escrow state, and initiate post-settlement actions without retaining client-side state from the original request.

The structure of the payment information is network-specific — see per-network documents for details.

## Relationship to `exact`

| Aspect     | `exact`            | `escrow`                                                         |
| :--------- | :----------------- | :--------------------------------------------------------------- |
| Settlement | Immediate transfer | Via escrow (authorize) or direct with refund capability (charge) |
| Refundable | No                 | Yes (both paths)                                                 |
| Fee system | None               | Configurable (min/max bounds, client-signed)                     |

## Appendix

Network-specific implementation details (contracts, signature formats, verification logic) are in per-network documents: `scheme_escrow_evm.md` (EVM).

### References

- [Escrow Scheme Proposal — Agentokratia (Issue #834)](https://github.com/coinbase/x402/issues/834)
- [Escrow Scheme Proposal — x402r (Issue #1011)](https://github.com/coinbase/x402/issues/1011)
