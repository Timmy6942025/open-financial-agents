/**
 * GL Reconciler Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → reader → critic → resolver
 *
 * Supports handoff extraction, fan-out, and dynamic dispatch.
 */

import { createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { extractHandoff } from "../../scripts/orchestrate.js";
import { dispatchSubagent } from "../lib/dispatch.js";
import { defineStep } from "../lib/step-utils.js";

export const glReconcilerWorkflow = createWorkflow({
  id: "gl-reconciler-workflow",
  description: "Reconcile GL vs subledger — find breaks, verify, resolve",
  inputSchema: z.object({
    tradeDate: z.string().describe("Trade date to reconcile"),
    assetClasses: z.string().describe("Asset classes to reconcile (comma-separated)"),
  }),
  outputSchema: z.object({
    report: z.string(),
    handoff: z.unknown().optional(),
  }),
})
  .then(
    defineStep({
      id: "read-statements",
      description: "Read counterparty statements and extract candidate breaks (read+grep only, no MCP, schema-validated)",
      inputSchema: z.object({ tradeDate: z.string(), assetClasses: z.string() }),
      outputSchema: z.object({ breaks: z.string(), handoff: z.unknown().optional() }),
      passthroughMapper: (input) => ({ breaks: input.tradeDate, handoff: input.handoff }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagent(mastra, "gl-reconciler/gl-reconciler-reader",
          `Read counterparty and custodian statements for asset classes: ${input.assetClasses}, trade date: ${input.tradeDate}. Extract candidate GL/subledger breaks. Return schema-validated JSON.`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { breaks: result, handoff };
      },
    })
  )
  .then(
    defineStep({
      id: "verify-breaks",
      description: "Re-verify each break against GL and subledger MCPs (read+grep+MCP)",
      inputSchema: z.object({ breaks: z.string(), handoff: z.unknown().optional() }),
      outputSchema: z.object({ verified: z.string(), handoff: z.unknown().optional() }),
      passthroughMapper: (input) => ({ verified: input.breaks, handoff: input.handoff }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagent(mastra, "gl-reconciler/gl-reconciler-critic",
          `Re-verify each reported break against the GL and subledger MCPs. Return confirmed/rejected per break. ${input.breaks}`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { verified: result, handoff };
      },
    })
  )
  .then(
    defineStep({
      id: "resolve",
      description: "Draft exception report and write to ./out/ (ONLY leaf with Write, no MCP)",
      inputSchema: z.object({ verified: z.string(), handoff: z.unknown().optional() }),
      outputSchema: z.object({ report: z.string(), handoff: z.unknown().optional() }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagent(mastra, "gl-reconciler/gl-reconciler-resolver",
          `Receive the verified break set, draft the exception report, and write it to ./out/. ${input.verified}`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { report: result, handoff };
      },
    })
  )
  .commit();
