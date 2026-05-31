import { describe, it, expect } from "vitest";
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
});
