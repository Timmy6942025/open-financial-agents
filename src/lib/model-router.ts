/**
 * Model router — resolves model strings for any AI SDK v6 provider.
 *
 * Resolution order (highest priority first):
 *   1. MODEL_<AGENT_ID> env var — per-agent override
 *   2. DEFAULT_MODEL env var — global override
 *   3. CMA alias lookup — legacy Anthropic cookbook names
 *   4. Passthrough — already in "provider/model" format
 *
 * When AI Gateway is configured, resolveModelForAgent() returns a
 * DynamicArgument function that Mastra calls at runtime.
 */

import { createGatewayProvider } from "@ai-sdk/gateway";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { DynamicArgument } from "@mastra/core/types";

const MODEL_MAP: Record<string, string> = {
  "claude-opus-4-7": "anthropic/claude-opus-4-7",
  "claude-sonnet-4-7": "anthropic/claude-sonnet-4-6",
  "claude-haiku-4-5": "anthropic/claude-haiku-4-5",
};

export const gatewayProvider = process.env.AI_GATEWAY_API_KEY
  ? createGatewayProvider({ apiKey: process.env.AI_GATEWAY_API_KEY })
  : null;

export function resolveModelString(modelName: string, agentId?: string): string {
  if (agentId) {
    const envKey = `MODEL_${agentId.replace(/-/g, "_").toUpperCase()}`;
    if (process.env[envKey]) return process.env[envKey];
  }
  if (process.env.DEFAULT_MODEL) return process.env.DEFAULT_MODEL;
  if (MODEL_MAP[modelName]) return MODEL_MAP[modelName];
  return modelName;
}

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

export function validateModelString(modelString: string): boolean {
  if (!modelString.includes("/")) {
    throw new Error(
      `Invalid model string "${modelString}" — expected "provider/model" format`
    );
  }
  return true;
}
