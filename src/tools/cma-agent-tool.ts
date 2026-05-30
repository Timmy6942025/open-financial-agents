/**
 * CMA Agent Tool — Dynamic Subagent Dispatch
 *
 * Implements the "Agent" tool from the original CMA model. Parent orchestrators
 * can call subagents by name at runtime, replacing rigid workflow pipelines
 * with dynamic dispatch.
 *
 * In Mastra, the agent tool receives subagent IDs and delegates generation
 * to mastra.getAgent(), returning the subagent's text output.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { Mastra } from "@mastra/core/mastra";

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
  }),
  outputSchema: z.object({
    result: z.string().describe("The subagent's response text"),
    subagent: z.string().describe("The subagent that was called"),
    error: z.string().optional().describe("Error message if the dispatch failed"),
  }),
  execute: async (inputData) => {
    if (!mastraInstance) {
      return {
        result: "",
        subagent: inputData.subagent,
        error: "Mastra instance not available — agent dispatch not initialized",
      };
    }

    // Validate the subagent exists — strip cookbook/ prefix if scoped ID passed
    const bareId = inputData.subagent.includes("/")
      ? inputData.subagent.split("/").pop()!
      : inputData.subagent;

    if (!subagentIds.includes(bareId)) {
      return {
        result: "",
        subagent: inputData.subagent,
        error: `Unknown subagent: ${inputData.subagent} (bare: ${bareId}). Available: ${subagentIds.join(", ")}`,
      };
    }

    try {
      // Subagent IDs are stored as bare names (e.g., "pitch-researcher")
      // but registered with scoped keys (e.g., "pitch-agent/pitch-researcher").
      // Try bare name first, then fall back to scoped lookup.
      let agent = mastraInstance.getAgent(inputData.subagent);

      if (!agent) {
        // Try to find by matching the end of scoped keys
        const allAgentIds = Object.keys((mastraInstance as any).agents || {});
        const scopedId = allAgentIds.find(
          (id) => id.endsWith(`/${inputData.subagent}`) || id === inputData.subagent
        );
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
      return {
        result: result.text,
        subagent: inputData.subagent,
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
