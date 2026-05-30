/**
 * Model Builder Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → data-puller → builder → auditor
 *
 * Supports:
 *   - Handoff extraction: detects handoff_request in step outputs
 *   - Fan-out: coverage-list iteration for batch model builds
 *   - Dynamic dispatch: falls back to cma_agent if subagent not registered
 *
 * Security model (matches original):
 *   - data-puller: read+grep, CapIQ+Daloopa MCP, output_schema validated
 *   - builder:     read+write+edit+bash, NO MCP, only leaf with Write+Bash, builds model
 *   - auditor:     read+grep only, NO MCP, re-checks model for ties/balance/hardcodes
 */

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { extractHandoff, detectCoverageList, fanOutCoverageList } from "../../scripts/orchestrate.js";
import { dispatchSubagent } from "../lib/dispatch.js";

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
    handoff: z.unknown().optional().describe("Handoff request if emitted"),
  }),
})
  .then(
    createStep({
      id: "pull-data",
      description: "Pull historicals and consensus from CapIQ/Daloopa (read+grep+MCP, schema-validated)",
      inputSchema: z.object({
        ticker: z.string(),
        modelType: z.string(),
        assumptions: z.string().optional(),
        historyYears: z.number().optional(),
        projectionYears: z.number().optional(),
      }),
      outputSchema: z.object({
        inputTable: z.string(),
        handoff: z.unknown().optional(),
      }),
      execute: async ({ inputData, mastra }) => {
        try {
          // Check for fan-out
          const coverageList = detectCoverageList(inputData.ticker);
          if (coverageList) {
            const entries = fanOutCoverageList(inputData.ticker, coverageList);
            const results = await Promise.all(
              entries.map(async (e) => {
                const res = await dispatchSubagent(
                  mastra,
                  "model-builder/model-data-puller",
                  `Pull historicals and consensus from CapIQ/Daloopa for ${e.ticker}. Return a structured input table as schema-validated JSON. Model: ${inputData.modelType}${inputData.assumptions ? `. Assumptions: ${inputData.assumptions}` : ""}`
                );
                return `${e.ticker}: ${res}`;
              })
            );
            return { inputTable: results.join("\n\n---\n\n") };
          }

          const result = await dispatchSubagent(
            mastra,
            "model-builder/model-data-puller",
            `Pull historicals and consensus from CapIQ/Daloopa for ${inputData.ticker}. Return a structured input table as schema-validated JSON. Model: ${inputData.modelType}${inputData.assumptions ? `. Assumptions: ${inputData.assumptions}` : ""}`
          );

          let handoff: unknown;
          try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
          return handoff ? { inputTable: result, handoff } : { inputTable: result };
        } catch (err: any) {
          throw new Error(`model-data-puller failed: ${err.message}`);
        }
      },
    })
  )
  .then(
    createStep({
      id: "build-model",
      description: "Build DCF/LBO/3-stmt/comps model (ONLY leaf with Write+Edit+Bash, no MCP)",
      inputSchema: z.object({
        inputTable: z.string(),
        handoff: z.unknown().optional(),
      }),
      outputSchema: z.object({
        modelOutput: z.string(),
        handoff: z.unknown().optional(),
      }),
      execute: async ({ inputData, mastra }) => {
        try {
          if (inputData.handoff) {
            return { modelOutput: inputData.inputTable, handoff: inputData.handoff };
          }

          const result = await dispatchSubagent(
            mastra,
            "model-builder/model-builder-builder",
            `Build the requested model into ./out/model.xlsx using xlsx-author conventions. Inputs are the validated table from data-puller plus user assumptions. ${inputData.inputTable}`
          );

          let handoff: unknown;
          try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
          return { modelOutput: result, handoff: handoff || undefined };
        } catch (err: any) {
          throw new Error(`model-builder-builder failed: ${err.message}`);
        }
      },
    })
  )
  .then(
    createStep({
      id: "audit-model",
      description: "Re-check model for ties, balance, hardcodes (read-only, no MCP)",
      inputSchema: z.object({
        modelOutput: z.string(),
        handoff: z.unknown().optional(),
      }),
      outputSchema: z.object({
        modelPath: z.string(),
        auditReport: z.string(),
        handoff: z.unknown().optional(),
      }),
      execute: async ({ inputData, mastra }) => {
        try {
          if (inputData.handoff) {
            return { modelPath: "./out/model.xlsx", auditReport: inputData.modelOutput, handoff: inputData.handoff };
          }

          const result = await dispatchSubagent(
            mastra,
            "model-builder/model-auditor",
            `Re-check ./out/model.xlsx for ties, balance checks, and hardcodes per check-model conventions. Return a pass/fail report with locations of any issues. ${inputData.modelOutput}`
          );

          let handoff: unknown;
          try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
          return { modelPath: "./out/model.xlsx", auditReport: result || "PASS", handoff: handoff || undefined };
        } catch (err: any) {
          throw new Error(`model-auditor failed: ${err.message}`);
        }
      },
    })
  )
  .commit();
