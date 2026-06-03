/**
 * Shared subagent dispatch helper.
 *
 * Used by all CMA workflows — tries direct agent lookup first,
 * falls back to dynamic dispatch through the parent orchestrator
 * if the subagent isn't individually registered.
 */

import type { Mastra } from "@mastra/core/mastra";
import { validateSubagentOutput, type ValidationResult } from "./output-schema-validator.js";
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
 * If options.outputSchema is provided, the subagent's text output is
 * parsed and validated against the schema. Validation failures throw
 * an Error so the calling workflow can surface or handle them.
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
  const text = await dispatchRaw(mastra, subagentId, prompt, timeoutMs);

  if (skipValidation || !outputSchema) {
    return text;
  }

  const result: ValidationResult = await validateSubagentOutput(text, outputSchema);
  if (!result.valid) {
    throw new Error(
      `Subagent "${subagentId}" failed output_schema validation: ${result.error}`
    );
  }
  return text;
}

async function dispatchRaw(
  mastra: Mastra,
  subagentId: string,
  prompt: string,
  timeoutMs: number
): Promise<string> {
  if (!subagentId.includes("/")) {
    const allAgents = (mastra as any).agents || {};
    const scopedKey = Object.keys(allAgents).find(
      (key) => key.endsWith(`/${subagentId}`) || key === subagentId
    );
    if (scopedKey) {
      const agent = mastra.getAgent(scopedKey);
      if (agent) {
        const result = await withTimeout(agent.generate(prompt), timeoutMs, `Subagent "${subagentId}"`);
        return result.text;
      }
    }
    throw new Error(`Subagent not found: ${subagentId}`);
  }

  const agent = mastra.getAgent(subagentId);
  if (agent) {
    const result = await withTimeout(agent.generate(prompt), timeoutMs, `Subagent "${subagentId}"`);
    return result.text;
  }

  const parts = subagentId.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid subagent ID format: ${subagentId}`);
  }

  const orchestrator = mastra.getAgent(parts[0]);
  if (!orchestrator) {
    throw new Error(`Orchestrator not found: ${parts[0]}`);
  }

  const result = await withTimeout(
    orchestrator.generate(`Call subagent ${parts[1]} with: ${prompt}`),
    timeoutMs,
    `Orchestrator "${parts[0]}"`
  );
  return result.text;
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
