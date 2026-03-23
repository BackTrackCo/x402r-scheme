import type { Address, Hex } from 'viem'

// ---------------------------------------------------------------------------
// Attestation acknowledgment (post-payment, in 200)
// ---------------------------------------------------------------------------

export interface AttestationAcknowledgment {
  operator: Address
  transaction: string
  network: string
  contentHash: Hex
  timestamp: number
  signature: Hex
  attestor: Address
}

// ---------------------------------------------------------------------------
// EIP-712 domain and types
// ---------------------------------------------------------------------------

export const ATTESTATION_ACKNOWLEDGMENT_DOMAIN = {
  name: 'x402r attestation acknowledgment',
  version: '1',
} as const

export const ATTESTATION_ACKNOWLEDGMENT_TYPES = {
  AttestationAcknowledgment: [
    { name: 'operator', type: 'address' },
    { name: 'transaction', type: 'string' },
    { name: 'network', type: 'string' },
    { name: 'contentHash', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const

// ---------------------------------------------------------------------------
// Extension key
// ---------------------------------------------------------------------------

export const ATTESTATION_KEY = 'attestation'
