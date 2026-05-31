/**
 * KYC Screener Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → doc-reader → rules-engine → escalator
 *
 * Supports handoff extraction and dynamic dispatch.
 */

import { createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { extractHandoff } from "../../scripts/orchestrate.js";
import { dispatchSubagent } from "../lib/dispatch.js";
import { defineStep } from "../lib/step-utils.js";

export const kycScreenerWorkflow = createWorkflow({
  id: "kyc-screener-workflow",
  description: "Screen onboarding packet — parse docs, run rules, escalate",
  inputSchema: z.object({
    packetId: z.string().describe("Onboarding packet identifier"),
  }),
  outputSchema: z.object({
    escalation: z.string(),
    handoff: z.unknown().optional(),
  }),
})
  .then(
    defineStep({
      id: "read-docs",
      description: "Extract entity fields from onboarding docs (read+grep only, no MCP, schema-validated)",
      inputSchema: z.object({ packetId: z.string() }),
      outputSchema: z.object({ entity: z.string(), handoff: z.unknown().optional() }),
      passthroughMapper: (input) => ({ entity: input.packetId, handoff: input.handoff }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagent(mastra, "kyc-screener/kyc-doc-reader",
          `Read onboarding documents for packet ${input.packetId}. Extract structured entity fields. Return schema-validated JSON.`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { entity: result, handoff };
      },
    })
  )
  .then(
    defineStep({
      id: "run-rules",
      description: "Evaluate KYC/AML rules and run sanctions screening (read+grep+MCP)",
      inputSchema: z.object({ entity: z.string(), handoff: z.unknown().optional() }),
      outputSchema: z.object({ rulesResult: z.string(), handoff: z.unknown().optional() }),
      passthroughMapper: (input) => ({ rulesResult: input.entity, handoff: input.handoff }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagent(mastra, "kyc-screener/kyc-rules-engine",
          `Evaluate KYC/AML rules against the validated entity file and run sanctions/PEP screening via the screening MCP. Return pass/fail per rule. ${input.entity}`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { rulesResult: result, handoff };
      },
    })
  )
  .then(
    defineStep({
      id: "escalate",
      description: "Produce escalation report (ONLY leaf with Write, no MCP)",
      inputSchema: z.object({ rulesResult: z.string(), handoff: z.unknown().optional() }),
      outputSchema: z.object({ escalation: z.string(), handoff: z.unknown().optional() }),
      execute: async ({ input, mastra }) => {
        const result = await dispatchSubagent(mastra, "kyc-screener/kyc-escalator",
          `Take the rules result and screening hits and produce ./out/escalation-packet.xlsx for compliance sign-off. ${input.rulesResult}`);
        let handoff: unknown;
        try { handoff = extractHandoff(result); } catch { /* not JSON, skip */ }
        return { escalation: result, handoff };
      },
    })
  )
  .commit();
