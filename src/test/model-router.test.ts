import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveModelString, validateModelString } from "../lib/model-router.js";

describe("resolveModelString", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("maps CMA alias 'claude-opus-4-7' to provider/model format", () => {
    delete process.env.DEFAULT_MODEL;
    expect(resolveModelString("claude-opus-4-7")).toBe("anthropic/claude-opus-4");
  });

  it("maps CMA alias 'claude-sonnet-4-7' to provider/model format", () => {
    delete process.env.DEFAULT_MODEL;
    expect(resolveModelString("claude-sonnet-4-7")).toBe("anthropic/claude-sonnet-4");
  });

  it("maps CMA alias 'claude-haiku-4-5' to provider/model format", () => {
    delete process.env.DEFAULT_MODEL;
    expect(resolveModelString("claude-haiku-4-5")).toBe("anthropic/claude-haiku-4-5");
  });

  it("passes through provider/model strings unchanged", () => {
    delete process.env.DEFAULT_MODEL;
    expect(resolveModelString("openai/gpt-4o")).toBe("openai/gpt-4o");
    expect(resolveModelString("anthropic/claude-opus-4")).toBe("anthropic/claude-opus-4");
    expect(resolveModelString("openrouter/meta-llama/llama-4-scout")).toBe("openrouter/meta-llama/llama-4-scout");
  });

  it("DEFAULT_MODEL env var overrides all mappings", () => {
    process.env.DEFAULT_MODEL = "anthropic/claude-sonnet-4";
    expect(resolveModelString("claude-opus-4-7")).toBe("anthropic/claude-sonnet-4");
    expect(resolveModelString("openai/gpt-4o")).toBe("anthropic/claude-sonnet-4");
  });

  it("handles unknown model names by passing them through", () => {
    delete process.env.DEFAULT_MODEL;
    expect(resolveModelString("unknown-model")).toBe("unknown-model");
  });
});

describe("validateModelString", () => {
  it("accepts valid provider/model strings", () => {
    expect(validateModelString("anthropic/claude-opus-4")).toBe(true);
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
