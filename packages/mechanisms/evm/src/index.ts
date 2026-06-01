/**
 * @module @x402r/evm
 *
 * Refundable payments scheme for the x402 protocol, built on the
 * AuthCaptureEscrow contract from base/commerce-payments.
 *
 * The server and facilitator scheme classes are published under their own
 * subpaths (`@x402r/evm/auth-capture/{server,facilitator}`). The client-side
 * signing scheme lives upstream in `@x402/evm/auth-capture/client`. This entry
 * point exposes the shared wire types and constants.
 */

// Types
export type {
  AuthCaptureExtra,
  AuthCapturePayload,
  Eip3009Payload,
  PaymentInfoStruct,
  Permit2Payload,
} from "./auth-capture/types";
export {
  isAuthCaptureExtra,
  isAuthCapturePayload,
  isEip3009Payload,
  isPermit2Payload,
} from "./auth-capture/types";

// Constants
export {
  AUTH_CAPTURE_ESCROW_ADDRESS,
  AUTH_CAPTURE_SCHEME,
  EIP3009_TOKEN_COLLECTOR_ADDRESS,
  PERMIT2_ADDRESS,
  PERMIT2_TOKEN_COLLECTOR_ADDRESS,
} from "./auth-capture/constants";
