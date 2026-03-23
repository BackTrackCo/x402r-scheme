import type { Address, Hex } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import {
  ATTESTATION_IDENTITY_DOMAIN,
  ATTESTATION_IDENTITY_TYPES,
  ATTESTATION_ACKNOWLEDGMENT_DOMAIN,
  ATTESTATION_ACKNOWLEDGMENT_TYPES,
  type AttestationIdentity,
  type AttestationAcknowledgment,
} from './types.js'

/**
 * Sign an attestation identity. The attestor calls this to produce
 * a signed identity that merchants include in 402 responses.
 */
export async function signAttestationIdentity(
  account: LocalAccount,
  operator: Address,
  role: string,
  info: string,
): Promise<AttestationIdentity> {
  const signature = await account.signTypedData({
    domain: ATTESTATION_IDENTITY_DOMAIN,
    types: ATTESTATION_IDENTITY_TYPES,
    primaryType: 'AttestationIdentity',
    message: { role, operator, info },
  })

  return { role, operator, info, signature, attestor: account.address }
}

/**
 * Sign an attestation acknowledgment. The attestor calls this to prove
 * it received specific content for evaluation.
 */
export async function signAttestationAcknowledgment(
  account: LocalAccount,
  params: {
    operator: Address
    transaction: string
    network: string
    contentHash: Hex
  },
): Promise<AttestationAcknowledgment> {
  const timestamp = Math.floor(Date.now() / 1000)

  const signature = await account.signTypedData({
    domain: ATTESTATION_ACKNOWLEDGMENT_DOMAIN,
    types: ATTESTATION_ACKNOWLEDGMENT_TYPES,
    primaryType: 'AttestationAcknowledgment',
    message: {
      operator: params.operator,
      transaction: params.transaction,
      network: params.network,
      contentHash: params.contentHash,
      timestamp: BigInt(timestamp),
    },
  })

  return { ...params, timestamp, signature, attestor: account.address }
}
