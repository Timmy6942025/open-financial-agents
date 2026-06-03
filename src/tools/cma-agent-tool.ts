/**
 * CMA Agent Tool — Dynamic Subagent Dispatch
 *
 * Implements the "Agent" tool from the original CMA model. Parent orchestrators
 * can call subagents by name at runtime, replacing rigid workflow pipelines
 * with dynamic dispatch.
 *
 * In Mastra, the agent tool receives subagent IDs and delegates generation
 * to mastra.getAgent(), returning the subagent's text output.
 *
 * When the subagent has an `output_schema` declared in its YAML, the
 * returned text is validated against that schema. Validation failures
 * are surfaced via the `error` field rather than thrown.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { Mastra } from "@mastra/core/mastra";
import { validateSubagentOutput } from "../lib/output-schema-validator.js";
import type { OutputSchema } from "../lib/cma-loader.js";
import { parseHandoffRequest, type HandoffRequest } from "../lib/dispatch.js";

/** Keep a reference to the Mastra instance for agent lookup */
let mastraInstance: Mastra | null = null;

export function setMastraInstance(mastra: Mastra): void {
  mastraInstance = mastra;
}

/** List of all registered subagent IDs, set by the CMA loader */
let subagentIds: string[] = [];

export function setSubagentIds(ids: string[]): void {
  subagentIds = ids;
}

/** Subagent output_schema lookup, keyed by "cookbook/subagent" */
const subagentSchemas = new Map<string, OutputSchema>();

/** Register subagent output_schemas for runtime validation */
export function setSubagentSchemas(
  entries: Array<{ key: string; schema?: OutputSchema }>
): void {
  for (const { key, schema } of entries) {
    if (schema) subagentSchemas.set(key, schema);
  }
}

/**
 * cma_agent tool — dispatches to a named subagent.
 *
 * The parent orchestrator's system prompt describes which subagents are
 * available. When the parent calls cma_agent with a subagent name and prompt,
 * the subagent generates a response and returns it.
 */
export const agentTool = createTool({
  id: "agent",
  description:
    "Dispatch a task to a named subagent. Use this to delegate work to " +
    "specialized leaf workers. Available subagents are listed in your " +
    "system prompt. Each subagent has specific tools and capabilities — " +
    "choose the right one for the task.",
  inputSchema: z.object({
    subagent: z.string().describe("The ID of the subagent to dispatch to"),
    prompt: z.string().describe("The task description to send to the subagent"),
    cookbook: z
      .string()
      .optional()
      .describe(
        "Optional cookbook name to disambiguate when multiple cookbooks " +
          "expose a subagent with the same bare name"
      ),
  }),
  outputSchema: z.object({
    result: z.string().describe("The subagent's response text"),
    subagent: z.string().describe("The subagent that was called"),
    error: z.string().optional().describe("Error message if the dispatch failed"),
    handoff: z
      .object({
        type: z.literal("handoff_request"),
        target_agent: z.string(),
        payload: z.object({
          event: z.string(),
          context_ref: z.string().optional(),
        }),
      })
      .optional()
      .describe("Parsed handoff request if the subagent emitted one"),
  }),
  execute: async (inputData) => {
    if (!mastraInstance) {
      return {
        result: "",
        subagent: inputData.subagent,
        error: "Mastra instance not available — agent dispatch not initialized",
      };
    }

    const bareId = inputData.subagent.includes("/")
      ? inputData.subagent.split("/").pop()!
      : inputData.subagent;

    const idValid = inputData.subagent.includes("/")
      ? subagentIds.includes(inputData.subagent)
      : subagentIds.some((id) => id.endsWith(`/${bareId}`) || id === bareId);

    if (!idValid) {
      return {
        result: "",
        subagent: inputData.subagent,
        error: `Unknown subagent: ${inputData.subagent} (bare: ${bareId}). Available: ${subagentIds.join(", ")}`,
      };
    }

    try {
      let agent = mastraInstance.getAgent(inputData.subagent);

      if (!agent && !inputData.subagent.includes("/")) {
        let scopedId: string | undefined;
        if (inputData.cookbook) {
          const candidate = `${inputData.cookbook}/${bareId}`;
          if (subagentIds.includes(candidate)) {
            scopedId = candidate;
          }
        }
        if (!scopedId) {
          scopedId = subagentIds.find(
            (id) => id.endsWith(`/${bareId}`) || id === bareId
          );
        }
        if (scopedId) {
          agent = mastraInstance.getAgent(scopedId);
        }
      }

      if (!agent) {
        return {
          result: "",
          subagent: inputData.subagent,
          error: `Subagent registered but not found in Mastra: ${inputData.subagent}`,
        };
      }

      const result = await agent.generate(inputData.prompt);
      const resolvedKey = resolveSchemaKey(inputData.subagent, bareId, inputData.cookbook);
      const schema = resolvedKey ? subagentSchemas.get(resolvedKey) : undefined;
      if (schema) {
        const validation = await validateSubagentOutput(result.text, schema);
        if (!validation.valid) {
          return {
            result: result.text,
            subagent: inputData.subagent,
            error: `Output schema validation failed: ${validation.error}`,
          };
        }
      }
      const handoff = parseHandoffRequest(result.text) ?? undefined;
      return {
        result: result.text,
        subagent: inputData.subagent,
        ...(handoff ? { handoff } : {}),
      };
    } catch (err: any) {
      return {
        result: "",
        subagent: inputData.subagent,
        error: `Dispatch failed: ${err.message}`,
      };
    }
  },
});

function resolveSchemaKey(
  requestedId: string,
  bareId: string,
  cookbook?: string
): string | undefined {
  if (requestedId.includes("/")) {
    return subagentSchemas.has(requestedId) ? requestedId : undefined;
  }
  if (cookbook && subagentSchemas.has(`${cookbook}/${bareId}`)) {
    return `${cookbook}/${bareId}`;
  }
  for (const key of subagentSchemas.keys()) {
    if (key.endsWith(`/${bareId}`)) return key;
  }
  return undefined;
}
