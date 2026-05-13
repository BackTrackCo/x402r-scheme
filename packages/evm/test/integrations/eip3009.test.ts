/**
 * Integration test for EIP-3009 settle paths against canonical
 * AuthCaptureEscrow on Base Sepolia. Catches the class of bugs that pure mocks
 * miss, most notably ABI mismatches against the deployed escrow.
 *
 * Strategy:
 *  1. Spawn anvil forked from Base Sepolia (test/integrations/anvil-setup.ts).
 *  2. Write USDC balance for a fresh payer keypair via anvil_setStorageAt.
 *  3. Build a real EIP-3009 payload via the client scheme, signing with the
 *     payer's privkey.
 *  4. Run facilitator.settle() against the canonical escrow.
 *  5. Assert tx success.
 *
 * Test runs both autoCapture: false (escrow.authorize) and autoCapture: true
 * (escrow.charge). The charge case is the ABI-arity regression that the unit
 * test in facilitator.test.ts asserts in argument shape; this fork test
 * additionally proves the call succeeds against the real chain.
 *
 * Storage slot for USDC `balances` is empirically slot 9 for the Bridged USDC
 * implementation deployed on Base Sepolia. If this changes, BALANCE_SLOT below
 * needs an update — the test will surface it as a balance-related revert.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  pad,
  parseUnits,
  toHex,
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { AuthCaptureEvmScheme } from '../../src/authCapture/client/scheme'
import { AuthCaptureFacilitatorScheme } from '../../src/authCapture/facilitator/scheme'
import {
  AUTH_CAPTURE_ESCROW_ADDRESS,
  ESCROW_VIEW_ABI,
} from '../../src/authCapture/shared/constants'
import type { Eip3009Payload, PaymentInfoStruct } from '../../src/authCapture/shared/types'

const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
const BALANCE_SLOT = 9n

function balanceStorageKey(holder: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [holder, BALANCE_SLOT]),
  )
}

describe('fork — EIP-3009 settle against canonical AuthCaptureEscrow', () => {
  const rpcUrl = process.env.ANVIL_RPC_URL
  if (!rpcUrl) {
    it.skip('fork-test setup did not export ANVIL_RPC_URL', () => {})
    return
  }

  const transport = http(rpcUrl)
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const testClient = createTestClient({ chain: baseSepolia, transport, mode: 'anvil' })

  // Fresh payer keypair (we need the privkey to sign ERC-3009)
  const payerPk = generatePrivateKey()
  const payerAccount = privateKeyToAccount(payerPk)

  // Fresh facilitator keypair (= captureAuthorizer; escrow's onlySender check)
  const facilitatorPk = generatePrivateKey()
  const facilitatorAccount = privateKeyToAccount(facilitatorPk)
  const facilitatorWallet = createWalletClient({
    account: facilitatorAccount,
    chain: baseSepolia,
    transport,
  })

  const oneUsdc = parseUnits('1', 6) // 1 USDC

  beforeAll(async () => {
    // Fund both accounts with ETH for gas
    await testClient.setBalance({ address: payerAccount.address, value: parseUnits('10', 18) })
    await testClient.setBalance({
      address: facilitatorAccount.address,
      value: parseUnits('10', 18),
    })

    // Give payer 100 USDC by writing directly to storage
    await testClient.setStorageAt({
      address: USDC_ADDRESS,
      index: balanceStorageKey(payerAccount.address),
      value: pad(toHex(oneUsdc * 100n), { size: 32 }),
    })

    // Sanity-check the balance write — if slot 9 is wrong, surface it loudly
    const balance = (await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: [
        {
          name: 'balanceOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'a', type: 'address' }],
          outputs: [{ type: 'uint256' }],
        },
      ],
      functionName: 'balanceOf',
      args: [payerAccount.address],
    })) as bigint
    expect(balance).toBeGreaterThanOrEqual(oneUsdc)
  })

  // Wrap viem account into the ClientEvmSigner shape the scheme expects
  const clientSigner = {
    address: payerAccount.address,
    signTypedData: (args: Parameters<typeof payerAccount.signTypedData>[0]) =>
      payerAccount.signTypedData(args),
  }

  // Wrap the facilitator wallet into the FacilitatorEvmSigner shape the scheme
  // expects. The facilitator sends txs (writeContract / readContract /
  // verifyTypedData / waitForTransactionReceipt). We reuse the wallet client
  // for write paths and the public client for reads.
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
  }

  function buildRequirements(autoCapture: boolean) {
    const now = Math.floor(Date.now() / 1000)
    return {
      scheme: 'authCapture',
      network: 'eip155:84532',
      amount: oneUsdc.toString(),
      asset: USDC_ADDRESS,
      payTo: '0x000000000000000000000000000000000000beef' as `0x${string}`,
      maxTimeoutSeconds: 300,
      extra: {
        captureAuthorizer: facilitatorAccount.address,
        captureDeadline: now + 3600,
        refundDeadline: now + 7200,
        feeRecipient: facilitatorAccount.address,
        maxFeeBps: 100,
        minFeeBps: 0,
        name: 'USDC',
        version: '2',
        autoCapture,
      },
    }
  }

  /**
   * Reconstruct the on-chain PaymentInfo struct from the requirements + the
   * client-generated salt + payer. Mirrors the facilitator's own reconstruction
   * — used here to compute the post-settle paymentInfoHash.
   */
  function reconstructPaymentInfo(
    requirements: ReturnType<typeof buildRequirements>,
    payload: Eip3009Payload,
  ): PaymentInfoStruct {
    return {
      operator: requirements.extra.captureAuthorizer,
      payer: payerAccount.address,
      receiver: requirements.payTo,
      token: requirements.asset,
      maxAmount: requirements.amount,
      preApprovalExpiry: Number(payload.authorization.validBefore),
      authorizationExpiry: requirements.extra.captureDeadline,
      refundExpiry: requirements.extra.refundDeadline,
      minFeeBps: requirements.extra.minFeeBps,
      maxFeeBps: requirements.extra.maxFeeBps,
      feeReceiver: requirements.extra.feeRecipient,
      salt: payload.salt,
    }
  }

  async function readPaymentState(paymentInfoHash: `0x${string}`) {
    return (await publicClient.readContract({
      address: AUTH_CAPTURE_ESCROW_ADDRESS,
      abi: ESCROW_VIEW_ABI,
      functionName: 'paymentState',
      args: [paymentInfoHash],
    })) as { hasCollectedPayment: boolean; capturableAmount: bigint; refundableAmount: bigint }
  }

  it('settles authorize() against canonical AuthCaptureEscrow', async () => {
    const client = new AuthCaptureEvmScheme(clientSigner)
    const facilitator = new AuthCaptureFacilitatorScheme(
      facilitatorSigner as unknown as Parameters<typeof AuthCaptureFacilitatorScheme>[0],
    )

    const requirements = buildRequirements(false)
    const { payload } = await client.createPaymentPayload(2, requirements)
    const wirePayload = payload as unknown as Eip3009Payload

    const settleResult = await facilitator.settle(
      {
        x402Version: 2,
        scheme: 'authCapture',
        resource: { url: 'https://example.com', method: 'GET' },
        accepted: requirements,
        payload,
      },
      requirements,
    )

    if (!settleResult.success) {
      // If this fails, it's almost certainly the BALANCE_SLOT being wrong for
      // the current USDC implementation. Surface the actual reason.
      throw new Error(`settle authorize failed: ${settleResult.errorReason}`)
    }
    expect(settleResult.success).toBe(true)
    expect(settleResult.transaction).toMatch(/^0x[a-fA-F0-9]{64}$/)

    // Post-state assertion: authorize() should record capturableAmount = amount,
    // refundableAmount = 0, hasCollectedPayment = true. Read via the escrow's
    // canonical getHash + paymentState views to prove the on-chain effect, not
    // just non-revert.
    const paymentInfo = reconstructPaymentInfo(requirements, wirePayload)
    const paymentInfoHash = (await publicClient.readContract({
      address: AUTH_CAPTURE_ESCROW_ADDRESS,
      abi: ESCROW_VIEW_ABI,
      functionName: 'getHash',
      args: [
        {
          ...paymentInfo,
          maxAmount: BigInt(paymentInfo.maxAmount),
          salt: BigInt(paymentInfo.salt),
        },
      ],
    })) as `0x${string}`
    const state = await readPaymentState(paymentInfoHash)
    expect(state.hasCollectedPayment).toBe(true)
    expect(state.capturableAmount).toBe(oneUsdc)
    expect(state.refundableAmount).toBe(0n)
  })

  it('settles charge() against canonical AuthCaptureEscrow (regression for 6-arg ABI)', async () => {
    const client = new AuthCaptureEvmScheme(clientSigner)
    const facilitator = new AuthCaptureFacilitatorScheme(
      facilitatorSigner as unknown as Parameters<typeof AuthCaptureFacilitatorScheme>[0],
    )

    const requirements = buildRequirements(true)
    const { payload } = await client.createPaymentPayload(2, requirements)
    const wirePayload = payload as unknown as Eip3009Payload

    const settleResult = await facilitator.settle(
      {
        x402Version: 2,
        scheme: 'authCapture',
        resource: { url: 'https://example.com', method: 'GET' },
        accepted: requirements,
        payload,
      },
      requirements,
    )

    if (!settleResult.success) {
      throw new Error(`settle charge failed: ${settleResult.errorReason}`)
    }
    expect(settleResult.success).toBe(true)
    expect(settleResult.transaction).toMatch(/^0x[a-fA-F0-9]{64}$/)

    // Post-state assertion: charge() records hasCollectedPayment = true,
    // capturableAmount = 0, refundableAmount = amount (funds went straight
    // to receiver, fully refundable within the refund window).
    const paymentInfo = reconstructPaymentInfo(requirements, wirePayload)
    const paymentInfoHash = (await publicClient.readContract({
      address: AUTH_CAPTURE_ESCROW_ADDRESS,
      abi: ESCROW_VIEW_ABI,
      functionName: 'getHash',
      args: [
        {
          ...paymentInfo,
          maxAmount: BigInt(paymentInfo.maxAmount),
          salt: BigInt(paymentInfo.salt),
        },
      ],
    })) as `0x${string}`
    const state = await readPaymentState(paymentInfoHash)
    expect(state.hasCollectedPayment).toBe(true)
    expect(state.capturableAmount).toBe(0n)
    expect(state.refundableAmount).toBe(oneUsdc)

    // Also: receiver actually got the tokens (charge sends funds direct).
    const receiverBalance = (await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: [
        {
          name: 'balanceOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'a', type: 'address' }],
          outputs: [{ type: 'uint256' }],
        },
      ],
      functionName: 'balanceOf',
      args: [requirements.payTo],
    })) as bigint
    // minFeeBps = 0 in the test fixture, so the receiver gets the full amount.
    expect(receiverBalance).toBe(oneUsdc)
  })
})
