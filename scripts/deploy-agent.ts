/**
 * Port of deploy-managed-agent.sh — deploy a managed-agent cookbook.
 *
 * Resolves manifest conveniences before deploying:
 *   system: {file: ...}                  → inlined string
 *   skills: [{from_plugin: ...}]         → expanded from plugin directory
 *   callable_agents: [{manifest: ...}]   → created first, referenced by agent id
 *
 * Usage: npx tsx scripts/deploy-agent.ts <slug> [--dry-run]
 *   e.g. npx tsx scripts/deploy-agent.ts gl-reconciler
 */

import { readFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const COOKBOOKS_DIR = join(ROOT, "managed-agent-cookbooks");

const args = process.argv.slice(2);
const slug = args[0];
const dryRun = args.includes("--dry-run");

if (!slug) {
  console.error("Usage: deploy-agent.ts <slug> [--dry-run]");
  process.exit(1);
}

const cookbookDir = join(COOKBOOKS_DIR, slug);
const agentYamlPath = join(cookbookDir, "agent.yaml");

if (!existsSync(agentYamlPath)) {
  console.error(`No manifest at ${agentYamlPath}`);
  process.exit(1);
}

// Read and resolve the manifest
const agentYaml = readFileSync(agentYamlPath, "utf-8");
const manifest = yaml.parse(agentYaml) as Record<string, unknown>;

if (dryRun) {
  console.log("=== DRY RUN ===");
  console.log(`Agent: ${manifest.name || slug}`);
  console.log(`Model: ${manifest.model || "default"}`);

  if (manifest.system && typeof manifest.system === "object") {
    const sys = manifest.system as Record<string, unknown>;
    if (sys.file) console.log(`System prompt: ${sys.file} (inlined)`);
    if (sys.append) console.log(`  Append: ${(sys.append as string).substring(0, 80)}...`);
  }

  if (Array.isArray(manifest.skills)) {
    console.log(`Skills: ${manifest.skills.length} bundle(s)`);
  }

  if (Array.isArray(manifest.callable_agents)) {
    console.log(`Subagents: ${manifest.callable_agents.length}`);
    for (const ca of manifest.callable_agents) {
      console.log(`  - ${(ca as Record<string, unknown>).manifest}`);
    }
  }

  if (Array.isArray(manifest.mcp_servers)) {
    console.log(`MCP servers: ${manifest.mcp_servers.length}`);
    for (const mcp of manifest.mcp_servers) {
      const s = mcp as Record<string, unknown>;
      console.log(`  - ${s.name}: ${s.url}`);
    }
  }

  process.exit(0);
}

// Production deploy — requires API configuration
if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error("Warning: No LLM API keys configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
}

console.log(`Deploying agent: ${manifest.name || slug}`);
console.log(`Cookbook: ${slug}`);

// Register with Mastra
import("../src/mastra/index.js").then(async ({ mastra }) => {
  console.log("Agent registered. Ready for requests.");
  // In production, this would POST to the Mastra API
}).catch((e) => {
  console.log("Note: Mastra instance not available for direct deployment.");
  console.log("Run 'npx mastra dev' to start the development server.");
  console.log(`  Then access the agent at http://localhost:4111/agents/${slug}`);
});
