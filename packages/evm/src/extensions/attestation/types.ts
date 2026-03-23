import type { Address, Hex } from 'viem'

// ---------------------------------------------------------------------------
// Attestation identity (pre-payment, in 402)
// ---------------------------------------------------------------------------

export interface AttestationIdentity {
  role: string
  operator: Address
  info: string
  signature: Hex
  attestor: Address
}

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
// EIP-712 domains and types
// ---------------------------------------------------------------------------

export const ATTESTATION_IDENTITY_DOMAIN = {
  name: 'x402r attestation identity',
  version: '1',
} as const

export const ATTESTATION_IDENTITY_TYPES = {
  AttestationIdentity: [
    { name: 'role', type: 'string' },
    { name: 'operator', type: 'address' },
    { name: 'info', type: 'string' },
  ],
} as const

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
