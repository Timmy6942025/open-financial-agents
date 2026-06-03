/**
 * Model router — validates and resolves model strings.
 *
 * Mastra accepts model strings like 'anthropic/claude-opus-4' directly
 * and handles provider registration internally. This module provides
 * validation and a CMA name → provider/model mapping.
 *
 * Usage:
 *   resolveModelString("claude-opus-4-7")   → "anthropic/claude-opus-4"
 *   resolveModelString("openai/gpt-4o")     → "openai/gpt-4o"
 */

import { createGatewayProvider } from "@ai-sdk/gateway";

const MODEL_MAP: Record<string, string> = {
  "claude-opus-4-7": "anthropic/claude-opus-4",
  "claude-sonnet-4-7": "anthropic/claude-sonnet-4",
  "claude-haiku-4-5": "anthropic/claude-haiku-4-5",
};

/**
 * AI Gateway provider — routes all models through Vercel AI Gateway.
 * Returns null if AI_GATEWAY_API_KEY is not set.
 */
export const gatewayProvider = process.env.AI_GATEWAY_API_KEY
  ? createGatewayProvider({ apiKey: process.env.AI_GATEWAY_API_KEY })
  : null;

/**
 * Resolve a CMA model name or provider/model string to a Mastra model string.
 *
 * - Known CMA aliases are mapped to provider/model format.
 * - Provider/model strings are passed through unchanged.
 * - The DEFAULT_MODEL env var overrides all if set.
 */
export function resolveModelString(modelName: string): string {
  if (process.env.DEFAULT_MODEL) {
    return process.env.DEFAULT_MODEL;
  }
  return MODEL_MAP[modelName] || modelName;
}

/**
 * Resolve a model for use with processors and guardrails.
 * Returns a LanguageModelV3 instance when AI Gateway is configured,
 * otherwise returns the model string for Mastra's model router.
 */
export function resolveGuardrailModel(modelName: string): string | ReturnType<NonNullable<typeof gatewayProvider>["languageModel"]> {
  if (gatewayProvider) {
    return gatewayProvider.languageModel(resolveModelString(modelName));
  }
  return resolveModelString(modelName);
}

/**
 * Validate that a model string has the expected "provider/model" format.
 * Returns true if valid, throws if not.
 */
export function validateModelString(modelString: string): boolean {
  const parts = modelString.split("/");
  if (parts.length < 2) {
    throw new Error(
      `Invalid model string "${modelString}" — expected "provider/model" format (e.g., "anthropic/claude-opus-4")`
    );
  }
  return true;
}
