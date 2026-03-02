# Scheme: `escrow`

## Summary

The `escrow` scheme transfers funds through an on-chain escrow contract, decoupling authorization from settlement. The client signs once to authorize a maximum amount, and the facilitator settles through the [Commerce Payments Protocol](https://github.com/base/commerce-payments) — routing funds into escrow (refundable) or directly to the receiver (non-refundable).

This scheme reuses audited commerce-payments contracts deployed on Base and other EVM chains.

## Example Use Cases

- Refundable API access with dispute resolution
- Metered services where final cost is determined after consumption
- Marketplace payments with fee management
- Non-refundable instant settlements using the same contract infrastructure

## Settlement Methods

The scheme supports two settlement paths through the commerce-payments operator:

| Method      | Function      | Behavior                                                    |
| :---------- | :------------ | :---------------------------------------------------------- |
| `authorize` | `authorize()` | Funds held in escrow. Can be captured, refunded, or voided. |
| `charge`    | `charge()`    | Funds sent directly to receiver. No escrow hold.            |

Both methods share identical function signatures and use the same operator, fee system, and token collector infrastructure.

## Lifecycle

### Authorize (default)

```
SIGN → AUTHORIZE → [USE] → CAPTURE / REFUND / VOID
```

1. **Sign**: Client signs an ERC-3009 `receiveWithAuthorization` for the maximum amount
2. **Authorize**: Facilitator calls `authorize()` on the operator — funds locked in escrow
3. **Use**: Client consumes the resource (off-chain, no gas)
4. **Settle**: Operator captures earned amount, refunds remainder, or voids if unused

### Charge

```
SIGN → CHARGE → DONE
```

1. **Sign**: Client signs an ERC-3009 authorization (same as above)
2. **Charge**: Facilitator calls `charge()` on the operator — funds go directly to receiver
3. **Done**: Settlement is final, no refund window

## Relationship to `exact`

| Aspect             | `exact`            | `escrow`                                           |
| :----------------- | :----------------- | :------------------------------------------------- |
| Settlement         | Immediate transfer | Via escrow contract (authorize) or direct (charge) |
| Refundable         | No                 | Yes (authorize path)                               |
| Fee system         | None               | Commerce-payments managed (min/max bps)            |
| Gas payer          | Facilitator        | Facilitator                                        |
| Signature          | ERC-3009 / Permit2 | ERC-3009                                           |
| On-chain contracts | Token only         | Token + Escrow + Operator + Collector              |

The `charge` settlement method gives `escrow` parity with `exact` for non-refundable payments, while using the commerce-payments fee infrastructure.

## Security Considerations

### Fund Safety

- Funds held in audited [AuthCaptureEscrow](https://github.com/base/commerce-payments) contract
- Cannot overcharge — `amount` capped by client-signed `maxAmount`
- Client can reclaim funds after `authorizationExpiry` if operator disappears
- Fee bounds (`minFeeBps`/`maxFeeBps`) are client-signed and enforced on-chain

### Replay Prevention

- Nonces derived from `keccak256(chainId, escrowAddress, paymentInfoHash)` — unique per payment
- ERC-3009 nonce consumed on-chain by the token contract
- `salt` field provides additional entropy for session uniqueness

### Expiry Enforcement

The contract enforces strict ordering: `preApprovalExpiry <= authorizationExpiry <= refundExpiry`

- `preApprovalExpiry`: Deadline for the ERC-3009 signature (doubles as `validBefore`)
- `authorizationExpiry`: Deadline for capturing escrowed funds
- `refundExpiry`: Deadline for requesting refunds on captured payments

## Appendix

### Commerce Payments Protocol

The escrow scheme is built on Base's [Commerce Payments Protocol](https://blog.base.dev/commerce-payments-protocol), which provides:

- **Escrow**: Singleton contract managing fund locking, capture, refund, and reclaim
- **Operators**: Route payments through escrow with configurable fees
- **Token Collectors**: Pluggable modules for different token authorization methods (ERC-3009, Permit2)

### References

- [Commerce Payments Protocol](https://github.com/base/commerce-payments)
- [EIP-3009: Transfer With Authorization](https://eips.ethereum.org/EIPS/eip-3009)
- [x402 Escrow Scheme Proposal (Issue #834)](https://github.com/coinbase/x402/issues/834)
