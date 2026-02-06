/**
 * Example server - demonstrates both exact and escrow payment schemes
 */

import "dotenv/config";
import express from "express";
// import { paymentMiddleware, x402ResourceServer } from '@x402/express';
// import { ExactEvmScheme } from '@x402/evm/exact/server';
import { EscrowServerScheme } from "@x402r/evm/escrow/server";
// import { HTTPFacilitatorClient } from '@x402/core/server';

const app = express();
const network = "eip155:84532";

// Payment routes configuration
const routes = {
  // Endpoint accepting both escrow and exact payments
  "GET /weather": {
    accepts: [
      // Escrow option - funds held in escrow, refundable
      {
        scheme: "escrow",
        network,
        amount: "1000000", // 1 USDC
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: process.env.RECEIVER_ADDRESS as `0x${string}`,
        extra: {
          escrowAddress: "0xb9488351E48b23D798f24e8174514F28B741Eb4f",
          operatorAddress: process.env.OPERATOR_ADDRESS as `0x${string}`,
          tokenCollector: "0xC80cd08d609673061597DE7fe54Af3978f10A825",
          name: "USDC",
          version: "2",
        },
      },
      // Exact option - immediate transfer, non-refundable
      {
        scheme: "exact",
        network,
        amount: "1000000",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: process.env.RECEIVER_ADDRESS as `0x${string}`,
        extra: { name: "USDC", version: "2" },
      },
    ],
    description: "Weather data",
  },
  // Endpoint accepting only exact payments (low value, no refund needed)
  "GET /time": {
    accepts: [
      {
        scheme: "exact",
        network,
        amount: "10000", // 0.01 USDC
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: process.env.RECEIVER_ADDRESS as `0x${string}`,
        extra: { name: "USDC", version: "2" },
      },
    ],
    description: "Current time",
  },
};

// Initialize server scheme
const escrowScheme = new EscrowServerScheme();

// Simple middleware to return 402 with payment requirements
// In production, use @x402/express paymentMiddleware
app.use((req, res, next) => {
  const routeKey = `${req.method} ${req.path}` as keyof typeof routes;
  const route = routes[routeKey];

  if (!route) {
    return next();
  }

  // Check for payment header
  const paymentHeader = req.headers["payment-signature"];
  if (!paymentHeader) {
    const requirementsPayload = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepts: route.accepts,
        description: route.description,
      }),
    ).toString("base64");
    res.setHeader("payment-required", requirementsPayload);
    return res.status(402).json({
      x402Version: 2,
      accepts: route.accepts,
      description: route.description,
    });
  }

  // TODO: Verify payment with facilitator
  // For now, just pass through
  next();
});

app.get("/weather", (_req, res) => {
  res.json({ weather: "sunny", temperature: 70 });
});

app.get("/time", (_req, res) => {
  res.json({ time: new Date().toISOString() });
});

const PORT = process.env.PORT || 4021;
app.listen(PORT, () => {
  console.log(`Server at http://localhost:${PORT}`);
  console.log("Routes:");
  console.log("  GET /weather - escrow + exact (1 USDC)");
  console.log("  GET /time - exact only (0.01 USDC)");
});
