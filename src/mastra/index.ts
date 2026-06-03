/**
 * Mastra entry point
 *
 * Single-pass agent loading via CMA cookbooks (which also loads agent.md
 * files and augments them with skills, commands, steering examples, and
 * tool gating). No separate legacy loader — CMA is the source of truth.
 *
 * Cross-agent handoffs are routed via orchestrate.ts when a workflow step
 * emits a handoff_request in its output.
 */

import { Mastra } from "@mastra/core/mastra";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { loadCMACookbooks, type LoadedCMA } from "../lib/cma-loader.js";
import { connect as connectMCP } from "../mcp/mcp-client.js";
import { allCMATools } from "../tools/cma-tools.js";
import { routeHandoff } from "../../scripts/orchestrate.js";
import { gatewayProvider } from "../lib/model-router.js";

import { pitchWorkflow } from "../workflows/pitch-workflow.js";
import { glReconcilerWorkflow } from "../workflows/gl-reconciler-workflow.js";
import { marketResearcherWorkflow } from "../workflows/market-researcher-workflow.js";
import { earningsReviewerWorkflow } from "../workflows/earnings-reviewer-workflow.js";
import { meetingPrepWorkflow } from "../workflows/meeting-prep-workflow.js";
import { modelBuilderWorkflow } from "../workflows/model-builder-workflow.js";
import { kycScreenerWorkflow } from "../workflows/kyc-screener-workflow.js";
import { valuationReviewerWorkflow } from "../workflows/valuation-reviewer-workflow.js";
import { monthEndCloserWorkflow } from "../workflows/month-end-closer-workflow.js";
import { statementAuditorWorkflow } from "../workflows/statement-auditor-workflow.js";

// ── Initialize MCP ─────────────────────────────────────────────────
await connectMCP();

// ── Load CMA cookbooks (single-pass: parents + subagents + skills + commands) ─
const cma: LoadedCMA = await loadCMACookbooks();

// Build the full agents map for Mastra:
// - CMA parent orchestrators registered by cookbook name
// - CMA subagents registered by "cookbook/subagentName" for workflow dispatch
const allAgents: Record<string, any> = {};

for (const [cookbookName, parentAgent] of Object.entries(cma.parents)) {
  allAgents[cookbookName] = parentAgent;
}

for (const [key, entry] of Object.entries(cma.subagents)) {
  allAgents[key] = entry.agent;
}

// Override agent models to use AI Gateway when configured
if (gatewayProvider) {
  for (const [name, agent] of Object.entries(allAgents)) {
    const currentModel = (agent as any).model;
    if (typeof currentModel === "string") {
      (agent as any).model = gatewayProvider.languageModel(currentModel);
    }
  }
  console.log(`\n✓ AI Gateway active — routing all models through Vercel AI Gateway`);
}

console.log(
  `\n✓ Registered ${Object.keys(allAgents).length} agents ` +
  `(${Object.keys(cma.parents).length} orchestrators + ` +
  `${Object.keys(cma.subagents).length} subagents)` +
  `${cma.subagentIds.length > 0 ? ` — dynamic dispatch: ${cma.subagentIds.length} targets` : ""}`
);

// ── Initialize Mastra ──────────────────────────────────────────────
const storage = new LibSQLStore({
  id: "mastra-storage",
  url: process.env.MASTRA_DB_URL || ":memory:",
});

export const mastra = new Mastra({
  agents: allAgents,
  tools: allCMATools,
  storage,
  workflows: {
    pitchWorkflow,
    glReconcilerWorkflow,
    marketResearcherWorkflow,
    earningsReviewerWorkflow,
    meetingPrepWorkflow,
    modelBuilderWorkflow,
    kycScreenerWorkflow,
    valuationReviewerWorkflow,
    monthEndCloserWorkflow,
    statementAuditorWorkflow,
  },
});

// ── Add memory to agents that benefit from conversation context ────
const memoryConfig = {
  lastMessages: 20,
  observationalMemory: true,
};

const MEMORY_AGENTS = ["meeting-prep-agent", "earnings-reviewer", "pitch-agent"];
for (const agentName of MEMORY_AGENTS) {
  const agent = mastra.getAgent(agentName);
  if (agent) {
    (agent as any).memory = new Memory({
      storage,
      options: memoryConfig,
    });
  }
}

// Export for CLI, scripts, and handoff routing
export { cma, allAgents };
export { routeHandoff };
