import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveModelString, validateModelString } from "../lib/model-router.js";

describe("resolveModelString", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("maps CMA alias 'claude-opus-4-7' to provider/model format", () => {
    delete process.env.DEFAULT_MODEL;
    expect(resolveModelString("claude-opus-4-7")).toBe("anthropic/claude-opus-4-7");
  });

  it("maps CMA alias 'claude-sonnet-4-7' to provider/model format", () => {
    delete process.env.DEFAULT_MODEL;
    expect(resolveModelString("claude-sonnet-4-7")).toBe("anthropic/claude-sonnet-4-6");
  });

  it("maps CMA alias 'claude-haiku-4-5' to provider/model format", () => {
    delete process.env.DEFAULT_MODEL;
    expect(resolveModelString("claude-haiku-4-5")).toBe("anthropic/claude-haiku-4-5");
  });

  it("passes through provider/model strings unchanged", () => {
    delete process.env.DEFAULT_MODEL;
    expect(resolveModelString("openai/gpt-4o")).toBe("openai/gpt-4o");
    expect(resolveModelString("anthropic/claude-opus-4-7")).toBe("anthropic/claude-opus-4-7");
    expect(resolveModelString("openrouter/meta-llama/llama-4-scout")).toBe("openrouter/meta-llama/llama-4-scout");
    expect(resolveModelString("google/gemini-2.5-pro")).toBe("google/gemini-2.5-pro");
  });

  it("DEFAULT_MODEL env var overrides all mappings", () => {
    process.env.DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";
    expect(resolveModelString("claude-opus-4-7")).toBe("anthropic/claude-sonnet-4-6");
    expect(resolveModelString("openai/gpt-4o")).toBe("anthropic/claude-sonnet-4-6");
  });

  it("handles unknown model names by passing them through", () => {
    delete process.env.DEFAULT_MODEL;
    expect(resolveModelString("unknown-model")).toBe("unknown-model");
  });

  describe("per-agent env var overrides", () => {
    it("MODEL_<AGENT_ID> overrides DEFAULT_MODEL for a specific agent", () => {
      process.env.DEFAULT_MODEL = "openai/gpt-4o";
      process.env.MODEL_PITCH_AGENT = "anthropic/claude-opus-4-7";
      expect(resolveModelString("claude-opus-4-7", "pitch-agent")).toBe("anthropic/claude-opus-4-7");
      // Other agents still get DEFAULT_MODEL
      expect(resolveModelString("claude-opus-4-7", "earnings-reviewer")).toBe("openai/gpt-4o");
    });

    it("MODEL_<AGENT_ID> overrides CMA alias for a specific agent", () => {
      delete process.env.DEFAULT_MODEL;
      process.env.MODEL_PITCH_AGENT = "openai/gpt-4o";
      expect(resolveModelString("claude-opus-4-7", "pitch-agent")).toBe("openai/gpt-4o");
      // Other agents still get CMA alias resolution
      expect(resolveModelString("claude-opus-4-7", "other-agent")).toBe("anthropic/claude-opus-4-7");
    });

    it("per-agent env var works with OpenRouter models", () => {
      delete process.env.DEFAULT_MODEL;
      process.env.MODEL_MARKET_RESEARCHER = "openrouter/anthropic/claude-sonnet-4-6";
      expect(resolveModelString("claude-opus-4-7", "market-researcher")).toBe("openrouter/anthropic/claude-sonnet-4-6");
    });

    it("per-agent env var works with Google models", () => {
      delete process.env.DEFAULT_MODEL;
      process.env.MODEL_KYC_SCREENER = "google/gemini-2.5-pro";
      expect(resolveModelString("claude-opus-4-7", "kyc-screener")).toBe("google/gemini-2.5-pro");
    });

    it("per-agent env var works with Mistral models", () => {
      delete process.env.DEFAULT_MODEL;
      process.env.MODEL_GL_RECONCILER = "mistral/mistral-large-latest";
      expect(resolveModelString("claude-opus-4-7", "gl-reconciler")).toBe("mistral/mistral-large-latest");
    });

    it("agentId with hyphens is normalized to underscores for env var", () => {
      delete process.env.DEFAULT_MODEL;
      process.env.MODEL_MEETING_PREP_AGENT = "openai/gpt-4o";
      // meeting-prep-agent → MODEL_MEETING_PREP_AGENT
      expect(resolveModelString("claude-opus-4-7", "meeting-prep-agent")).toBe("openai/gpt-4o");
    });

    it("no agentId falls through to DEFAULT_MODEL", () => {
      process.env.DEFAULT_MODEL = "openai/gpt-4o";
      expect(resolveModelString("claude-opus-4-7")).toBe("openai/gpt-4o");
    });
  });
});

describe("validateModelString", () => {
  it("accepts valid provider/model strings", () => {
    expect(validateModelString("anthropic/claude-opus-4-7")).toBe(true);
    expect(validateModelString("openai/gpt-4o")).toBe(true);
    expect(validateModelString("openrouter/meta-llama/llama-4-scout")).toBe(true);
  });

  it("throws for strings without a slash", () => {
    expect(() => validateModelString("claude-opus-4")).toThrow(
      'Invalid model string "claude-opus-4"'
    );
  });

  it("throws for empty strings", () => {
    expect(() => validateModelString("")).toThrow('Invalid model string ""');
  });
});
