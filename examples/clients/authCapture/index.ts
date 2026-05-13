import { AuthCaptureEvmScheme } from "@x402r/evm/authCapture/client";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";

config();

const evmPrivateKey = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;
const baseURL = process.env.RESOURCE_SERVER_URL || "http://localhost:4021";
const endpointPath = process.env.ENDPOINT_PATH || "/weather";
const url = `${baseURL}${endpointPath}`;

/**
 * Runs a single paid request against an authCapture-protected endpoint.
 *
 * The scheme signs a payer-agnostic PaymentInfo hash (as the ERC-3009 nonce by
 * default; Permit2 is also supported). The facilitator submits the resulting
 * authorization to the AuthCaptureEscrow contract; funds are locked there until
 * the captureAuthorizer captures, voids, or the authorization expires.
 *
 * @returns Resolves after the request completes and the payment response is logged.
 */
async function main(): Promise<void> {
  if (!evmPrivateKey) {
    console.error("EVM_PRIVATE_KEY environment variable is required");
    process.exit(1);
  }

  const evmAccount = privateKeyToAccount(evmPrivateKey);

  const client = new x402Client();
  client.register("eip155:*", new AuthCaptureEvmScheme(evmAccount));

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  console.log(`Payer: ${evmAccount.address}`);
  console.log(`Making request to: ${url}\n`);

  const response = await fetchWithPayment(url, { method: "GET" });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  console.log("Response body:", body);

  const paymentResponse = new x402HTTPClient(client).getPaymentSettleResponse(name =>
    response.headers.get(name),
  );
  console.log("\nPayment response:", JSON.stringify(paymentResponse, null, 2));
}

main().catch(error => {
  console.error(error?.response?.data?.error ?? error);
  process.exit(1);
});
