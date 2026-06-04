/**
 * Model router — resolves model strings for any AI SDK v6 provider.
 *
 * Uses Mastra's native model resolution:
 *   - "provider/model" strings are resolved by Mastra's ModelRouterLanguageModel
 *   - DynamicArgument enables runtime resolution via gateway
 *
 * Custom resolution layers (project-specific):
 *   1. MODEL_<AGENT_ID> env var — per-agent override
 *   2. DEFAULT_MODEL env var — global override
 *   3. CMA alias lookup — legacy Anthropic cookbook names
 *   4. Passthrough — Mastra resolves "provider/model" natively
 */

import { createGatewayProvider } from "@ai-sdk/gateway";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { DynamicArgument } from "@mastra/core/types";

// ── CMA alias map (legacy backwards compatibility) ──────────────────

const MODEL_MAP: Record<string, string> = {
  "claude-opus-4-7": "anthropic/claude-opus-4-7",
  "claude-sonnet-4-7": "anthropic/claude-sonnet-4-6", // alias maps newer request to available model
  "claude-haiku-4-5": "anthropic/claude-haiku-4-5",
};

// ── AI Gateway ──────────────────────────────────────────────────────

export const gatewayProvider = process.env.AI_GATEWAY_API_KEY
  ? createGatewayProvider({ apiKey: process.env.AI_GATEWAY_API_KEY })
  : null;

// ── Core resolution ─────────────────────────────────────────────────

/**
 * Resolve a model string for an agent.
 *
 * Resolution order:
 *   1. MODEL_<AGENT_ID> env var (per-agent)
 *   2. DEFAULT_MODEL env var (global)
 *   3. CMA alias lookup (legacy)
 *   4. Passthrough (already "provider/model" format)
 */
export function resolveModelString(modelName: string, agentId?: string): string {
  if (agentId) {
    const envKey = `MODEL_${agentId.replace(/-/g, "_").toUpperCase()}`;
    if (process.env[envKey]) return process.env[envKey];
  }
  if (process.env.DEFAULT_MODEL) return process.env.DEFAULT_MODEL;
  if (MODEL_MAP[modelName]) return MODEL_MAP[modelName];
  return modelName;
}

/**
 * Resolve a model for an Agent constructor.
 *
 * Returns DynamicArgument<MastraModelConfig>:
 *   - When AI Gateway is configured: returns a function that resolves at runtime
 *   - Otherwise: returns the "provider/model" string (Mastra resolves natively)
 *
 * The Agent constructor accepts this directly — Mastra handles:
 *   - ModelRouterLanguageModel gateway resolution for "provider/model" strings
 *   - DynamicArgument lazy resolution at generate/stream time
 */
export function resolveModelForAgent(
  modelName: string,
  agentId?: string
): DynamicArgument<MastraModelConfig> {
  const resolved = resolveModelString(modelName, agentId);

  if (gatewayProvider) {
    return () => gatewayProvider.languageModel(resolved);
  }

  return resolved;
}
