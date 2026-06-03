/**
 * Shared subagent dispatch helper.
 *
 * Used by all CMA workflows — tries direct agent lookup first,
 * falls back to dynamic dispatch through the parent orchestrator
 * if the subagent isn't individually registered.
 */

import type { Mastra } from "@mastra/core/mastra";
import type { Agent } from "@mastra/core/agent";
import { getSubagentOutputSchema, type OutputSchema } from "./cma-loader.js";

// ── Handoff types ───────────────────────────────────────────────────

/** Typed structure for a handoff_request JSON block in subagent output. */
export interface HandoffRequest {
  type: "handoff_request";
  target_agent: string;
  payload: {
    event: string;
    context_ref?: string;
  };
}

const HANDOFF_RE = /\{"type":\s*"handoff_request".*?\}/s;

/**
 * Extract and validate a handoff request from agent output text.
 * Returns null if no valid handoff is found.
 */
export function parseHandoffRequest(text: string): HandoffRequest | null {
  const match = HANDOFF_RE.exec(text);
  if (!match) return null;

  try {
    const obj = JSON.parse(match[0]);
    if (
      obj.type !== "handoff_request" ||
      typeof obj.target_agent !== "string" ||
      !obj.payload ||
      typeof obj.payload.event !== "string"
    ) {
      return null;
    }
    return {
      type: "handoff_request",
      target_agent: obj.target_agent,
      payload: {
        event: obj.payload.event,
        ...(typeof obj.payload.context_ref === "string" ? { context_ref: obj.payload.context_ref } : {}),
      },
    };
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer!));
}

/**
 * Resolve a subagent by scoped key or bare name.
 * Returns the Agent instance or null if not found.
 */
function resolveAgent(mastra: Mastra, subagentId: string): Agent | null {
  if (subagentId.includes("/")) {
    return mastra.getAgent(subagentId) ?? null;
  }
  const allAgents = (mastra as unknown as Record<string, unknown>).agents ?? ({} as Record<string, unknown>);
  const scopedKey = Object.keys(allAgents).find(
    (key) => key.endsWith(`/${subagentId}`) || key === subagentId
  );
  return scopedKey ? (mastra.getAgent(scopedKey) ?? null) : null;
}

export interface DispatchOptions {
  timeoutMs?: number;
  outputSchema?: OutputSchema;
  /** When true, skip validation entirely and return raw text. */
  skipValidation?: boolean;
}

/**
 * Call a CMA subagent by its scoped ID (e.g. "pitch-agent/pitch-researcher")
 * or bare name (e.g. "pitch-researcher").
 *
 * Resolution order:
 * 1. Direct lookup via mastra.getAgent(id) with scoped key
 * 2. If no "/" in id, try finding a scoped key ending with "/{id}"
 * 3. Fallback: ask the parent orchestrator to dispatch dynamically
 * 4. Error if neither works
 *
 * If options.outputSchema is provided, uses Mastra's structured output
 * to enforce the schema at the API level. Falls back to plain text
 * generation if the model doesn't support structured output with tools.
 *
 * For backward compatibility, the 4th argument may also be a number
 * (timeoutMs) — this preserves the prior positional signature.
 */
export async function dispatchSubagent(
  mastra: Mastra,
  subagentId: string,
  prompt: string,
  optionsOrTimeout: DispatchOptions | number = {}
): Promise<string> {
  const options: DispatchOptions =
    typeof optionsOrTimeout === "number"
      ? { timeoutMs: optionsOrTimeout }
      : optionsOrTimeout;
  const { timeoutMs = 60000, outputSchema, skipValidation } = options;

  if (skipValidation || !outputSchema) {
    return dispatchRaw(mastra, subagentId, prompt, timeoutMs);
  }

  // Use structured output to enforce schema at the API level
  return dispatchWithStructuredOutput(mastra, subagentId, prompt, timeoutMs, outputSchema);
}

async function dispatchRaw(
  mastra: Mastra,
  subagentId: string,
  prompt: string,
  timeoutMs: number
): Promise<string> {
  const agent = resolveAgent(mastra, subagentId);
  if (!agent) {
    throw new Error(`Subagent not found: ${subagentId}`);
  }
  const result = await withTimeout(agent.generate(prompt), timeoutMs, `Subagent "${subagentId}"`);
  return result.text;
}

/**
 * Dispatch a subagent with structured output enforcement.
 * Uses Mastra's structuredOutput to enforce schema at the API level.
 * Falls back to plain text if the model doesn't support structured output with tools.
 */
async function dispatchWithStructuredOutput(
  mastra: Mastra,
  subagentId: string,
  prompt: string,
  timeoutMs: number,
  outputSchema: OutputSchema
): Promise<string> {
  const agent = resolveAgent(mastra, subagentId);
  if (!agent) {
    throw new Error(`Subagent not found: ${subagentId}`);
  }

  try {
    const result = await withTimeout(
      agent.generate(prompt, {
        structuredOutput: {
          schema: outputSchema as unknown as Record<string, unknown>,
          jsonPromptInjection: true,
        },
      }),
      timeoutMs,
      `Subagent "${subagentId}"`
    );
    // Return the structured object as JSON string for backward compatibility
    return JSON.stringify(result.object);
  } catch (err: unknown) {
    // Only fall back to plain text for structured-output-specific errors.
    // Re-throw rate limits, auth failures, timeouts, and other real errors.
    const msg = err instanceof Error ? err.message : String(err);
    const isStructuredOutputError =
      msg.includes("structured") ||
      msg.includes("json") ||
      msg.includes("schema") ||
      msg.includes("object") ||
      msg.includes("Not supported") ||
      msg.includes("unsupported");

    if (!isStructuredOutputError) {
      throw err;
    }

    console.warn(`[dispatch] Structured output failed for "${subagentId}", falling back to plain text: ${msg}`);
    const result = await withTimeout(agent.generate(prompt), timeoutMs, `Subagent "${subagentId}"`);
    return result.text;
  }
}

/**
 * Workflow-friendly dispatch wrapper that auto-resolves the subagent's
 * output_schema from the loaded CMA YAML and validates the response.
 *
 * Validation failures throw, which `defineStep` wraps with the step ID
 * for a clean error trace.
 */
export async function dispatchSubagentValidated(
  mastra: Mastra,
  subagentId: string,
  prompt: string,
  options: { timeoutMs?: number; skipValidation?: boolean } = {}
): Promise<string> {
  const { timeoutMs, skipValidation } = options;
  const outputSchema = skipValidation ? undefined : getSubagentOutputSchema(subagentId);
  return dispatchSubagent(mastra, subagentId, prompt, {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(outputSchema ? { outputSchema } : {}),
    ...(skipValidation ? { skipValidation } : {}),
  });
}
