import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  hexToBigInt,
  type Log,
} from "viem";
import {
  AuthCaptureEvmScheme,
  CAPTURE_AUTHORIZER_GAS_LIMIT,
} from "../../../src/auth-capture/facilitator/scheme";
import {
  ERC20_TRANSFER_EVENT_ABI,
  ESCROW_ABI,
  ESCROW_EVENTS_ABI,
  PAYMENT_INFO_COMPONENTS,
} from "../../../src/auth-capture/abi";
import {
  AUTH_CAPTURE_ESCROW_ADDRESS,
  EIP3009_TOKEN_COLLECTOR_ADDRESS,
  PERMIT2_TOKEN_COLLECTOR_ADDRESS,
} from "../../../src/auth-capture/constants";
import {
  computeOnchainPaymentInfoHash,
  computePayerAgnosticPaymentInfoHash,
} from "../../../src/auth-capture/nonce";
import type { PaymentInfoStruct } from "../../../src/auth-capture/types";

/**
 * Build a fake ERC-20 Transfer log that the trace simulator can return.
 */
function transferLog(
  token: `0x${string}`,
  from: `0x${string}`,
  to: `0x${string}`,
  value: bigint,
): Log {
  const topics = encodeEventTopics({
    abi: ERC20_TRANSFER_EVENT_ABI,
    eventName: "Transfer",
    args: { from, to },
  });
  const data = encodeAbiParameters([{ type: "uint256" }], [value]);
  return {
    address: token,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    data,
    blockNumber: 0n,
    transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
    transactionIndex: 0,
    blockHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
    logIndex: 0,
    removed: false,
  } as Log;
}

/**
 * Build a PaymentAuthorized / PaymentCharged log emitted by the canonical
 * AuthCaptureEscrow address with the correct on-chain paymentInfoHash topic.
 */
function escrowEventLog(
  paymentInfo: PaymentInfoStruct,
  amount: bigint,
  functionName: "authorize" | "charge",
  tokenCollector: `0x${string}`,
  chainId: number,
  feeBps = 0,
  feeReceiver: `0x${string}` = paymentInfo.feeReceiver,
  override?: { paymentInfoHash?: `0x${string}`; address?: `0x${string}` },
): Log {
  const hash = override?.paymentInfoHash ?? computeOnchainPaymentInfoHash(chainId, paymentInfo);
  const eventName = functionName === "authorize" ? "PaymentAuthorized" : "PaymentCharged";
  const topics = encodeEventTopics({
    abi: ESCROW_EVENTS_ABI,
    eventName,
    args: { paymentInfoHash: hash },
  });
  const paymentInfoTuple = {
    ...paymentInfo,
    maxAmount: BigInt(paymentInfo.maxAmount),
    salt: BigInt(paymentInfo.salt),
  };
  const data =
    functionName === "authorize"
      ? encodeAbiParameters(
          [
            { type: "tuple", components: PAYMENT_INFO_COMPONENTS },
            { type: "uint256" },
            { type: "address" },
          ],
          [paymentInfoTuple, amount, tokenCollector],
        )
      : encodeAbiParameters(
          [
            { type: "tuple", components: PAYMENT_INFO_COMPONENTS },
            { type: "uint256" },
            { type: "address" },
            { type: "uint16" },
            { type: "address" },
          ],
          [paymentInfoTuple, amount, tokenCollector, feeBps, feeReceiver],
        );
  return {
    address: override?.address ?? AUTH_CAPTURE_ESCROW_ADDRESS,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    data,
    blockNumber: 0n,
    transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
    transactionIndex: 0,
    blockHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
    logIndex: 1,
    removed: false,
  } as Log;
}

/**
 * Build a viem ContractFunctionExecutionError that wraps a real
 * ContractFunctionRevertedError encoded from the named custom error.
 * Mirrors what viem produces when the chain reverts with a known error
 * declared in the call's ABI.
 */
function buildRevertError(errorName: string): Error {
  const errorAbi = [{ type: "error" as const, name: errorName, inputs: [] }];
  const data = encodeErrorResult({ abi: errorAbi, errorName });
  const inner = new ContractFunctionRevertedError({
    abi: errorAbi,
    data,
    functionName: "authorize",
  });
  return new ContractFunctionExecutionError(inner, {
    abi: errorAbi,
    functionName: "authorize",
    args: [],
  });
}

// Stable stand-in for escrow.getTokenStore(operator) in tests. Real on-chain
// value is CREATE2-derived from the operator; for unit tests we just need a
// stable address the mock signer can return and the trace builder can use.
const TOKEN_STORE = "0x5555555555555555555555555555555555555555" as `0x${string}`;

/**
 * A "honest passthrough" trace for the contract path. Returns a successful
 * simulateCalls response with: escrow event w/ matching hash + Transfer
 * events with deltas that match the signed PaymentInfo.
 *
 * `tokenStore` is the address the operator's `AuthCaptureEscrow.getTokenStore`
 * returns; the new asset-delta check enumerates allowed recipients to include
 * it explicitly.
 */
