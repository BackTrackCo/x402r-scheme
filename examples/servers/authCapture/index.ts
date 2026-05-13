import { AuthCaptureEvmScheme as AuthCaptureEvmServer } from "@x402r/evm/authCapture/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { config } from "dotenv";
import express from "express";

config();

const NETWORK = "eip155:84532" as const;
const PORT = Number(process.env.PORT || "4021");

const evmAddress = process.env.EVM_ADDRESS as `0x${string}` | undefined;
const captureAuthorizer = process.env.CAPTURE_AUTHORIZER as `0x${string}` | undefined;
const facilitatorUrl = process.env.FACILITATOR_URL;

if (!evmAddress || !/^0x[0-9a-fA-F]{40}$/.test(evmAddress)) {
  console.error("Missing or invalid EVM_ADDRESS (checksummed 20-byte hex, 0x-prefixed)");
  process.exit(1);
}
if (!captureAuthorizer || !/^0x[0-9a-fA-F]{40}$/.test(captureAuthorizer)) {
  console.error("Missing or invalid CAPTURE_AUTHORIZER");
  process.exit(1);
}
if (!facilitatorUrl) {
  console.error("Missing FACILITATOR_URL");
  process.exit(1);
}

// Static deadlines: every authorization created by this server expires at
// the same absolute Unix second. Production servers typically compute these
// per request via custom middleware; static deadlines suffice for the demo.
const now = Math.floor(Date.now() / 1000);
const captureDeadline = now + 30 * 86400;
const refundDeadline = now + 60 * 86400;

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK,
  new AuthCaptureEvmServer(),
);

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: {
          scheme: "authCapture",
          price: "$0.01",
          network: NETWORK,
          payTo: evmAddress,
          extra: {
            captureAuthorizer,
            captureDeadline,
            refundDeadline,
            feeRecipient: captureAuthorizer,
            minFeeBps: 0,
            maxFeeBps: 100,
            name: "USDC",
            version: "2",
          },
        },
        description: "Weather data",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/weather", (_req, res) => {
  res.send({
    report: {
      weather: "sunny",
      temperature: 70,
    },
  });
});

app.listen(PORT, () => {
  console.log(`authCapture server listening at http://localhost:${PORT}`);
  console.log("  GET /weather");
  console.log(`  Pay-to:            ${evmAddress}`);
  console.log(`  captureAuthorizer: ${captureAuthorizer}`);
  console.log(`  captureDeadline:   ${new Date(captureDeadline * 1000).toISOString()}`);
  console.log(`  refundDeadline:    ${new Date(refundDeadline * 1000).toISOString()}`);
});
