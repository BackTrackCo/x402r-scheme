import { AuthCaptureEvmScheme as AuthCaptureEvmFacilitator } from "@x402r/evm/authCapture/facilitator";
import { x402Facilitator } from "@x402/core/facilitator";
import {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import dotenv from "dotenv";
import express from "express";
import { createWalletClient, http, nonceManager, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

dotenv.config();

const PORT = Number(process.env.PORT || "4022");
const NETWORK = "eip155:84532" as const;
const evmRpcUrl = process.env.EVM_RPC_URL ?? "https://sepolia.base.org";

if (!process.env.EVM_PRIVATE_KEY) {
  console.error("EVM_PRIVATE_KEY environment variable is required");
  process.exit(1);
}

const evmAccount = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`, {
  nonceManager,
});

console.info(`EVM Facilitator account: ${evmAccount.address}`);

const viemClient = createWalletClient({
  account: evmAccount,
  chain: baseSepolia,
  transport: http(evmRpcUrl),
}).extend(publicActions);

const evmSigner = toFacilitatorEvmSigner({
  address: evmAccount.address,
  getCode: args => viemClient.getCode(args),
  readContract: args =>
    viemClient.readContract({ ...args, args: args.args ?? [] } as Parameters<
      typeof viemClient.readContract
    >[0]),
  verifyTypedData: args =>
    viemClient.verifyTypedData(args as Parameters<typeof viemClient.verifyTypedData>[0]),
  writeContract: args =>
    viemClient.writeContract(args as Parameters<typeof viemClient.writeContract>[0]),
  sendTransaction: args =>
    viemClient.sendTransaction(args as Parameters<typeof viemClient.sendTransaction>[0]),
  waitForTransactionReceipt: args => viemClient.waitForTransactionReceipt(args),
});

const facilitator = new x402Facilitator();
facilitator.register(NETWORK, new AuthCaptureEvmFacilitator(evmSigner));

const app = express();
app.use(express.json());

app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response: VerifyResponse = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response: SettleResponse = await facilitator.settle(
      paymentPayload as PaymentPayload,
      paymentRequirements as PaymentRequirements,
    );
    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/supported", async (_req, res) => {
  try {
    res.json(facilitator.getSupported());
  } catch (error) {
    console.error("Supported error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.listen(PORT, () => {
  console.log(`authCapture facilitator listening at http://localhost:${PORT}`);
});
