/**
 * @module @x402r/evm
 *
 * Refundable payments scheme for the x402 protocol, built on the
 * AuthCaptureEscrow contract from base/commerce-payments.
 */

// authCapture scheme client
export { AuthCaptureEvmScheme } from "./authCapture";

// Types
export type {
  AuthCaptureExtra,
  AuthCapturePayload,
  Eip3009Payload,
  PaymentInfoStruct,
  Permit2Payload,
} from "./authCapture/types";
export {
  isAuthCaptureExtra,
  isAuthCapturePayload,
  isEip3009Payload,
  isPermit2Payload,
} from "./authCapture/types";

// Constants
export {
  AUTH_CAPTURE_ESCROW_ADDRESS,
  AUTH_CAPTURE_SCHEME,
  EIP3009_TOKEN_COLLECTOR_ADDRESS,
  PERMIT2_ADDRESS,
  PERMIT2_TOKEN_COLLECTOR_ADDRESS,
} from "./authCapture/constants";
