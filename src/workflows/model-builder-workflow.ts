/**
 * Model Builder Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → data-puller → builder → auditor
 *
 * Supports fan-out and direct agent dispatch via Mastra.
 *
 * Security model (matches original):
 *   - data-puller: read+grep, CapIQ+Daloopa MCP
 *   - builder:     read+write+edit+bash, NO MCP, only leaf with Write+Bash
 *   - auditor:     read+grep only, NO MCP, re-checks model
 */

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { dispatchAgent, detectCoverageList, fanOutCoverageList } from "../../scripts/orchestrate.js";

export const modelBuilderWorkflow = createWorkflow({
  id: "model-builder-workflow",
  description: "Build financial model — pull data, build, audit QC. Supports fan-out across coverage lists.",
  inputSchema: z.object({
    ticker: z.string().describe("Company ticker, or 'coverage-list <name>' for batch"),
    modelType: z.string().describe("Model type: dcf, lbo, 3-stmt, comps"),
    assumptions: z.string().optional().describe("Assumptions as JSON string"),
    historyYears: z.number().optional(),
    projectionYears: z.number().optional(),
  }),
  outputSchema: z.object({
    modelPath: z.string().describe("Path to model workbook"),
    auditReport: z.string().describe("Audit pass/fail report"),
  }),
})
  .then(
    createStep({
      id: "pull-data",
      description: "Pull historicals and consensus from CapIQ/Daloopa (read+grep+MCP)",
      inputSchema: z.object({
        ticker: z.string(),
        modelType: z.string(),
        assumptions: z.string().optional(),
        historyYears: z.number().optional(),
        projectionYears: z.number().optional(),
      }),
      outputSchema: z.object({
        inputTable: z.string(),
      }),
      execute: async ({ inputData, mastra }) => {
        const coverageList = detectCoverageList(inputData.ticker);
        if (coverageList) {
          const entries = fanOutCoverageList(inputData.ticker, coverageList);
          const results = await Promise.all(
            entries.map(async (e) => {
              const res = await dispatchAgent(
                mastra,
                "model-builder/model-data-puller",
                `Pull historicals and consensus from CapIQ/Daloopa for ${e.ticker}. Return a structured input table as schema-validated JSON. Model: ${inputData.modelType}${inputData.assumptions ? `. Assumptions: ${inputData.assumptions}` : ""}`
              );
              return `${e.ticker}: ${res}`;
            })
          );
          return { inputTable: results.join("\n\n---\n\n") };
        }

        const result = await dispatchAgent(
          mastra,
          "model-builder/model-data-puller",
          `Pull historicals and consensus from CapIQ/Daloopa for ${inputData.ticker}. Return a structured input table as schema-validated JSON. Model: ${inputData.modelType}${inputData.assumptions ? `. Assumptions: ${inputData.assumptions}` : ""}`
        );

        return { inputTable: result };
      },
    })
  )
  .then(
    createStep({
      id: "build-model",
      description: "Build DCF/LBO/3-stmt/comps model (ONLY leaf with Write+Edit+Bash, no MCP)",
      inputSchema: z.object({
        inputTable: z.string(),
      }),
      outputSchema: z.object({
        modelOutput: z.string(),
      }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(
          mastra,
          "model-builder/model-builder-builder",
          `Build the requested model into ./out/model.xlsx using xlsx-author conventions. Inputs are the validated table from data-puller plus user assumptions. ${inputData.inputTable}`
        );

        return { modelOutput: result };
      },
    })
  )
  .then(
    createStep({
      id: "audit-model",
      description: "Re-check model for ties, balance, hardcodes (read-only, no MCP)",
      inputSchema: z.object({
        modelOutput: z.string(),
      }),
      outputSchema: z.object({
        modelPath: z.string(),
        auditReport: z.string(),
      }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(
          mastra,
          "model-builder/model-auditor",
          `Re-check ./out/model.xlsx for ties, balance checks, and hardcodes per check-model conventions. Return a pass/fail report with locations of any issues. ${inputData.modelOutput}`
        );

        return { modelPath: "./out/model.xlsx", auditReport: result || "PASS" };
      },
    })
  )
  .commit();
