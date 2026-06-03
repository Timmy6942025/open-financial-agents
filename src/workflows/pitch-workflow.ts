/**
 * Pitch Agent Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → researcher → modeler → deck-writer
 *
 * Supports:
 *   - Fan-out: coverage-list iteration for batch processing
 *   - Direct agent dispatch via Mastra
 *
 * Security model (matches original):
 *   - researcher:   read+grep, CapIQ+Daloopa MCP
 *   - modeler:      read+bash, CapIQ+Daloopa MCP, runs Python via Bash
 *   - deck-writer:  read+write+edit, NO MCP, only leaf with Write
 */

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { dispatchAgent, detectCoverageList, fanOutCoverageList } from "../../scripts/orchestrate.js";

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
  }),
})
  .then(
    createStep({
      id: "research",
      description: "Pull comps and precedent transactions from CapIQ/Daloopa (read+grep+MCP)",
      inputSchema: z.object({
        target: z.string(),
        acquirer: z.string().optional(),
        situation: z.string(),
        thesis: z.string().optional(),
      }),
      outputSchema: z.object({
        researchFindings: z.string(),
      }),
      execute: async ({ inputData, mastra }) => {
        const coverageList = detectCoverageList(inputData.target);
        if (coverageList) {
          const entries = fanOutCoverageList(inputData.target, coverageList);
          const results = await Promise.all(
            entries.map(async (e) => {
              const res = await dispatchAgent(
                mastra,
                "pitch-agent/pitch-researcher",
                `Research comps for target: ${e.ticker}. ${inputData.acquirer ? `Acquirer: ${inputData.acquirer}. ` : ""}Situation: ${inputData.situation}${inputData.thesis ? `. Thesis: ${inputData.thesis}` : ""}`
              );
              return `${e.ticker}: ${res}`;
            })
          );
          return { researchFindings: results.join("\n\n---\n\n") };
        }

        const result = await dispatchAgent(
          mastra,
          "pitch-agent/pitch-researcher",
          `Research comps and precedent transactions for target: ${inputData.target}. Pull trading multiples and precedent data from CapIQ/Daloopa. Return a structured table as schema-validated JSON. ${inputData.acquirer ? `Acquirer: ${inputData.acquirer}. ` : ""}Situation: ${inputData.situation}${inputData.thesis ? `. Thesis: ${inputData.thesis}` : ""}`
        );

        return { researchFindings: result };
      },
    })
  )
  .then(
    createStep({
      id: "model",
      description: "Build DCF/LBO valuation with Python via Bash (read+bash+MCP)",
      inputSchema: z.object({
        researchFindings: z.string(),
      }),
      outputSchema: z.object({
        workbook: z.string(),
      }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(
          mastra,
          "pitch-agent/pitch-modeler",
          `Build DCF/LBO valuation in a scratch directory using the comps and inputs handed to you. Run calculations in Python via Bash. Return computed outputs as structured JSON. You do not write the final workbook — the deck-writer does. ${inputData.researchFindings}`
        );

        return { workbook: result };
      },
    })
  )
  .then(
    createStep({
      id: "write-deck",
      description: "Produce pitch deck from model outputs (ONLY leaf with Write+Edit, no MCP)",
      inputSchema: z.object({
        workbook: z.string(),
      }),
      outputSchema: z.object({
        deck: z.string(),
      }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(
          mastra,
          "pitch-agent/pitch-deck-writer",
          `Take the verified comps, model outputs, and football field, and produce ./out/model-pitch.xlsx and ./out/pitch-deck.pptx using xlsx-author and pptx-author conventions. Never open external documents. ${inputData.workbook}`
        );

        return { deck: result || "./out/pitch-deck.pptx" };
      },
    })
  )
  .commit();
