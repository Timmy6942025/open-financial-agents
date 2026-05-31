/**
 * Pitch Agent Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → researcher → modeler → deck-writer
 *
 * Supports:
 *   - Handoff extraction: detects handoff_request in step outputs
 *   - Fan-out: coverage-list iteration for batch processing
 *   - Dynamic dispatch: falls back to cma_agent if subagent not registered
 *
 * Security model (matches original):
 *   - researcher:   read+grep, CapIQ+Daloopa MCP, output_schema validated
 *   - modeler:      read+bash, CapIQ+Daloopa MCP, runs Python via Bash
 *   - deck-writer:  read+write+edit, NO MCP, only leaf with Write
 */

import { createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { extractHandoff, detectCoverageList, fanOutCoverageList } from "../../scripts/orchestrate.js";
import { dispatchSubagent } from "../lib/dispatch.js";
import { defineStep } from "../lib/step-utils.js";

export const pitchWorkflow = createWorkflow({
  id: "pitch-workflow",
  description: "End-to-end investment banking pitch — research, model, deck. Supports fan-out across coverage lists.",
  inputSchema: z.object({
    target: z.string().describe("Target company ticker or name, or 'coverage-list <name>' for batch"),
    acquirer: z.string().optional().describe("Acquirer name"),
    situation: z.string().describe("Strategic situation"),
    thesis: z.string().optional().describe("Stated thesis"),
  }),
  outputSchema: z.object({
    workbook: z.string().describe("Path to valuation workbook"),
    deck: z.string().describe("Path to pitch deck"),
    handoff: z.unknown().optional().describe("Handoff request if emitted"),
  }),
})
  .then(
    defineStep({
      id: "research",
      description: "Pull comps and precedent transactions from CapIQ/Daloopa (read+grep+MCP, schema-validated)",
      inputSchema: z.object({
        target: z.string(),
        acquirer: z.string().optional(),
        situation: z.string(),
        thesis: z.string().optional(),
      }),
      outputSchema: z.object({
        researchFindings: z.string(),
        handoff: z.unknown().optional(),
      }),
      passthroughMapper: (input) => ({ researchFindings: input.target, handoff: input.handoff }),
      execute: async ({ input, mastra }) => {
        const coverageList = detectCoverageList(input.target);
        if (coverageList) {
          const entries = fanOutCoverageList(input.target, coverageList);
          const results = await Promise.all(
            entries.map(async (e) => {
              const res = await dispatchSubagent(
                mastra,
                "pitch-agent/pitch-researcher",
                `Research comps for target: ${e.ticker}. ${input.acquirer ? `Acquirer: ${input.acquirer}. ` : ""}Situation: ${input.situation}${input.thesis ? `. Thesis: ${input.thesis}` : ""}`
              );
              return `${e.ticker}: ${res}`;
            })
          );
          return { researchFindings: results.join("\n\n---\n\n") };
        }

        const result = await dispatchSubagent(
          mastra,
          "pitch-agent/pitch-researcher",
          `Research comps and precedent transactions for target: ${input.target}. Pull trading multiples and precedent data from CapIQ/Daloopa. Return a structured table as schema-validated JSON. ${input.acquirer ? `Acquirer: ${input.acquirer}. ` : ""}Situation: ${input.situation}${input.thesis ? `. Thesis: ${input.thesis}` : ""}`
        );

        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        if (handoff) {
          return { researchFindings: result, handoff };
        }

        return { researchFindings: result };
      },
    })
  )
  .then(
    defineStep({
      id: "model",
      description: "Build DCF/LBO valuation with Python via Bash (read+bash+MCP)",
      inputSchema: z.object({
        researchFindings: z.string(),
        handoff: z.unknown().optional(),
      }),
      outputSchema: z.object({
        workbook: z.string(),
        handoff: z.unknown().optional(),
      }),
      passthroughMapper: (input) => ({ workbook: input.researchFindings, handoff: input.handoff }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagent(
          mastra,
          "pitch-agent/pitch-modeler",
          `Build DCF/LBO valuation in a scratch directory using the comps and inputs handed to you. Run calculations in Python via Bash. Return computed outputs as structured JSON. You do not write the final workbook — the deck-writer does. ${input.researchFindings}`
        );

        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { workbook: result, handoff: handoff || undefined };
      },
    })
  )
  .then(
    defineStep({
      id: "write-deck",
      description: "Produce pitch deck from model outputs (ONLY leaf with Write+Edit, no MCP)",
      inputSchema: z.object({
        workbook: z.string(),
        handoff: z.unknown().optional(),
      }),
      outputSchema: z.object({
        deck: z.string(),
        handoff: z.unknown().optional(),
      }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagent(
          mastra,
          "pitch-agent/pitch-deck-writer",
          `Take the verified comps, model outputs, and football field, and produce ./out/model-pitch.xlsx and ./out/pitch-deck.pptx using xlsx-author and pptx-author conventions. Never open external documents. ${input.workbook}`
        );

        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { deck: result || "./out/pitch-deck.pptx", handoff: handoff || undefined };
      },
    })
  )
  .commit();
