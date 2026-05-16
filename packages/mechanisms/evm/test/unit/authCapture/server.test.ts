import { describe, it, expect } from "vitest";
import { AuthCaptureEvmScheme } from "../../../src/authCapture/server/index";

const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

describe("AuthCaptureEvmScheme", () => {
  describe("parsePrice", () => {
    it("should parse dollar amounts with default decimals (6 for USDC)", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const result = await scheme.parsePrice("$1.00", "eip155:84532");

      expect(result.amount).toBe("1000000");
      expect(result.asset).toBe(BASE_SEPOLIA_USDC);
      expect(result.extra).toEqual({ name: "USDC", version: "2" });
    });

    it("should parse amounts without dollar sign", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const result = await scheme.parsePrice("0.50", "eip155:84532");

      expect(result.amount).toBe("500000");
      expect(result.extra).toEqual({ name: "USDC", version: "2" });
    });

    it("should parse small amounts correctly", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const result = await scheme.parsePrice("$0.01", "eip155:84532");

      expect(result.amount).toBe("10000");
    });

    it("should parse large amounts correctly", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const result = await scheme.parsePrice("$1000.00", "eip155:84532");

      expect(result.amount).toBe("1000000000");
    });

    it("should handle amounts with commas", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const result = await scheme.parsePrice("$1,000.50", "eip155:84532");

      expect(result.amount).toBe("1000500000");
    });

    it("should handle zero amounts", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const result = await scheme.parsePrice("$0.00", "eip155:84532");

      expect(result.amount).toBe("0");
    });

    it("should accept numeric price", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const result = await scheme.parsePrice(0.01, "eip155:84532");

      expect(result.amount).toBe("10000");
      expect(result.asset).toBe(BASE_SEPOLIA_USDC);
      expect(result.extra).toEqual({ name: "USDC", version: "2" });
    });

    it("should return extra with name and version for Base mainnet", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const result = await scheme.parsePrice("$1.00", "eip155:8453");

      expect(result.extra).toEqual({ name: "USD Coin", version: "2" });
    });

    it("should pass through AssetAmount objects with extra", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const result = await scheme.parsePrice(
        { asset: "0xCustomToken", amount: "42000", extra: { name: "Custom", version: "1" } },
        "eip155:84532",
      );

      expect(result.amount).toBe("42000");
      expect(result.asset).toBe("0xCustomToken");
      expect(result.extra).toEqual({ name: "Custom", version: "1" });
    });

    it("should pass through AssetAmount objects without extra", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const result = await scheme.parsePrice(
        { asset: "0xCustomToken", amount: "42000" },
        "eip155:84532",
      );

      expect(result.amount).toBe("42000");
      expect(result.asset).toBe("0xCustomToken");
      expect(result.extra).toEqual({});
    });

    it("should throw when AssetAmount has no asset", async () => {
      const scheme = new AuthCaptureEvmScheme();
      await expect(
        scheme.parsePrice({ asset: "", amount: "42000" }, "eip155:84532"),
      ).rejects.toThrow("Asset address must be specified");
    });

    it("should throw for unsupported network", async () => {
      const scheme = new AuthCaptureEvmScheme();
      await expect(scheme.parsePrice("$1.00", "eip155:99999")).rejects.toThrow(
        "No default asset configured for network",
      );
    });

    it("should propagate assetTransferMethod from default-asset table for permit2 chains", async () => {
      // Mezo testnet defaults to mUSD which uses permit2 and supports EIP-2612,
      // so name/version remain (for the EIP-2612 sig) and assetTransferMethod is propagated.
      const scheme = new AuthCaptureEvmScheme();
      const result = await scheme.parsePrice("$1.00", "eip155:31611");

      expect(result.asset).toBe("0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503");
      expect(result.extra).toMatchObject({
        assetTransferMethod: "permit2",
        name: "Mezo USD",
        version: "1",
      });
    });
  });

  describe("registerMoneyParser", () => {
    it("should use custom parser when it returns a result", async () => {
      const scheme = new AuthCaptureEvmScheme();
      scheme.registerMoneyParser(async (amount, _network) => ({
        asset: "0xCustomToken",
        amount: String(amount * 1e18),
        extra: { name: "Custom", version: "1" },
      }));

      const result = await scheme.parsePrice("$1.00", "eip155:84532");

      expect(result.asset).toBe("0xCustomToken");
      expect(result.amount).toBe(String(1e18));
      expect(result.extra).toEqual({ name: "Custom", version: "1" });
    });

    it("should fall through to default when custom parser returns null", async () => {
      const scheme = new AuthCaptureEvmScheme();
      scheme.registerMoneyParser(async () => null);

      const result = await scheme.parsePrice("$1.00", "eip155:84532");

      expect(result.asset).toBe(BASE_SEPOLIA_USDC);
      expect(result.amount).toBe("1000000");
      expect(result.extra).toEqual({ name: "USDC", version: "2" });
    });

    it("should try parsers in registration order", async () => {
      const scheme = new AuthCaptureEvmScheme();
      scheme.registerMoneyParser(async () => null);
      scheme.registerMoneyParser(async (amount, _network) => ({
        asset: "0xSecondParser",
        amount: String(amount * 100),
        extra: {},
      }));

      const result = await scheme.parsePrice("$1.00", "eip155:84532");

      expect(result.asset).toBe("0xSecondParser");
      expect(result.amount).toBe("100");
    });
  });

  describe("enhancePaymentRequirements", () => {
    const baseRequirements = {
      scheme: "authCapture",
      network: "eip155:84532" as const,
      amount: "1000000",
      asset: BASE_SEPOLIA_USDC,
      payTo: "0x1234567890123456789012345678901234567890",
      maxTimeoutSeconds: 300,
      extra: {},
    };

    it("should merge extra fields from supportedKind", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
        extra: {
          fromSupported1: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          fromSupported2: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      };

      const result = await scheme.enhancePaymentRequirements(baseRequirements, supportedKind, []);

      expect(result.extra).toEqual({
        fromSupported1: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        fromSupported2: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      });
    });

    it("should preserve existing extra fields from requirements", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const requirements = {
        ...baseRequirements,
        extra: { customField: "custom-value" },
      };
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
        extra: { fromSupported: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      };

      const result = await scheme.enhancePaymentRequirements(requirements, supportedKind, []);

      expect(result.extra).toEqual({
        fromSupported: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        customField: "custom-value",
      });
    });

    it("should let requirements extra override supportedKind extra", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const requirements = {
        ...baseRequirements,
        extra: { sharedKey: "0xcccccccccccccccccccccccccccccccccccccccc" },
      };
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
        extra: { sharedKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      };

      const result = await scheme.enhancePaymentRequirements(requirements, supportedKind, []);

      expect(result.extra?.sharedKey).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
    });

    it("should preserve all original requirement fields", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
      };

      const result = await scheme.enhancePaymentRequirements(baseRequirements, supportedKind, []);

      expect(result.scheme).toBe("authCapture");
      expect(result.network).toBe("eip155:84532");
      expect(result.amount).toBe("1000000");
      expect(result.asset).toBe(BASE_SEPOLIA_USDC);
      expect(result.payTo).toBe("0x1234567890123456789012345678901234567890");
    });

    it("should leave deadlines absent when neither offsets nor absolute values are provided", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
      };

      const result = await scheme.enhancePaymentRequirements(baseRequirements, supportedKind, []);

      expect(result.extra).not.toHaveProperty("captureDeadline");
      expect(result.extra).not.toHaveProperty("refundDeadline");
      expect(result.extra).not.toHaveProperty("captureDeadlineSeconds");
      expect(result.extra).not.toHaveProperty("refundDeadlineSeconds");
    });

    it("should convert captureDeadlineSeconds and refundDeadlineSeconds to absolute deadlines, stripping the offset keys", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const requirements = {
        ...baseRequirements,
        extra: {
          captureDeadlineSeconds: 600,
          refundDeadlineSeconds: 1200,
        },
      };
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
      };

      const before = Math.floor(Date.now() / 1000);
      const result = await scheme.enhancePaymentRequirements(requirements, supportedKind, []);
      const after = Math.floor(Date.now() / 1000);

      const captureDeadline = result.extra?.captureDeadline as number;
      const refundDeadline = result.extra?.refundDeadline as number;

      expect(captureDeadline).toBeGreaterThanOrEqual(before + 600);
      expect(captureDeadline).toBeLessThanOrEqual(after + 600);
      expect(refundDeadline).toBeGreaterThanOrEqual(before + 1200);
      expect(refundDeadline).toBeLessThanOrEqual(after + 1200);

      expect(result.extra).not.toHaveProperty("captureDeadlineSeconds");
      expect(result.extra).not.toHaveProperty("refundDeadlineSeconds");
    });

    it("should let absolute captureDeadline / refundDeadline win over offsets", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const requirements = {
        ...baseRequirements,
        extra: {
          captureDeadlineSeconds: 600,
          refundDeadlineSeconds: 1200,
          captureDeadline: 1700000000,
          refundDeadline: 1800000000,
        },
      };
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
      };

      const result = await scheme.enhancePaymentRequirements(requirements, supportedKind, []);

      expect(result.extra?.captureDeadline).toBe(1700000000);
      expect(result.extra?.refundDeadline).toBe(1800000000);
      expect(result.extra).not.toHaveProperty("captureDeadlineSeconds");
      expect(result.extra).not.toHaveProperty("refundDeadlineSeconds");
    });

    it("should produce distinct deadlines across two calls separated in time", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const requirements = {
        ...baseRequirements,
        extra: {
          captureDeadlineSeconds: 1,
          refundDeadlineSeconds: 2,
        },
      };
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
      };

      const first = await scheme.enhancePaymentRequirements(requirements, supportedKind, []);
      await new Promise(resolve => setTimeout(resolve, 1100));
      const second = await scheme.enhancePaymentRequirements(requirements, supportedKind, []);

      expect(second.extra?.captureDeadline).toBeGreaterThan(first.extra?.captureDeadline as number);
      expect(second.extra?.refundDeadline).toBeGreaterThan(first.extra?.refundDeadline as number);
    });

    it("should throw on non-positive captureDeadlineSeconds", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const requirements = {
        ...baseRequirements,
        extra: { captureDeadlineSeconds: 0 },
      };
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
      };

      await expect(
        scheme.enhancePaymentRequirements(requirements, supportedKind, []),
      ).rejects.toThrow(/captureDeadlineSeconds/);
    });

    it("should throw on non-positive refundDeadlineSeconds", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const requirements = {
        ...baseRequirements,
        extra: { refundDeadlineSeconds: -1 },
      };
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
      };

      await expect(
        scheme.enhancePaymentRequirements(requirements, supportedKind, []),
      ).rejects.toThrow(/refundDeadlineSeconds/);
    });

    it("should throw on non-finite offset", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const requirements = {
        ...baseRequirements,
        extra: { captureDeadlineSeconds: Number.NaN },
      };
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
      };

      await expect(
        scheme.enhancePaymentRequirements(requirements, supportedKind, []),
      ).rejects.toThrow(/captureDeadlineSeconds/);
    });

    it("should throw on non-number offset", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const requirements = {
        ...baseRequirements,
        extra: { captureDeadlineSeconds: "30d" },
      };
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
      };

      await expect(
        scheme.enhancePaymentRequirements(requirements, supportedKind, []),
      ).rejects.toThrow(/captureDeadlineSeconds/);
    });

    it("should accept offsets from supportedKind.extra (facilitator-injected) when not set in requirements", async () => {
      const scheme = new AuthCaptureEvmScheme();
      const supportedKind = {
        x402Version: 2,
        scheme: "authCapture",
        network: "eip155:84532" as const,
        extra: {
          captureDeadlineSeconds: 600,
          refundDeadlineSeconds: 1200,
        },
      };

      const before = Math.floor(Date.now() / 1000);
      const result = await scheme.enhancePaymentRequirements(baseRequirements, supportedKind, []);
      const after = Math.floor(Date.now() / 1000);

      const captureDeadline = result.extra?.captureDeadline as number;
      const refundDeadline = result.extra?.refundDeadline as number;

      expect(captureDeadline).toBeGreaterThanOrEqual(before + 600);
      expect(captureDeadline).toBeLessThanOrEqual(after + 600);
      expect(refundDeadline).toBeGreaterThanOrEqual(before + 1200);
      expect(refundDeadline).toBeLessThanOrEqual(after + 1200);
    });
  });

  describe("scheme property", () => {
    it('should have scheme set to "authCapture"', () => {
      const scheme = new AuthCaptureEvmScheme();
      expect(scheme.scheme).toBe("authCapture");
    });
  });
});