function buildHonestTrace(
  paymentInfo: PaymentInfoStruct,
  amount: bigint,
  functionName: "authorize" | "charge",
  tokenCollector: `0x${string}`,
  chainId: number,
  options: {
    gasUsed?: bigint;
    feeBps?: number;
    tokenStore?: `0x${string}`;
    actualFeeReceiver?: `0x${string}`;
  } = {},
) {
  const tokenStore = options.tokenStore ?? TOKEN_STORE;
  const actualFeeReceiver = options.actualFeeReceiver ?? paymentInfo.feeReceiver;
  const escrowLog = escrowEventLog(
    paymentInfo,
    amount,
    functionName,
    tokenCollector,
    chainId,
    options.feeBps ?? 0,
    actualFeeReceiver,
  );
  const logs: Log[] =
    functionName === "authorize"
      ? [
          escrowLog,
          transferLog(paymentInfo.token, paymentInfo.payer, tokenCollector, amount),
          transferLog(paymentInfo.token, tokenCollector, tokenStore, amount),
        ]
      : (() => {
          const fee = (amount * BigInt(options.feeBps ?? 0)) / 10000n;
          const net = amount - fee;
          return [
            escrowLog,
            transferLog(paymentInfo.token, paymentInfo.payer, tokenCollector, amount),
            transferLog(paymentInfo.token, tokenCollector, tokenStore, amount),
            transferLog(paymentInfo.token, tokenStore, paymentInfo.receiver, net),
            ...(fee > 0n
              ? [transferLog(paymentInfo.token, tokenStore, actualFeeReceiver, fee)]
              : []),
          ];
        })();
  return {
    results: [
      {
        status: "success",
        gasUsed: options.gasUsed ?? 220_000n,
        logs,
      },
    ],
  };
}

