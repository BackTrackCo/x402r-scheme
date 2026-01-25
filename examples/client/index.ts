/**
 * Example client - demonstrates both exact and escrow payment schemes
 */

import 'dotenv/config';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
// import { ExactScheme } from '@x402/evm/exact/client';
import { EscrowScheme } from '@x402r/evm/escrow/client';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(),
});

interface PaymentRequired {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    asset: `0x${string}`;
    payTo: `0x${string}`;
    extra: Record<string, unknown>;
  }>;
}

/**
 * Make a payment for a 402 response
 */
async function makePayment(paymentRequired: PaymentRequired) {
  // Find preferred payment option (escrow if available, fallback to exact)
  const escrowOption = paymentRequired.accepts.find((a) => a.scheme === 'escrow');
  const exactOption = paymentRequired.accepts.find((a) => a.scheme === 'exact');

  let paymentPayload;

  if (escrowOption) {
    // Use escrow scheme (funds held in escrow, refundable)
    console.log('Using escrow scheme (refundable)');
    const payload = await EscrowScheme.createPaymentPayload(escrowOption as any, wallet);
    paymentPayload = { x402Version: 2, scheme: 'escrow', payload };
  } else if (exactOption) {
    // Use exact scheme (immediate transfer, non-refundable)
    // const payload = await ExactScheme.createPaymentPayload(exactOption, wallet);
    // paymentPayload = { x402Version: 2, scheme: 'exact', payload };
    throw new Error('Exact scheme not implemented in this example');
  } else {
    throw new Error('No supported payment scheme');
  }

  const response = await fetch('http://localhost:4021/weather', {
    headers: { 'X-Payment': JSON.stringify(paymentPayload) },
  });

  if (response.ok) {
    console.log('Payment successful!');
    console.log(await response.json());
  } else if (response.status === 402) {
    console.log('Payment required');
    const body = await response.json();
    console.log(body);
  } else {
    console.error('Request failed:', response.status);
  }
}

// Example: Fetch a resource and handle 402
async function main() {
  // First request without payment
  const response = await fetch('http://localhost:4021/weather');

  if (response.status === 402) {
    const paymentRequired = (await response.json()) as PaymentRequired;
    console.log('Payment required:', paymentRequired);
    await makePayment(paymentRequired);
  } else {
    console.log(await response.json());
  }
}

main().catch(console.error);
