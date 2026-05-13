/**
 * Integration test for Permit2 settle paths against canonical AuthCaptureEscrow
 * on Base Sepolia. Mirrors test/integrations/eip3009.test.ts but exercises the
 * Permit2PaymentCollector path.
 *
 * Setup needs:
 *  - Payer USDC balance (anvil_setStorageAt at the balanceOf slot)
 *  - Payer's USDC allowance for Permit2 = max (anvil_setStorageAt at the
 *    allowed[holder][PERMIT2] slot)
 *
 * USDC allowance storage: `mapping(address => mapping(address => uint256)) allowed`
 * at slot 10 in the Bridged USDC implementation. Slot for allowed[holder][spender]:
 *   keccak256(abi.encode(spender, keccak256(abi.encode(holder, 10))))
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  maxUint256,
  pad,
  parseUnits,
  toHex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { AuthCaptureEvmScheme } from "../../src/authCapture/client/scheme";
import { AuthCaptureFacilitatorScheme } from "../../src/authCapture/facilitator/scheme";
import {
  AUTH_CAPTURE_ESCROW_ADDRESS,
  ESCROW_VIEW_ABI,
  PERMIT2_ADDRESS,
} from "../../src/authCapture/constants";
import type { PaymentInfoStruct, Permit2Payload } from "../../src/authCapture/types";

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const BALANCE_SLOT = 9n;
const ALLOWANCE_SLOT = 10n;

function balanceStorageKey(holder: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, BALANCE_SLOT]),
  );
}

function allowanceStorageKey(holder: `0x${string}`, spender: `0x${string}`): `0x${string}` {
  const innerKey = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, ALLOWANCE_SLOT]),
  );
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, innerKey]),
  );
}

describe("fork — Permit2 settle against canonical AuthCaptureEscrow", () => {
  const rpcUrl = process.env.ANVIL_RPC_URL;
  if (!rpcUrl) {
    it.skip("fork-test setup did not export ANVIL_RPC_URL", () => {});
    return;
  }

  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const testClient = createTestClient({ chain: baseSepolia, transport, mode: "anvil" });

  const payerPk = generatePrivateKey();
  const payerAccount = privateKeyToAccount(payerPk);

  const facilitatorPk = generatePrivateKey();
  const facilitatorAccount = privateKeyToAccount(facilitatorPk);
  const facilitatorWallet = createWalletClient({
    account: facilitatorAccount,
    chain: baseSepolia,
    transport,
  });

  const oneUsdc = parseUnits("1", 6);

  beforeAll(async () => {
    await testClient.setBalance({ address: payerAccount.address, value: parseUnits("10", 18) });
    await testClient.setBalance({
      address: facilitatorAccount.address,
      value: parseUnits("10", 18),
    });
    // USDC balance for payer
    await testClient.setStorageAt({
      address: USDC_ADDRESS,
      index: balanceStorageKey(payerAccount.address),
      value: pad(toHex(oneUsdc * 100n), { size: 32 }),
    });
    // Permit2 allowance for payer — max
    await testClient.setStorageAt({
      address: USDC_ADDRESS,
      index: allowanceStorageKey(payerAccount.address, PERMIT2_ADDRESS),
      value: pad(toHex(maxUint256), { size: 32 }),
    });
  });

  const clientSigner = {
    address: payerAccount.address,
    signTypedData: (args: Parameters<typeof payerAccount.signTypedData>[0]) =>
      payerAccount.signTypedData(args),
  };

  const facilitatorSigner = {
    getAddresses: () => [facilitatorAccount.address] as readonly `0x${string}`[],
    readContract: (args: Parameters<typeof publicClient.readContract>[0]) =>
      publicClient.readContract(args),
    writeContract: (args: Parameters<typeof facilitatorWallet.writeContract>[0]) =>
      facilitatorWallet.writeContract(args),
    waitForTransactionReceipt: (
      args: Parameters<typeof publicClient.waitForTransactionReceipt>[0],
    ) => publicClient.waitForTransactionReceipt(args),
    verifyTypedData: (args: Parameters<typeof publicClient.verifyTypedData>[0]) =>
      publicClient.verifyTypedData(args),
  };

  function buildRequirements(autoCapture: boolean) {
    const now = Math.floor(Date.now() / 1000);
    return {
      scheme: "authCapture",
      network: "eip155:84532",
      amount: oneUsdc.toString(),
      asset: USDC_ADDRESS,
      payTo: "0x000000000000000000000000000000000000beef" as `0x${string}`,
      maxTimeoutSeconds: 300,
      extra: {
        captureAuthorizer: facilitatorAccount.address,
        captureDeadline: now + 3600,
        refundDeadline: now + 7200,
        feeRecipient: facilitatorAccount.address,
        maxFeeBps: 100,
        minFeeBps: 0,
        name: "USDC",
        version: "2",
        autoCapture,
        assetTransferMethod: "permit2" as const,
      },
    };
  }

  function reconstructPaymentInfo(
    requirements: ReturnType<typeof buildRequirements>,
    payload: Permit2Payload,
  ): PaymentInfoStruct {
    return {
      operator: requirements.extra.captureAuthorizer,
      payer: payerAccount.address,
      receiver: requirements.payTo,
      token: requirements.asset,
      maxAmount: requirements.amount,
      preApprovalExpiry: Number(payload.permit2Authorization.deadline),
      authorizationExpiry: requirements.extra.captureDeadline,
      refundExpiry: requirements.extra.refundDeadline,
      minFeeBps: requirements.extra.minFeeBps,
      maxFeeBps: requirements.extra.maxFeeBps,
      feeReceiver: requirements.extra.feeRecipient,
      salt: payload.salt,
    };
  }

  async function readPaymentState(p: PaymentInfoStruct) {
    const hash = (await publicClient.readContract({
      address: AUTH_CAPTURE_ESCROW_ADDRESS,
      abi: ESCROW_VIEW_ABI,
      functionName: "getHash",
      args: [{ ...p, maxAmount: BigInt(p.maxAmount), salt: BigInt(p.salt) }],
    })) as `0x${string}`;
    return (await publicClient.readContract({
      address: AUTH_CAPTURE_ESCROW_ADDRESS,
      abi: ESCROW_VIEW_ABI,
      functionName: "paymentState",
      args: [hash],
    })) as { hasCollectedPayment: boolean; capturableAmount: bigint; refundableAmount: bigint };
  }

  it("settles authorize() via Permit2 collector", async () => {
    const client = new AuthCaptureEvmScheme(clientSigner);
    const facilitator = new AuthCaptureFacilitatorScheme(
      facilitatorSigner as unknown as Parameters<typeof AuthCaptureFacilitatorScheme>[0],
    );

    const requirements = buildRequirements(false);
    const { payload } = await client.createPaymentPayload(2, requirements);
    const wirePayload = payload as unknown as Permit2Payload;

    const settleResult = await facilitator.settle(
      {
        x402Version: 2,
        scheme: "authCapture",
        resource: { url: "https://example.com", method: "GET" },
        accepted: requirements,
        payload,
      },
      requirements,
    );

    if (!settleResult.success) {
      throw new Error(`settle authorize+permit2 failed: ${settleResult.errorReason}`);
    }
    expect(settleResult.success).toBe(true);

    // Post-state: capturableAmount should equal the authorized amount.
    const state = await readPaymentState(reconstructPaymentInfo(requirements, wirePayload));
    expect(state.hasCollectedPayment).toBe(true);
    expect(state.capturableAmount).toBe(oneUsdc);
    expect(state.refundableAmount).toBe(0n);
  });

  it("settles charge() via Permit2 collector (autoCapture + permit2 combo)", async () => {
    const client = new AuthCaptureEvmScheme(clientSigner);
    const facilitator = new AuthCaptureFacilitatorScheme(
      facilitatorSigner as unknown as Parameters<typeof AuthCaptureFacilitatorScheme>[0],
    );

    const requirements = buildRequirements(true);
    const { payload } = await client.createPaymentPayload(2, requirements);
    const wirePayload = payload as unknown as Permit2Payload;

    const settleResult = await facilitator.settle(
      {
        x402Version: 2,
        scheme: "authCapture",
        resource: { url: "https://example.com", method: "GET" },
        accepted: requirements,
        payload,
      },
      requirements,
    );

    if (!settleResult.success) {
      throw new Error(`settle charge+permit2 failed: ${settleResult.errorReason}`);
    }
    expect(settleResult.success).toBe(true);

    const state = await readPaymentState(reconstructPaymentInfo(requirements, wirePayload));
    expect(state.hasCollectedPayment).toBe(true);
    expect(state.capturableAmount).toBe(0n);
    expect(state.refundableAmount).toBe(oneUsdc);
  });
});