describe("AuthCaptureEvmScheme", () => {
  const CHAIN_ID = 84532;
  // Default readContract dispatch: getTokenStore returns the stand-in
  // TokenStore address; everything else (balanceOf, etc.) returns a large
  // bigint balance. Tests can still chain .mockResolvedValueOnce(...) /
  // .mockRejectedValueOnce(...) for specific call sequences (e.g. typed
  // simulation reverts).
  const createMockSigner = () => ({
    getAddresses: () => ["0x1234567890123456789012345678901234567890"] as readonly `0x${string}`[],
    readContract: vi.fn(async (args: { functionName: string }) => {
      if (args.functionName === "getTokenStore") return TOKEN_STORE;
      return BigInt("1000000000");
    }),
    writeContract: vi.fn().mockResolvedValue("0xabcdef1234567890" as `0x${string}`),
    verifyTypedData: vi.fn().mockResolvedValue(true),
    sendTransaction: vi.fn(),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    getCode: vi.fn().mockResolvedValue("0x"),
    simulateCalls: vi.fn(),
  });

  let mockSigner: ReturnType<typeof createMockSigner>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSigner = createMockSigner();
  });

  const futureSeconds = Math.floor(Date.now() / 1000) + 3600;
  const captureDeadline = futureSeconds + 86400;
  const refundDeadline = captureDeadline + 86400;

  const PAYER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
  const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`;
  const PAY_TO = "0xdddddddddddddddddddddddddddddddddddddddd" as `0x${string}`;
  const CAPTURE_AUTHORIZER = "0xcccccccccccccccccccccccccccccccccccccccc" as `0x${string}`;
  const FEE_RECIPIENT = "0x4444444444444444444444444444444444444444" as `0x${string}`;
  const SALT =
    "0x0000000000000000000000000000000000000000000000000000000000000abc" as `0x${string}`;

  const mockRequirements = {
    scheme: "auth-capture",
    network: "eip155:84532",
    amount: "1000000",
    asset: ASSET,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: {
      captureAuthorizer: CAPTURE_AUTHORIZER,
      captureDeadline,
      refundDeadline,
      feeRecipient: FEE_RECIPIENT,
      minFeeBps: 0,
      maxFeeBps: 100,
      name: "USDC",
      version: "2",
    },
  };

  // Build a PaymentInfoStruct that matches what the facilitator will reconstruct.
  function buildPaymentInfo(): PaymentInfoStruct {
    return {
      operator: CAPTURE_AUTHORIZER,
      payer: PAYER,
      receiver: PAY_TO,
      token: ASSET,
      maxAmount: "1000000",
      preApprovalExpiry: futureSeconds,
      authorizationExpiry: captureDeadline,
      refundExpiry: refundDeadline,
      minFeeBps: 0,
      maxFeeBps: 100,
      feeReceiver: FEE_RECIPIENT,
      salt: SALT,
    };
  }

  function buildEip3009Payload() {
    return buildEip3009PayloadFor(buildPaymentInfo(), mockRequirements);
  }

  function buildEip3009PayloadFor(paymentInfo: PaymentInfoStruct, reqs: typeof mockRequirements) {
    const nonce = computePayerAgnosticPaymentInfoHash(84532, paymentInfo);
    return {
      x402Version: 2,
      scheme: "auth-capture",
      resource: { url: "https://example.com/weather", method: "GET" },
      accepted: { ...reqs },
      payload: {
        authorization: {
          from: PAYER,
          to: EIP3009_TOKEN_COLLECTOR_ADDRESS,
          value: "1000000",
          validAfter: "0",
          validBefore: String(futureSeconds),
          nonce,
        },
        signature: "0xabcd" as `0x${string}`,
        salt: SALT,
      },
    };
  }

  function buildPermit2Payload() {
    const paymentInfo = buildPaymentInfo();
    const nonce = computePayerAgnosticPaymentInfoHash(84532, paymentInfo);
    return {
      x402Version: 2,
      scheme: "auth-capture",
      resource: { url: "https://example.com/weather", method: "GET" },
      accepted: { ...mockRequirements },
      payload: {
        permit2Authorization: {
          from: PAYER,
          permitted: { token: ASSET, amount: "1000000" },
          spender: PERMIT2_TOKEN_COLLECTOR_ADDRESS,
          nonce: hexToBigInt(nonce).toString(),
          deadline: String(futureSeconds),
        },
        signature: "0xabcd" as `0x${string}`,
        salt: SALT,
      },
    };
  }

  describe("settle — autoCapture routing", () => {
    it("should default to authorize when autoCapture is absent", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      await scheme.settle(buildEip3009Payload(), mockRequirements);

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "authorize" }),
      );
    });

    it("should call charge when autoCapture is true", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, autoCapture: true },
      };
      await scheme.settle(buildEip3009Payload(), reqs);

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "charge" }),
      );
    });

    it("should call authorize when autoCapture is false", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, autoCapture: false },
      };
      await scheme.settle(buildEip3009Payload(), reqs);

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "authorize" }),
      );
    });
  });

  describe("settle — target address", () => {
    it("should target the canonical AuthCaptureEscrow address when captureAuthorizer is an EOA", async () => {
      mockSigner.getCode.mockResolvedValue("0x");
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      await scheme.settle(buildEip3009Payload(), mockRequirements);

      expect(mockSigner.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ address: AUTH_CAPTURE_ESCROW_ADDRESS }),
      );
    });

    it("should route authorize × eip3009 × contract via the captureAuthorizer with the literal escrow ABI and 4 args", async () => {
      mockSigner.getCode.mockResolvedValue("0x6080604052");
      mockSigner.simulateCalls.mockResolvedValue(
        buildHonestTrace(
          buildPaymentInfo(),
          1_000_000n,
          "authorize",
          EIP3009_TOKEN_COLLECTOR_ADDRESS,
          CHAIN_ID,
        ),
      );
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      await scheme.settle(buildEip3009Payload(), mockRequirements);

      const call = mockSigner.writeContract.mock.calls[0][0];
      expect(call.address).toBe(CAPTURE_AUTHORIZER);
      expect(call.functionName).toBe("authorize");
      expect(call.abi).toBe(ESCROW_ABI);
      expect(call.args).toHaveLength(4);
      expect(call.args[2]).toBe(EIP3009_TOKEN_COLLECTOR_ADDRESS);
    });

    it("should route charge × eip3009 × contract via the captureAuthorizer with the 6-arg ABI", async () => {
      mockSigner.getCode.mockResolvedValue("0x6080604052");
      mockSigner.simulateCalls.mockResolvedValue(
        buildHonestTrace(
          buildPaymentInfo(),
          1_000_000n,
          "charge",
          EIP3009_TOKEN_COLLECTOR_ADDRESS,
          CHAIN_ID,
        ),
      );
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, autoCapture: true },
      };
      await scheme.settle(buildEip3009Payload(), reqs);

      const call = mockSigner.writeContract.mock.calls[0][0];
      expect(call.address).toBe(CAPTURE_AUTHORIZER);
      expect(call.functionName).toBe("charge");
      expect(call.abi).toBe(ESCROW_ABI);
      expect(call.args).toHaveLength(6);
      expect(call.args[2]).toBe(EIP3009_TOKEN_COLLECTOR_ADDRESS);
      // 6-arg charge tail: [..., feeBps, feeReceiver] — exact values mirror
      // the EOA-path 'charge fee args' test so the contract path is
      // independently complete, not just transitive on shared args-build code.
      expect(call.args[4]).toBe(0);
      expect(call.args[5]).toBe(FEE_RECIPIENT);
    });

    it("should route authorize × permit2 × contract via the captureAuthorizer with the permit2 collector", async () => {
      mockSigner.getCode.mockResolvedValue("0x6080604052");
      mockSigner.simulateCalls.mockResolvedValue(
        buildHonestTrace(
          buildPaymentInfo(),
          1_000_000n,
          "authorize",
          PERMIT2_TOKEN_COLLECTOR_ADDRESS,
          CHAIN_ID,
        ),
      );
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, assetTransferMethod: "permit2" as const },
      };
      await scheme.settle(buildPermit2Payload(), reqs);

      const call = mockSigner.writeContract.mock.calls[0][0];
      expect(call.address).toBe(CAPTURE_AUTHORIZER);
      expect(call.functionName).toBe("authorize");
      expect(call.abi).toBe(ESCROW_ABI);
      expect(call.args).toHaveLength(4);
      expect(call.args[2]).toBe(PERMIT2_TOKEN_COLLECTOR_ADDRESS);
    });

    it("should route charge × permit2 × contract via the captureAuthorizer with 6 args + permit2 collector", async () => {
      mockSigner.getCode.mockResolvedValue("0x6080604052");
      mockSigner.simulateCalls.mockResolvedValue(
        buildHonestTrace(
          buildPaymentInfo(),
          1_000_000n,
          "charge",
          PERMIT2_TOKEN_COLLECTOR_ADDRESS,
          CHAIN_ID,
        ),
      );
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          assetTransferMethod: "permit2" as const,
          autoCapture: true,
        },
      };
      await scheme.settle(buildPermit2Payload(), reqs);

      const call = mockSigner.writeContract.mock.calls[0][0];
      expect(call.address).toBe(CAPTURE_AUTHORIZER);
      expect(call.functionName).toBe("charge");
      expect(call.abi).toBe(ESCROW_ABI);
      expect(call.args).toHaveLength(6);
      expect(call.args[2]).toBe(PERMIT2_TOKEN_COLLECTOR_ADDRESS);
    });

    it("should route contract-path simulation through simulateCalls targeting the captureAuthorizer with the gas cap applied", async () => {
      mockSigner.getCode.mockResolvedValue("0x6080604052");
      mockSigner.simulateCalls.mockResolvedValue(
        buildHonestTrace(
          buildPaymentInfo(),
          1_000_000n,
          "authorize",
          EIP3009_TOKEN_COLLECTOR_ADDRESS,
          CHAIN_ID,
        ),
      );
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      await scheme.verify(buildEip3009Payload(), mockRequirements);

      expect(mockSigner.simulateCalls).toHaveBeenCalledTimes(1);
      const call = mockSigner.simulateCalls.mock.calls[0][0];
      expect(call.calls).toHaveLength(1);
      expect(call.calls[0].to).toBe(CAPTURE_AUTHORIZER);
      expect(call.calls[0].gas).toBe(CAPTURE_AUTHORIZER_GAS_LIMIT);
      expect(call.traceTransfers).toBe(true);
    });

    it("should pass EIP3009_TOKEN_COLLECTOR as the tokenCollector arg for eip3009", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      await scheme.settle(buildEip3009Payload(), mockRequirements);

      const call = mockSigner.writeContract.mock.calls[0][0];
      expect(call.args[2]).toBe(EIP3009_TOKEN_COLLECTOR_ADDRESS);
    });

    it("should pass PERMIT2_TOKEN_COLLECTOR as the tokenCollector arg for permit2", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, assetTransferMethod: "permit2" as const },
      };
      await scheme.settle(buildPermit2Payload(), reqs);

      const call = mockSigner.writeContract.mock.calls[0][0];
      expect(call.args[2]).toBe(PERMIT2_TOKEN_COLLECTOR_ADDRESS);
    });
  });

  describe("verify — invariants", () => {
    it("should reject when extra is missing required fields", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const bad = {
        ...mockRequirements,
        extra: { name: "USDC", version: "2" } as unknown as typeof mockRequirements.extra,
      };
      const result = await scheme.verify(buildEip3009Payload(), bad);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_auth_capture_extra");
    });

    it("should reject when refundDeadline is not after captureDeadline", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const bad = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, refundDeadline: captureDeadline - 1 },
      };
      const result = await scheme.verify(buildEip3009Payload(), bad);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_deadline_ordering");
    });

    it("should reject when payload method does not match assetTransferMethod", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, assetTransferMethod: "permit2" as const },
      };
      const result = await scheme.verify(buildEip3009Payload(), reqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("payload_method_mismatch");
    });

    it("should reject when EIP-3009 payload.to is not the canonical collector", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const payload = buildEip3009Payload();
      payload.payload.authorization.to =
        "0x9999999999999999999999999999999999999999" as `0x${string}`;
      const result = await scheme.verify(payload, mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("token_collector_mismatch");
    });

    it("should reject when Permit2 payload.spender is not the canonical collector", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, assetTransferMethod: "permit2" as const },
      };
      const payload = buildPermit2Payload();
      payload.payload.permit2Authorization.spender =
        "0x9999999999999999999999999999999999999999" as `0x${string}`;
      const result = await scheme.verify(payload, reqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("token_collector_mismatch");
    });

    it("should reject when Permit2 token does not match requirements.asset", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, assetTransferMethod: "permit2" as const },
      };
      const payload = buildPermit2Payload();
      payload.payload.permit2Authorization.permitted.token =
        "0x9999999999999999999999999999999999999999" as `0x${string}`;
      const result = await scheme.verify(payload, reqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("token_mismatch");
    });

    it("should reject when authorization.value does not match requirements.amount", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const payload = buildEip3009Payload();
      payload.payload.authorization.value = "999999";
      const result = await scheme.verify(payload, mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("amount_mismatch");
    });

    it("should reject when EIP-3009 validBefore is in the past", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const payload = buildEip3009Payload();
      payload.payload.authorization.validBefore = String(Math.floor(Date.now() / 1000) - 60);
      const result = await scheme.verify(payload, mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("authorization_expired");
    });

    it("should reject when EIP-3009 validAfter is in the future", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const payload = buildEip3009Payload();
      payload.payload.authorization.validAfter = String(Math.floor(Date.now() / 1000) + 3600);
      const result = await scheme.verify(payload, mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("authorization_not_yet_valid");
    });

    it("should reject unsupported assetTransferMethod", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          assetTransferMethod: "allowance" as unknown as "eip3009",
        },
      };
      const result = await scheme.verify(buildEip3009Payload(), reqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("unsupported_asset_transfer_method");
    });

    it("should reject when payload.accepted.network differs from requirements.network", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const payload = buildEip3009Payload();
      payload.accepted = { ...payload.accepted, network: "eip155:8453" };
      const result = await scheme.verify(payload, mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("network_mismatch");
    });

    it("should reject invalid signature", async () => {
      mockSigner.verifyTypedData.mockResolvedValueOnce(false);
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_auth_capture_signature");
    });

    it("should reject when simulation reverts and balance is sufficient", async () => {
      mockSigner.readContract.mockReset();
      // First call: simulateSettle (escrow.authorize) → revert
      // Second call: balanceOf for the actionable-error fallback → sufficient
      mockSigner.readContract
        .mockRejectedValueOnce(new Error("execution reverted"))
        .mockResolvedValueOnce(BigInt("1000000000"));
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("simulation_failed");
    });

    it("should surface insufficient_balance when simulation fails and balance is short", async () => {
      mockSigner.readContract.mockReset();
      mockSigner.readContract
        .mockRejectedValueOnce(new Error("execution reverted"))
        .mockResolvedValueOnce(BigInt("1")); // balance < amount
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("insufficient_balance");
    });

    it("should reject when preApprovalExpiry exceeds captureDeadline", async () => {
      // maxTimeoutSeconds = 60s, but captureDeadline only 5s in the future →
      // preApprovalExpiry (now + 60) > captureDeadline. Mirrors the on-chain
      // _validatePayment ordering check.
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const tightCaptureDeadline = Math.floor(Date.now() / 1000) + 30;
      const reqs = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          captureDeadline: tightCaptureDeadline,
          refundDeadline: tightCaptureDeadline + 86400,
        },
      };
      // Build payload with a fresh preApprovalExpiry that exceeds captureDeadline
      const futureSecondsLocal = Math.floor(Date.now() / 1000) + 3600;
      const paymentInfo: PaymentInfoStruct = {
        operator: CAPTURE_AUTHORIZER,
        payer: PAYER,
        receiver: PAY_TO,
        token: ASSET,
        maxAmount: "1000000",
        preApprovalExpiry: futureSecondsLocal,
        authorizationExpiry: tightCaptureDeadline,
        refundExpiry: tightCaptureDeadline + 86400,
        minFeeBps: 0,
        maxFeeBps: 100,
        feeReceiver: FEE_RECIPIENT,
        salt: SALT,
      };
      const nonce = computePayerAgnosticPaymentInfoHash(84532, paymentInfo);
      const payload = {
        x402Version: 2,
        scheme: "auth-capture",
        resource: { url: "https://example.com", method: "GET" },
        accepted: { ...reqs },
        payload: {
          authorization: {
            from: PAYER,
            to: EIP3009_TOKEN_COLLECTOR_ADDRESS,
            value: "1000000",
            validAfter: "0",
            validBefore: String(futureSecondsLocal),
            nonce,
          },
          signature: "0xabcd" as `0x${string}`,
          salt: SALT,
        },
      };
      const result = await scheme.verify(payload, reqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_deadline_ordering");
    });
  });

  describe("verify — nonce binding (regression for payer-agnostic-hash design)", () => {
    it("should reject when salt is mutated after signing", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const payload = buildEip3009Payload();
      // Tamper with salt — wire nonce was computed against SALT, not this new value
      payload.payload.salt =
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as `0x${string}`;
      const result = await scheme.verify(payload, mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("nonce_mismatch");
    });

    it("should reject when extra.captureAuthorizer is mutated after signing", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const tampered = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          captureAuthorizer: "0x9999999999999999999999999999999999999999" as `0x${string}`,
        },
      };
      const result = await scheme.verify(buildEip3009Payload(), tampered);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("nonce_mismatch");
    });

    it("should reject when requirements.amount is mutated after signing (Permit2)", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        amount: "999999",
        extra: { ...mockRequirements.extra, assetTransferMethod: "permit2" as const },
      };
      // amount_mismatch fires before nonce_mismatch — that's the expected order.
      // Either way, the tampering is rejected.
      const result = await scheme.verify(buildPermit2Payload(), reqs);
      expect(result.isValid).toBe(false);
      expect(["amount_mismatch", "nonce_mismatch"]).toContain(result.invalidReason);
    });
  });

  describe("verify — typed simulation revert decoding", () => {
    it("should decode AfterPreApprovalExpiry → authorization_expired", async () => {
      mockSigner.readContract.mockReset();
      mockSigner.readContract
        .mockRejectedValueOnce(buildRevertError("AfterPreApprovalExpiry"))
        .mockResolvedValueOnce(BigInt("1000000000")); // balanceOf — sufficient
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("authorization_expired");
    });

    it("should decode PaymentAlreadyCollected → payment_already_collected", async () => {
      mockSigner.readContract.mockReset();
      mockSigner.readContract
        .mockRejectedValueOnce(buildRevertError("PaymentAlreadyCollected"))
        .mockResolvedValueOnce(BigInt("1000000000"));
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("payment_already_collected");
    });

    it("should decode FeeBpsOutOfRange → fee_bps_out_of_range", async () => {
      mockSigner.readContract.mockReset();
      mockSigner.readContract
        .mockRejectedValueOnce(buildRevertError("FeeBpsOutOfRange"))
        .mockResolvedValueOnce(BigInt("1000000000"));
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("fee_bps_out_of_range");
    });

    it("should decode InvalidFeeReceiver → invalid_fee_receiver", async () => {
      mockSigner.readContract.mockReset();
      mockSigner.readContract
        .mockRejectedValueOnce(buildRevertError("InvalidFeeReceiver"))
        .mockResolvedValueOnce(BigInt("1000000000"));
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_fee_receiver");
    });

    it("should decode TokenCollectionFailed → token_collection_failed", async () => {
      mockSigner.readContract.mockReset();
      mockSigner.readContract
        .mockRejectedValueOnce(buildRevertError("TokenCollectionFailed"))
        .mockResolvedValueOnce(BigInt("1000000000"));
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("token_collection_failed");
    });

    it("should fall through unknown reverts to generic simulation_failed", async () => {
      mockSigner.readContract.mockReset();
      mockSigner.readContract
        .mockRejectedValueOnce(buildRevertError("SomeUnmappedError"))
        .mockResolvedValueOnce(BigInt("1000000000"));
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("simulation_failed");
    });

    it("should fall through plain Error (not BaseError) to simulation_failed", async () => {
      mockSigner.readContract.mockReset();
      mockSigner.readContract
        .mockRejectedValueOnce(new Error("RPC went sideways"))
        .mockResolvedValueOnce(BigInt("1000000000"));
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("simulation_failed");
    });
  });

  describe("settle — charge fee args (ABI 6-arg correctness)", () => {
    it("should pass feeBps and feeReceiver as args[4] and args[5] for charge", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, autoCapture: true },
      };
      await scheme.settle(buildEip3009Payload(), reqs);

      const call = mockSigner.writeContract.mock.calls[0][0];
      expect(call.functionName).toBe("charge");
      expect(call.args.length).toBe(6);
      // Default minFeeBps is 0 when extra.minFeeBps is omitted (matches buildPaymentInfo).
      expect(call.args[4]).toBe(0);
      expect(call.args[5]).toBe(FEE_RECIPIENT);
    });

    it("should pass 4 args for authorize (no feeBps/feeReceiver)", async () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      await scheme.settle(buildEip3009Payload(), mockRequirements);
      const call = mockSigner.writeContract.mock.calls[0][0];
      expect(call.functionName).toBe("authorize");
      expect(call.args.length).toBe(4);
    });
  });

  describe("getExtra", () => {
    it("should return undefined — escrow + tokenCollector are constants, not advertised", () => {
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      expect(scheme.getExtra("eip155:8453")).toBeUndefined();
    });
  });

  describe("verify — contract-path captureAuthorizer hardening", () => {
    beforeEach(() => {
      // Default: contract path
      mockSigner.getCode.mockResolvedValue("0x6080604052");
    });

    it("should fail with capture_authorizer_gas_exceeded when simulated gasUsed exceeds the cap", async () => {
      const trace = buildHonestTrace(
        buildPaymentInfo(),
        1_000_000n,
        "authorize",
        EIP3009_TOKEN_COLLECTOR_ADDRESS,
        CHAIN_ID,
        { gasUsed: CAPTURE_AUTHORIZER_GAS_LIMIT + 1_000_000n },
      );
      mockSigner.simulateCalls.mockResolvedValue(trace);
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("capture_authorizer_gas_exceeded");
    });

    // Some RPCs surface an inner revert as `status: "failure"` on the trace
    // result instead of throwing. The `status !== "success"` branch must decode
    // the attached `error` to the same stable invalidReason as the throw path.
    it("should decode a status:failure trace result with an error to a stable invalidReason", async () => {
      mockSigner.simulateCalls.mockResolvedValue({
        results: [
          {
            status: "failure",
            error: buildRevertError("AfterPreApprovalExpiry"),
          },
        ],
      });
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("authorization_expired");
    });

    it("should fall back to simulation_failed on a status:failure trace result with no error", async () => {
      mockSigner.simulateCalls.mockResolvedValue({
        results: [{ status: "failure" }],
      });
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("simulation_failed");
    });

    it("should fail with capture_authorizer_escrow_call_missing when no escrow event was emitted", async () => {
      mockSigner.simulateCalls.mockResolvedValue({
        results: [
          {
            status: "success",
            gasUsed: 100_000n,
            logs: [
              // Only Transfer logs — the authorizer pulled funds but never reached escrow.
              transferLog(ASSET, PAYER, CAPTURE_AUTHORIZER, 1_000_000n),
            ],
          },
        ],
      });
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("capture_authorizer_escrow_call_missing");
    });

    it("should fail with capture_authorizer_payment_info_mismatch when the escrow event hash differs from the signed PaymentInfo", async () => {
      const wrongHash =
        "0x1111111111111111111111111111111111111111111111111111111111111111" as `0x${string}`;
      mockSigner.simulateCalls.mockResolvedValue({
        results: [
          {
            status: "success",
            gasUsed: 200_000n,
            logs: [
              escrowEventLog(
                buildPaymentInfo(),
                1_000_000n,
                "authorize",
                EIP3009_TOKEN_COLLECTOR_ADDRESS,
                CHAIN_ID,
                0,
                FEE_RECIPIENT,
                { paymentInfoHash: wrongHash },
              ),
              transferLog(ASSET, PAYER, EIP3009_TOKEN_COLLECTOR_ADDRESS, 1_000_000n),
              transferLog(
                ASSET,
                EIP3009_TOKEN_COLLECTOR_ADDRESS,
                "0x5555555555555555555555555555555555555555",
                1_000_000n,
              ),
            ],
          },
        ],
      });
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("capture_authorizer_payment_info_mismatch");
    });

    it("should fail with capture_authorizer_asset_divergence when an unrelated address receives the asset on charge", async () => {
      const attacker = "0xbadbadbadbadbadbadbadbadbadbadbadbadbadb" as `0x${string}`;
      const escrowLog = escrowEventLog(
        buildPaymentInfo(),
        1_000_000n,
        "charge",
        EIP3009_TOKEN_COLLECTOR_ADDRESS,
        CHAIN_ID,
      );
      mockSigner.simulateCalls.mockResolvedValue({
        results: [
          {
            status: "success",
            gasUsed: 200_000n,
            logs: [
              escrowLog,
              // Payer pays full amount, but only part goes to receiver — attacker skims.
              transferLog(ASSET, PAYER, EIP3009_TOKEN_COLLECTOR_ADDRESS, 1_000_000n),
              transferLog(ASSET, EIP3009_TOKEN_COLLECTOR_ADDRESS, PAY_TO, 900_000n),
              transferLog(ASSET, EIP3009_TOKEN_COLLECTOR_ADDRESS, attacker, 100_000n),
            ],
          },
        ],
      });
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, autoCapture: true },
      };
      const result = await scheme.verify(buildEip3009Payload(), reqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("capture_authorizer_asset_divergence");
    });

    it("should fail with capture_authorizer_asset_divergence when the implied feeBps falls outside [minFeeBps, maxFeeBps]", async () => {
      // Reqs declare maxFeeBps=100 (1%). Stage a charge that takes 500 bps (5%).
      mockSigner.simulateCalls.mockResolvedValue({
        results: [
          {
            status: "success",
            gasUsed: 200_000n,
            logs: [
              escrowEventLog(
                buildPaymentInfo(),
                1_000_000n,
                "charge",
                EIP3009_TOKEN_COLLECTOR_ADDRESS,
                CHAIN_ID,
              ),
              transferLog(ASSET, PAYER, EIP3009_TOKEN_COLLECTOR_ADDRESS, 1_000_000n),
              transferLog(ASSET, EIP3009_TOKEN_COLLECTOR_ADDRESS, PAY_TO, 950_000n),
              transferLog(ASSET, EIP3009_TOKEN_COLLECTOR_ADDRESS, FEE_RECIPIENT, 50_000n),
            ],
          },
        ],
      });
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const reqs = {
        ...mockRequirements,
        extra: { ...mockRequirements.extra, autoCapture: true },
      };
      const result = await scheme.verify(buildEip3009Payload(), reqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("capture_authorizer_asset_divergence");
    });

    it("should accept an honest passthrough", async () => {
      mockSigner.simulateCalls.mockResolvedValue(
        buildHonestTrace(
          buildPaymentInfo(),
          1_000_000n,
          "authorize",
          EIP3009_TOKEN_COLLECTOR_ADDRESS,
          CHAIN_ID,
        ),
      );
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(true);
    });

    it("should fall back to simulation_failed when the signer does not expose simulateCalls", async () => {
      const signerWithoutSimulate = {
        getAddresses: mockSigner.getAddresses,
        readContract: mockSigner.readContract,
        writeContract: mockSigner.writeContract,
        verifyTypedData: mockSigner.verifyTypedData,
        sendTransaction: mockSigner.sendTransaction,
        waitForTransactionReceipt: mockSigner.waitForTransactionReceipt,
        getCode: mockSigner.getCode,
      };
      const scheme = new AuthCaptureEvmScheme(
        signerWithoutSimulate as unknown as typeof mockSigner,
      );
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("simulation_failed");
    });

    // Bug 1 (review): paymentInfo.feeReceiver == address(0) is a spec-valid
    // configuration (delegates fee-recipient choice to the captureAuthorizer
    // at charge time). The asset-delta check must use the actual feeReceiver
    // from the PaymentCharged event, not the zeroed value from PaymentInfo.
    it("should accept a charge where paymentInfo.feeReceiver == 0 and event specifies a non-zero feeReceiver", async () => {
      const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;
      const actualFeeReceiver = "0xfee0fee0fee0fee0fee0fee0fee0fee0fee0fee0" as `0x${string}`;
      const reqs = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          feeRecipient: ZERO,
          autoCapture: true,
          minFeeBps: 0,
          maxFeeBps: 100,
        },
      };
      const paymentInfoZeroFee = { ...buildPaymentInfo(), feeReceiver: ZERO };
      const payload = buildEip3009PayloadFor(paymentInfoZeroFee, reqs);
      mockSigner.simulateCalls.mockResolvedValue(
        buildHonestTrace(
          paymentInfoZeroFee,
          1_000_000n,
          "charge",
          EIP3009_TOKEN_COLLECTOR_ADDRESS,
          CHAIN_ID,
          { feeBps: 50, actualFeeReceiver },
        ),
      );
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(payload, reqs);
      expect(result.isValid).toBe(true);
    });

    // Bug 3 (review): receiver == feeReceiver should not double-count the
    // delta. Honest case where the same address gets both legs of the split
    // must pass.
    it("should accept a charge where receiver == feeReceiver (combined delta == amount)", async () => {
      const reqs = {
        ...mockRequirements,
        extra: {
          ...mockRequirements.extra,
          feeRecipient: PAY_TO, // receiver IS feeReceiver
          autoCapture: true,
          minFeeBps: 0,
          maxFeeBps: 100,
        },
      };
      const paymentInfoMerged = { ...buildPaymentInfo(), feeReceiver: PAY_TO };
      const payload = buildEip3009PayloadFor(paymentInfoMerged, reqs);
      mockSigner.simulateCalls.mockResolvedValue(
        buildHonestTrace(
          paymentInfoMerged,
          1_000_000n,
          "charge",
          EIP3009_TOKEN_COLLECTOR_ADDRESS,
          CHAIN_ID,
          { feeBps: 50, actualFeeReceiver: PAY_TO },
        ),
      );
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(payload, reqs);
      expect(result.isValid).toBe(true);
    });

    // Bug 2 (review): authorize-path siphon. The old "sum-other-deltas ==
    // amount" check passed tautologically from mass conservation. The new
    // allowed-recipient enumeration must reject a trace where escrow's
    // tokenStore is bypassed and funds go to an attacker.
    it("should fail with capture_authorizer_asset_divergence when the authorize trace routes funds to an unexpected address instead of the tokenStore", async () => {
      const attacker = "0xbadbadbadbadbadbadbadbadbadbadbadbadbadb" as `0x${string}`;
      const paymentInfo = buildPaymentInfo();
      // Honest event but funds are redirected to attacker instead of tokenStore.
      const escrowLog = escrowEventLog(
        paymentInfo,
        1_000_000n,
        "authorize",
        EIP3009_TOKEN_COLLECTOR_ADDRESS,
        CHAIN_ID,
      );
      mockSigner.simulateCalls.mockResolvedValue({
        results: [
          {
            status: "success",
            gasUsed: 200_000n,
            logs: [
              escrowLog,
              transferLog(ASSET, PAYER, EIP3009_TOKEN_COLLECTOR_ADDRESS, 1_000_000n),
              transferLog(ASSET, EIP3009_TOKEN_COLLECTOR_ADDRESS, attacker, 1_000_000n),
            ],
          },
        ],
      });
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("capture_authorizer_asset_divergence");
    });

    it("should fail with simulation_failed if the escrow getTokenStore read throws", async () => {
      mockSigner.readContract.mockImplementation(async (args: { functionName: string }) => {
        if (args.functionName === "getTokenStore") throw new Error("rpc unavailable");
        return BigInt("1000000000");
      });
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      const result = await scheme.verify(buildEip3009Payload(), mockRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("simulation_failed");
    });
  });

  describe("settle — gas cap on contract path", () => {
    it("should pass the gas cap to writeContract when settling against a smart contract captureAuthorizer", async () => {
      mockSigner.getCode.mockResolvedValue("0x6080604052");
      mockSigner.simulateCalls.mockResolvedValue(
        buildHonestTrace(
          buildPaymentInfo(),
          1_000_000n,
          "authorize",
          EIP3009_TOKEN_COLLECTOR_ADDRESS,
          CHAIN_ID,
        ),
      );
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      await scheme.settle(buildEip3009Payload(), mockRequirements);
      const call = mockSigner.writeContract.mock.calls[0][0];
      expect(call.gas).toBe(CAPTURE_AUTHORIZER_GAS_LIMIT);
    });

    it("should NOT set a gas field on writeContract on the EOA path", async () => {
      mockSigner.getCode.mockResolvedValue("0x");
      const scheme = new AuthCaptureEvmScheme(mockSigner);
      await scheme.settle(buildEip3009Payload(), mockRequirements);
      const call = mockSigner.writeContract.mock.calls[0][0];
      expect(call.gas).toBeUndefined();
    });
  });
});
