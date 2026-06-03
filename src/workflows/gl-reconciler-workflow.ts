/**
 * GL Reconciler Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → reader → critic → resolver
 *
 * Supports direct agent dispatch via Mastra.
 */

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { dispatchAgent } from "../../scripts/orchestrate.js";

export const glReconcilerWorkflow = createWorkflow({
  id: "gl-reconciler-workflow",
  description: "Reconcile GL vs subledger — find breaks, verify, resolve",
  inputSchema: z.object({
    tradeDate: z.string().describe("Trade date to reconcile"),
    assetClasses: z.string().describe("Asset classes to reconcile (comma-separated)"),
  }),
  outputSchema: z.object({
    report: z.string(),
  }),
})
  .then(
    createStep({
      id: "read-statements",
      description: "Read counterparty statements and extract candidate breaks (read+grep only, no MCP)",
      inputSchema: z.object({ tradeDate: z.string(), assetClasses: z.string() }),
      outputSchema: z.object({ breaks: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(mastra, "gl-reconciler/gl-reconciler-reader",
          `Read counterparty and custodian statements for asset classes: ${inputData.assetClasses}, trade date: ${inputData.tradeDate}. Extract candidate GL/subledger breaks. Return schema-validated JSON.`);
        return { breaks: result };
      },
    })
  )
  .then(
    createStep({
      id: "verify-breaks",
      description: "Re-verify each break against GL and subledger MCPs (read+grep+MCP)",
      inputSchema: z.object({ breaks: z.string() }),
      outputSchema: z.object({ verified: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(mastra, "gl-reconciler/gl-reconciler-critic",
          `Re-verify each reported break against the GL and subledger MCPs. Return confirmed/rejected per break. ${inputData.breaks}`);
        return { verified: result };
      },
    })
  )
  .then(
    createStep({
      id: "resolve",
      description: "Draft exception report and write to ./out/ (ONLY leaf with Write, no MCP)",
      inputSchema: z.object({ verified: z.string() }),
      outputSchema: z.object({ report: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(mastra, "gl-reconciler/gl-reconciler-resolver",
          `Receive the verified break set, draft the exception report, and write it to ./out/. ${inputData.verified}`);
        return { report: result };
      },
    })
  )
  .commit();
