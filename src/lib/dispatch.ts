/**
 * Shared subagent dispatch helper.
 *
 * Used by all CMA workflows — tries direct agent lookup first,
 * falls back to dynamic dispatch through the parent orchestrator
 * if the subagent isn't individually registered.
 */

import type { Mastra } from "@mastra/core/mastra";

/**
 * Call a CMA subagent by its scoped ID (e.g. "pitch-agent/pitch-researcher")
 * or bare name (e.g. "pitch-researcher").
 *
 * Resolution order:
 * 1. Direct lookup via mastra.getAgent(id) with scoped key
 * 2. If no "/" in id, try finding a scoped key ending with "/{id}"
 * 3. Fallback: ask the parent orchestrator to dispatch dynamically
 * 4. Error if neither works
 */
export async function dispatchSubagent(
  mastra: Mastra,
  subagentId: string,
  prompt: string,
  timeoutMs = 60000
): Promise<string> {
  // Guard: bare name without slash — try to find scoped key
  if (!subagentId.includes("/")) {
    const allAgents = (mastra as any).agents || {};
    const scopedKey = Object.keys(allAgents).find(
      (key) => key.endsWith(`/${subagentId}`) || key === subagentId
    );
    if (scopedKey) {
      const agent = mastra.getAgent(scopedKey);
      if (agent) {
        const result = await Promise.race([
          agent.generate(prompt),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Subagent "${subagentId}" timed out after ${timeoutMs}ms`)), timeoutMs)
          ),
        ]);
        return result.text;
      }
    }
    throw new Error(`Subagent not found: ${subagentId}`);
  }

  // Scoped key: try direct lookup first
  const agent = mastra.getAgent(subagentId);
  if (agent) {
    const result = await Promise.race([
      agent.generate(prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Subagent "${subagentId}" timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    return result.text;
  }

  // Fallback: dynamic dispatch via parent orchestrator
  const parts = subagentId.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid subagent ID format: ${subagentId}`);
  }

  const orchestrator = mastra.getAgent(parts[0]);
  if (!orchestrator) {
    throw new Error(`Orchestrator not found: ${parts[0]}`);
  }

  const result = await Promise.race([
    orchestrator.generate(`Call subagent ${parts[1]} with: ${prompt}`),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Orchestrator "${parts[0]}" timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
  return result.text;
}
