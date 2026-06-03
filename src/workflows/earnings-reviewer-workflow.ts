/**
 * Earnings Reviewer Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → transcript-reader → model-updater → note-writer
 *
 * Supports fan-out and direct agent dispatch via Mastra.
 */

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { dispatchAgent, detectCoverageList, fanOutCoverageList } from "../../scripts/orchestrate.js";

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
  }),
})
  .then(
    createStep({
      id: "read-transcript",
      description: "Extract reported figures from earnings transcript (read+grep only, no MCP)",
      inputSchema: z.object({ ticker: z.string(), period: z.string() }),
      outputSchema: z.object({ actuals: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const coverageList = detectCoverageList(inputData.ticker);
        if (coverageList) {
          const entries = fanOutCoverageList(inputData.ticker, coverageList);
          const results = await Promise.all(
            entries.map(async (e) => {
              const res = await dispatchAgent(mastra, "earnings-reviewer/earnings-transcript-reader",
                `Read earnings transcript for ${e.ticker} period ${inputData.period}. Extract reported figures, guidance, and notable Q&A. Return schema-validated JSON.`);
              return `${e.ticker}: ${res}`;
            })
          );
          return { actuals: results.join("\n\n---\n\n") };
        }
        const result = await dispatchAgent(mastra, "earnings-reviewer/earnings-transcript-reader",
          `Read earnings transcript for ${inputData.ticker} period ${inputData.period}. Extract reported figures, guidance, and notable Q&A. Return schema-validated JSON.`);
        return { actuals: result };
      },
    })
  )
  .then(
    createStep({
      id: "update-model",
      description: "Drop actuals into model and roll estimates (read+grep+glob+MCP)",
      inputSchema: z.object({ actuals: z.string() }),
      outputSchema: z.object({ varianceTable: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(mastra, "earnings-reviewer/earnings-model-updater",
          `Drop validated actuals into the coverage model and roll estimates using FactSet/Daloopa for consensus. Return the variance table. ${inputData.actuals}`);
        return { varianceTable: result };
      },
    })
  )
  .then(
    createStep({
      id: "write-note",
      description: "Produce note draft (ONLY leaf with Write, no MCP)",
      inputSchema: z.object({ varianceTable: z.string() }),
      outputSchema: z.object({ note: z.string(), model: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(mastra, "earnings-reviewer/earnings-note-writer",
          `Take the variance table and produce ./out/model-ticker.xlsx and ./out/note-ticker.docx. ${inputData.varianceTable}`);
        return { note: result, model: "./out/model.xlsx" };
      },
    })
  )
  .commit();
