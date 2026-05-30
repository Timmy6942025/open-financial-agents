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
import { loadCMACookbooks, type LoadedCMA } from "../lib/cma-loader.js";
import { connect as connectMCP } from "../mcp/mcp-client.js";
import { allCMATools } from "../tools/cma-tools.js";
import { setMastraInstance } from "../tools/cma-agent-tool.js";
import { routeHandoff } from "../../scripts/orchestrate.js";

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

console.log(
  `\n✓ Registered ${Object.keys(allAgents).length} agents ` +
  `(${Object.keys(cma.parents).length} orchestrators + ` +
  `${Object.keys(cma.subagents).length} subagents)` +
  `${cma.subagentIds.length > 0 ? ` — dynamic dispatch: ${cma.subagentIds.length} targets` : ""}`
);

// ── Initialize Mastra ──────────────────────────────────────────────
export const mastra = new Mastra({
  agents: allAgents,
  tools: allCMATools,
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

// Wire up the Mastra instance for cma_agent dynamic dispatch
setMastraInstance(mastra as any);

// Export for CLI, scripts, and handoff routing
export { cma, allAgents };
export { routeHandoff };
