import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { modelRouter } from "../lib/model-router.js";

describe("modelRouter singleton", () => {
  describe("listProviders", () => {
    it("should return array (possibly empty) of configured providers", () => {
      const providers = modelRouter.listProviders();
      expect(Array.isArray(providers)).toBe(true);
    });
  });

  describe("getModel", () => {
    it("should throw for unconfigured provider", () => {
      const providers = modelRouter.listProviders();
      // Only test providers that aren't configured
      const unconfigured = ["unknown", "nonexistent"].find(
        (p) => !providers.includes(p as any)
      );
      // Arbitrary unknown provider should always throw
      expect(() => modelRouter.getModel("nonexistent-provider/gpt-4o")).toThrow(
        'Provider "nonexistent-provider" not configured'
      );
    });

    it("should throw for unconfigured Anthropic if no Anthropic API key set", () => {
      const providers = modelRouter.listProviders();
      if (!providers.includes("anthropic" as never)) {
        expect(() => modelRouter.getModel("anthropic/claude-opus-4")).toThrow(
          'Provider "anthropic" not configured'
        );
      }
    });

    it("should throw for unconfigured Google if no Google API key set", () => {
      const providers = modelRouter.listProviders();
      if (!providers.includes("google" as never)) {
        expect(() => modelRouter.getModel("google/gemini-2.5-pro-exp-03-25")).toThrow(
          'Provider "google" not configured'
        );
      }
    });
  });

  describe("getModel v5 SDK call path", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.restoreAllMocks();
    });

    it("calls client.languageModel() and returns a LanguageModel (no property access)", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const { modelRouter: fresh } = await import("../lib/model-router.js");
      const providers = fresh.listProviders();
      if (!providers.includes("anthropic" as never)) {
        return;
      }
      const spy = vi.fn().mockReturnValue({
        modelId: "claude-3-5-sonnet-20241022",
        provider: "anthropic.messages",
        specificationVersion: "v1",
      });
      const factory = vi.fn().mockReturnValue({ languageModel: spy });
      (fresh as any).providers.set("anthropic", { factory });
      const m = fresh.getModel("anthropic/claude-3-5-sonnet-20241022") as any;
      expect(factory).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("claude-3-5-sonnet-20241022");
      expect(m.modelId).toBe("claude-3-5-sonnet-20241022");
    });

    it("falls back to client.chat() when languageModel is missing", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const { modelRouter: fresh } = await import("../lib/model-router.js");
      if (!fresh.listProviders().includes("anthropic" as never)) return;
      const chat = vi.fn().mockReturnValue({
        modelId: "claude-3-5-sonnet-20241022",
        provider: "anthropic.messages",
      });
      const factory = vi.fn().mockReturnValue({ chat });
      (fresh as any).providers.set("anthropic", { factory });
      const m = fresh.getModel("anthropic/claude-3-5-sonnet-20241022") as any;
      expect(chat).toHaveBeenCalledWith("claude-3-5-sonnet-20241022");
      expect(m.modelId).toBe("claude-3-5-sonnet-20241022");
    });

    it("throws when provider client has neither languageModel nor chat", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const { modelRouter: fresh } = await import("../lib/model-router.js");
      if (!fresh.listProviders().includes("anthropic" as never)) return;
      const factory = vi.fn().mockReturnValue({});
      (fresh as any).providers.set("anthropic", { factory });
      expect(() => fresh.getModel("anthropic/claude-3-5-sonnet-20241022")).toThrow(
        /languageModel\(\) method/
      );
    });

    it("handles model names containing slashes", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const modelRouterLocal = (modelRouter as any);
      if (!modelRouterLocal.listProviders().includes("anthropic" as never)) return;
      const spy = vi.fn().mockReturnValue({ modelId: "x", provider: "p" });
      modelRouterLocal.providers.set("anthropic", {
        factory: () => ({ languageModel: spy }),
      });
      modelRouterLocal.getModel("anthropic/models/x/y");
      expect(spy).toHaveBeenCalledWith("models/x/y");
    });
  });
});
