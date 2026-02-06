/**
 * Example facilitator - demonstrates escrow scheme as a drop-in for x402
 *
 * The escrow scheme registers alongside x402's exact scheme on the same
 * x402Facilitator instance, using the same FacilitatorEvmSigner.
 */

import "dotenv/config";
import express from "express";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
// import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { registerEscrowScheme } from "@x402r/evm/escrow/facilitator";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(),
});

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

// Same signer works for both exact and escrow schemes
const evmSigner = toFacilitatorEvmSigner({
  address: account.address,
  readContract: (args) =>
    publicClient.readContract({ ...args, args: args.args || [] }),
  verifyTypedData: (args) => publicClient.verifyTypedData(args as never),
  writeContract: (args) =>
    walletClient.writeContract({
      ...args,
      account,
      chain: baseSepolia,
      args: args.args || [],
    }),
  sendTransaction: (args) =>
    walletClient.sendTransaction({ ...args, account, chain: baseSepolia }),
  waitForTransactionReceipt: (args) =>
    publicClient.waitForTransactionReceipt(args),
  getCode: (args) => publicClient.getCode(args),
});

const facilitator = new x402Facilitator();
// registerExactEvmScheme(facilitator, { signer: evmSigner, networks: "eip155:84532" });
registerEscrowScheme(facilitator, {
  signer: evmSigner,
  networks: "eip155:84532",
});

const app = express();
app.use(express.json());

app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    const result = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    const result = await facilitator.settle(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (error) {
    console.error("Settle error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/supported", (_req, res) => {
  res.json(facilitator.getSupported());
});

const PORT = process.env.PORT || 4022;
app.listen(PORT, () => {
  console.log(`Facilitator at http://localhost:${PORT}`);
  console.log("Endpoints:");
  console.log("  POST /verify");
  console.log("  POST /settle");
  console.log("  GET /supported");
});
