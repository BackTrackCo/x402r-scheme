export { createAttestationExtension, declareAttestationExtension } from './server.js'
export { signAttestationIdentity, signAttestationAcknowledgment } from './signing.js'
export {
  ATTESTATION_KEY,
  ATTESTATION_IDENTITY_DOMAIN,
  ATTESTATION_IDENTITY_TYPES,
  ATTESTATION_ACKNOWLEDGMENT_DOMAIN,
  ATTESTATION_ACKNOWLEDGMENT_TYPES,
  type AttestationIdentity,
  type AttestationAcknowledgment,
} from './types.js'
