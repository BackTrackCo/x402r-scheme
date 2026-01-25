/**
 * Example facilitator - demonstrates both exact and escrow payment schemes
 */

import 'dotenv/config';
import express from 'express';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
// import { x402Facilitator } from '@x402/core/facilitator';
// import { toFacilitatorEvmSigner } from '@x402/evm';
// import { registerExactEvmScheme } from '@x402/evm/exact/facilitator';
import {
  EscrowFacilitatorScheme,
  type FacilitatorEvmSigner,
  type PaymentPayload,
  type PaymentRequirements,
} from '@x402r/evm/escrow/facilitator';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const client = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(),
}).extend(publicActions);

const network = 'eip155:84532' as const;

// Create signer compatible with FacilitatorEvmSigner interface
const signer: FacilitatorEvmSigner = {
  address: account.address,
  writeContract: async (args) => {
    return client.writeContract({
      ...args,
      account,
    } as any);
  },
  verifyTypedData: async (args) => {
    return client.verifyTypedData(args as any);
  },
};

// Initialize escrow scheme directly (without x402Facilitator for simplicity)
const escrowScheme = new EscrowFacilitatorScheme(signer);

// Map of registered schemes
const schemes = new Map([['escrow', escrowScheme]]);

const app = express();
app.use(express.json());

app.post('/verify', async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    // Find the right scheme
    const scheme = schemes.get(paymentPayload.scheme);
    if (!scheme) {
      return res.status(400).json({ error: `Unsupported scheme: ${paymentPayload.scheme}` });
    }

    const result = await scheme.verify(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/settle', async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    // Find the right scheme
    const scheme = schemes.get(paymentPayload.scheme);
    if (!scheme) {
      return res.status(400).json({ error: `Unsupported scheme: ${paymentPayload.scheme}` });
    }

    const result = await scheme.settle(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (error) {
    console.error('Settle error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/supported', (_req, res) => {
  res.json({
    kinds: [
      { x402Version: 2, scheme: 'escrow', network },
      // { x402Version: 2, scheme: 'exact', network },
    ],
  });
});

const PORT = process.env.PORT || 4022;
app.listen(PORT, () => {
  console.log(`Facilitator at http://localhost:${PORT}`);
  console.log('Supported schemes: escrow');
  console.log('Endpoints:');
  console.log('  POST /verify');
  console.log('  POST /settle');
  console.log('  GET /supported');
});
