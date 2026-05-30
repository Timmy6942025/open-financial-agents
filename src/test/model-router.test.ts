import { describe, it, expect, vi, beforeEach } from "vitest";
import { modelRouter } from "../lib/model-router.js";

describe("modelRouter singleton", () => {
  beforeEach(() => {
    delete process.env.DEFAULT_MODEL;
  });

  describe("listProviders", () => {
    it("should return array of available providers", () => {
      const providers = modelRouter.listProviders();
      expect(Array.isArray(providers)).toBe(true);
    });
  });

  describe("getModel", () => {
    it("should throw descriptive error when provider not configured", () => {
      expect(() => modelRouter.getModel("openai/gpt-4o")).toThrow(
        'Provider "openai" not configured'
      );
    });

    it("should throw for unconfigured Anthropic provider", () => {
      expect(() => modelRouter.getModel("anthropic/claude-opus-4")).toThrow(
        'Provider "anthropic" not configured'
      );
    });
  });
});