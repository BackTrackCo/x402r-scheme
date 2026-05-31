// The client-side signing scheme now lives upstream in @x402/evm. Our local
// implementation was upstreamed verbatim, so we re-export it rather than
// maintain a second copy that must stay byte-compatible with the facilitator's
// hash/signature verification (see test/unit/auth-capture/client.test.ts for
// the compatibility guard). The server and facilitator layers remain local.
export { AuthCaptureEvmScheme } from "@x402/evm/auth-capture/client";
