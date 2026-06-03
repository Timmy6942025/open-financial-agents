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
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { loadCMACookbooks, type LoadedCMA } from "../lib/cma-loader.js";
import { connect as connectMCP } from "../mcp/mcp-client.js";
import { allCMATools } from "../tools/cma-tools.js";
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

// ── Storage ────────────────────────────────────────────────────────
const storage = new LibSQLStore({
  id: "mastra-storage",
  url: process.env.MASTRA_DB_URL || ":memory:",
});

// ── Shared memory instance ────────────────────────────────────────
// All agents that need conversation context share this Memory instance.
// Per-agent isolation is handled by Mastra via resourceId/threadId.
const sharedMemory = new Memory({
  storage,
  options: {
    lastMessages: 20,
    observationalMemory: true,
  },
});

// ── Per-agent memory overrides (working memory, semantic recall) ──
// Agents that need additional memory features get their own Memory
// instance with the appropriate options enabled.
const memoryInstances: Record<string, Memory> = {};

// Meeting-prep: working memory for client preferences and deal context
memoryInstances["meeting-prep-agent"] = new Memory({
  storage,
  options: {
    lastMessages: 20,
    observationalMemory: true,
    workingMemory: {
      enabled: true,
      scope: "resource",
      template: `# Client Profile
- **Client Name**:
- **Relationship Manager**:
- **Meeting Frequency**:
- **Key Preferences**:
- **Recent Topics**:
- **Open Items**:`,
    },
  },
});

// Pitch-agent: working memory for deal context and model assumptions
memoryInstances["pitch-agent"] = new Memory({
  storage,
  options: {
    lastMessages: 20,
    observationalMemory: true,
    workingMemory: {
      enabled: true,
      scope: "resource",
      template: `# Deal Context
- **Target Company**:
- **Acquirer** (if applicable):
- **Sector**:
- **Deal Type**:
- **Key Assumptions**:
- **Valuation Range**:
- **Status**:
- **Open Questions**:`,
    },
  },
});

// Earnings-reviewer: lastMessages only (semantic recall requires vector store)
memoryInstances["earnings-reviewer"] = sharedMemory;

// ── Load CMA cookbooks (single-pass: parents + subagents + skills + commands) ─
const cma: LoadedCMA = await loadCMACookbooks(memoryInstances);

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

if (gatewayProvider) {
  console.log(`\n✓ AI Gateway active — routing all models through Vercel AI Gateway`);
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

// Export for CLI and scripts
export { cma, allAgents };
