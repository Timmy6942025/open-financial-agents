/**
 * Market Researcher Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → sector-reader → comps-spreader → note-writer
 *
 * Supports fan-out and direct agent dispatch via Mastra.
 */

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { dispatchAgent, detectCoverageList, fanOutCoverageList } from "../../scripts/orchestrate.js";

export const marketResearcherWorkflow = createWorkflow({
  id: "market-researcher-workflow",
  description: "Sector primer — read research, spread comps, produce note",
  inputSchema: z.object({
    sector: z.string().describe("Sector or theme to research, or 'coverage-list <name>'"),
    angle: z.string().optional().describe("Analysis angle"),
  }),
  outputSchema: z.object({
    primer: z.string(),
  }),
})
  .then(
    createStep({
      id: "read-sector",
      description: "Extract market-size, growth, and landscape facts from research (read+grep only)",
      inputSchema: z.object({ sector: z.string(), angle: z.string().optional() }),
      outputSchema: z.object({ overview: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const coverageList = detectCoverageList(inputData.sector);
        if (coverageList) {
          const entries = fanOutCoverageList(inputData.sector, coverageList);
          const results = await Promise.all(
            entries.map(async (e) => {
              const res = await dispatchAgent(mastra, "market-researcher/market-sector-reader",
                `Read third-party research and issuer materials for sector: ${e.ticker}, extract market-size, growth, and landscape facts. Return schema-validated JSON.`);
              return `${e.ticker}: ${res}`;
            })
          );
          return { overview: results.join("\n\n---\n\n") };
        }
        const result = await dispatchAgent(mastra, "market-researcher/market-sector-reader",
          `Read third-party research and issuer materials for sector: ${inputData.sector}, extract market-size, growth, and landscape facts. ${inputData.angle ? `Angle: ${inputData.angle}. ` : ""}Return schema-validated JSON.`);
        return { overview: result };
      },
    })
  )
  .then(
    createStep({
      id: "spread-comps",
      description: "Pull trading multiples for defined peer set (read+grep+MCP)",
      inputSchema: z.object({ overview: z.string() }),
      outputSchema: z.object({ compsSpread: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(mastra, "market-researcher/market-comps-spreader",
          `Pull trading multiples for the peer set from CapIQ/FactSet MCP and spread them with consistent metric definitions. ${inputData.overview}`);
        return { compsSpread: result };
      },
    })
  )
  .then(
    createStep({
      id: "write-note",
      description: "Produce sector primer (ONLY leaf with Write, no MCP)",
      inputSchema: z.object({ compsSpread: z.string() }),
      outputSchema: z.object({ primer: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(mastra, "market-researcher/market-note-writer",
          `Take the overview, landscape, comps spread, and ideas shortlist and produce ./out/primer-sector.docx. ${inputData.compsSpread}`);
        return { primer: result };
      },
    })
  )
  .commit();
