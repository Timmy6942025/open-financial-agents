/**
 * KYC Screener Workflow
 *
 * CMA depth-1 dispatch with dynamic fallback:
 *   orchestrator → doc-reader → rules-engine → escalator
 *
 * Supports direct agent dispatch via Mastra.
 */

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { dispatchAgent } from "../../scripts/orchestrate.js";

export const kycScreenerWorkflow = createWorkflow({
  id: "kyc-screener-workflow",
  description: "Screen onboarding packet — parse docs, run rules, escalate",
  inputSchema: z.object({
    packetId: z.string().describe("Onboarding packet identifier"),
  }),
  outputSchema: z.object({
    escalation: z.string(),
  }),
})
  .then(
    createStep({
      id: "read-docs",
      description: "Extract entity fields from onboarding docs (read+grep only, no MCP)",
      inputSchema: z.object({ packetId: z.string() }),
      outputSchema: z.object({ entity: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(mastra, "kyc-screener/kyc-doc-reader",
          `Read onboarding documents for packet ${inputData.packetId}. Extract structured entity fields. Return schema-validated JSON.`);
        return { entity: result };
      },
    })
  )
  .then(
    createStep({
      id: "run-rules",
      description: "Evaluate KYC/AML rules and run sanctions screening (read+grep+MCP)",
      inputSchema: z.object({ entity: z.string() }),
      outputSchema: z.object({ rulesResult: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(mastra, "kyc-screener/kyc-rules-engine",
          `Evaluate KYC/AML rules against the validated entity file and run sanctions/PEP screening via the screening MCP. Return pass/fail per rule. ${inputData.entity}`);
        return { rulesResult: result };
      },
    })
  )
  .then(
    createStep({
      id: "escalate",
      description: "Produce escalation report (ONLY leaf with Write, no MCP)",
      inputSchema: z.object({ rulesResult: z.string() }),
      outputSchema: z.object({ escalation: z.string() }),
      execute: async ({ inputData, mastra }) => {
        const result = await dispatchAgent(mastra, "kyc-screener/kyc-escalator",
          `Take the rules result and screening hits and produce ./out/escalation-packet.xlsx for compliance sign-off. ${inputData.rulesResult}`);
        return { escalation: result };
      },
    })
  )
  .commit();
