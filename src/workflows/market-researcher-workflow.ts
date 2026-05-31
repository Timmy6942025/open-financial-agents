/**
 * Market Researcher Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → sector-reader → comps-spreader → note-writer
 *
 * Supports handoff extraction, fan-out, and dynamic dispatch.
 */

import { createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { extractHandoff, detectCoverageList, fanOutCoverageList } from "../../scripts/orchestrate.js";
import { dispatchSubagent } from "../lib/dispatch.js";
import { defineStep } from "../lib/step-utils.js";

export const marketResearcherWorkflow = createWorkflow({
  id: "market-researcher-workflow",
  description: "Sector primer — read research, spread comps, produce note",
  inputSchema: z.object({
    sector: z.string().describe("Sector or theme to research, or 'coverage-list <name>'"),
    angle: z.string().optional().describe("Analysis angle"),
  }),
  outputSchema: z.object({
    primer: z.string(),
    handoff: z.unknown().optional(),
  }),
})
  .then(
    defineStep({
      id: "read-sector",
      description: "Extract market-size, growth, and landscape facts from research (read+grep only, schema-validated)",
      inputSchema: z.object({ sector: z.string(), angle: z.string().optional() }),
      outputSchema: z.object({ overview: z.string(), handoff: z.unknown().optional() }),
      passthroughMapper: (input) => ({ overview: input.sector, handoff: input.handoff }),
      execute: async ({ input, mastra }) => {
        const coverageList = detectCoverageList(input.sector);
        if (coverageList) {
          const entries = fanOutCoverageList(input.sector, coverageList);
          const results = await Promise.all(
            entries.map(async (e) => {
              const res = await dispatchSubagent(mastra, "market-researcher/market-sector-reader",
                `Read third-party research and issuer materials for sector: ${e.ticker}, extract market-size, growth, and landscape facts. Return schema-validated JSON.`);
              return `${e.ticker}: ${res}`;
            })
          );
          return { overview: results.join("\n\n---\n\n") };
        }
        const result = await dispatchSubagent(mastra, "market-researcher/market-sector-reader",
          `Read third-party research and issuer materials for sector: ${input.sector}, extract market-size, growth, and landscape facts. ${input.angle ? `Angle: ${input.angle}. ` : ""}Return schema-validated JSON.`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { overview: result, handoff };
      },
    })
  )
  .then(
    defineStep({
      id: "spread-comps",
      description: "Pull trading multiples for defined peer set (read+grep+MCP)",
      inputSchema: z.object({ overview: z.string(), handoff: z.unknown().optional() }),
      outputSchema: z.object({ compsSpread: z.string(), handoff: z.unknown().optional() }),
      passthroughMapper: (input) => ({ compsSpread: input.overview, handoff: input.handoff }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagent(mastra, "market-researcher/market-comps-spreader",
          `Pull trading multiples for the peer set from CapIQ/FactSet MCP and spread them with consistent metric definitions. ${input.overview}`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { compsSpread: result, handoff };
      },
    })
  )
  .then(
    defineStep({
      id: "write-note",
      description: "Produce sector primer (ONLY leaf with Write, no MCP)",
      inputSchema: z.object({ compsSpread: z.string(), handoff: z.unknown().optional() }),
      outputSchema: z.object({ primer: z.string(), handoff: z.unknown().optional() }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagent(mastra, "market-researcher/market-note-writer",
          `Take the overview, landscape, comps spread, and ideas shortlist and produce ./out/primer-sector.docx. ${input.compsSpread}`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { primer: result, handoff };
      },
    })
  )
  .commit();
