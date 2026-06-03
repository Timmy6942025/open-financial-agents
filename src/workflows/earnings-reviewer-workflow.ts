/**
 * Earnings Reviewer Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → transcript-reader → model-updater → note-writer
 *
 * Supports handoff extraction, fan-out, and dynamic dispatch.
 */

import { createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { extractHandoff, detectCoverageList, fanOutCoverageList } from "../../scripts/orchestrate.js";
import { dispatchSubagentValidated } from "../lib/dispatch.js";
import { defineStep } from "../lib/step-utils.js";

export const earningsReviewerWorkflow = createWorkflow({
  id: "earnings-reviewer-workflow",
  description: "Earnings call + filings → model update → note draft",
  inputSchema: z.object({
    ticker: z.string().describe("Ticker or 'coverage-list <name>' for batch"),
    period: z.string().describe("Reporting period (e.g., Q1-FY27)"),
    skipNote: z.boolean().optional().describe("If true, skip note drafting"),
  }),
  outputSchema: z.object({
    note: z.string(),
    model: z.string(),
    handoff: z.unknown().optional(),
  }),
})
  .then(
    defineStep({
      id: "read-transcript",
      description: "Extract reported figures from earnings transcript (read+grep only, no MCP, schema-validated)",
      inputSchema: z.object({ ticker: z.string(), period: z.string() }),
      outputSchema: z.object({ actuals: z.string(), handoff: z.unknown().optional() }),
      passthroughMapper: (input) => ({ actuals: input.ticker, handoff: input.handoff }),
      execute: async ({ input, mastra }) => {
        const coverageList = detectCoverageList(input.ticker);
        if (coverageList) {
          const entries = fanOutCoverageList(input.ticker, coverageList);
          const results = await Promise.all(
            entries.map(async (e) => {
              const res = await dispatchSubagentValidated(mastra, "earnings-reviewer/earnings-transcript-reader",
                `Read earnings transcript for ${e.ticker} period ${input.period}. Extract reported figures, guidance, and notable Q&A. Return schema-validated JSON.`);
              return `${e.ticker}: ${res}`;
            })
          );
          return { actuals: results.join("\n\n---\n\n") };
        }
        const result = await dispatchSubagentValidated(mastra, "earnings-reviewer/earnings-transcript-reader",
          `Read earnings transcript for ${input.ticker} period ${input.period}. Extract reported figures, guidance, and notable Q&A. Return schema-validated JSON.`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { actuals: result, handoff };
      },
    })
  )
  .then(
    defineStep({
      id: "update-model",
      description: "Drop actuals into model and roll estimates (read+grep+glob+MCP)",
      inputSchema: z.object({ actuals: z.string(), handoff: z.unknown().optional() }),
      outputSchema: z.object({ varianceTable: z.string(), handoff: z.unknown().optional() }),
      passthroughMapper: (input) => ({ varianceTable: input.actuals, handoff: input.handoff }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagentValidated(mastra, "earnings-reviewer/earnings-model-updater",
          `Drop validated actuals into the coverage model and roll estimates using FactSet/Daloopa for consensus. Return the variance table. ${input.actuals}`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { varianceTable: result, handoff };
      },
    })
  )
  .then(
    defineStep({
      id: "write-note",
      description: "Produce note draft (ONLY leaf with Write, no MCP)",
      inputSchema: z.object({ varianceTable: z.string(), handoff: z.unknown().optional() }),
      outputSchema: z.object({ note: z.string(), model: z.string(), handoff: z.unknown().optional() }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagentValidated(mastra, "earnings-reviewer/earnings-note-writer",
          `Take the variance table and produce ./out/model-ticker.xlsx and ./out/note-ticker.docx. ${input.varianceTable}`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { note: result, model: "./out/model.xlsx", handoff };
      },
    })
  )
  .commit();
