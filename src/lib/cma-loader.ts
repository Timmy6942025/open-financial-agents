/**
 * CMA (Claude Managed Agent) Cookbook Loader
 *
 * Parses managed-agent-cookbooks agent.yaml and subagents YAML files
 * into Mastra Agent instances with faithful reproduction of:
 *
 *  - CMA tool gating (Read/Grep/Glob vs Write/Edit/Bash per subagent)
 *  - MCP server routing (only the servers declared per subagent)
 *  - Guardrail processors (prompt injection, PII detection, moderation)
 *  - Steering examples (few-shot examples in parent system prompt)
 *  - Skill loading (51 SKILL.md files resolved and injected)
 *  - Slash commands (46 command references in parent context)
 *  - Dynamic subagent dispatch (cma_agent tool for runtime delegation)
 *  - Model selection (claude-opus-4-7 → anthropic/claude-opus-4-7)
 *
 * Architecture matches the original CMA depth-1 tree:
 *   Parent orchestrator → subagent1 (reader) → subagent2 (processor) → subagent3 (writer)
 *
 * Single-pass loading: replaces the separate legacy agent-loader by
 * using agent.md files directly, augmented with CMA cookbook config.
 */

import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import {
  PromptInjectionDetector,
  PIIDetector,
  ModerationProcessor,
  ProcessorStepSchema,
} from "@mastra/core/processors";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import yaml from "js-yaml";
import { resolveModelForAgent, resolveModelString } from "./model-router.js";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { DynamicArgument } from "@mastra/core/types";
import { listTools as listMCPTools } from "../mcp/mcp-client.js";
import { CMA_TOOLS } from "../tools/cma-tools.js";
import {
  loadAllCMASkills,
  resolveSubagentSkills,
  resolveAgentMarkdownSkills,
  formatSkillsForPrompt,
  type LoadedSkill,
} from "./cma-skill-loader.js";
import { loadCommands } from "./command-loader.js";
import { createTool } from "@mastra/core/tools";
import type { Tool } from "@mastra/core/tools";

// ── Guardrail processor factory ──────────────────────────────────────

/**
 * Agents that handle untrusted external documents (KYC, earnings, market research)
 * need prompt injection detection to prevent adversarial content from hijacking.
 */
const INJECTION_DETECTED_AGENTS = new Set([
  "kyc-screener",
  "earnings-reviewer",
  "market-researcher",
  "meeting-prep-agent",
]);

/**
 * Agents that handle client PII (meeting prep, KYC) need PII detection
 * to redact sensitive information from outputs.
 */
const PII_DETECTED_AGENTS = new Set([
  "kyc-screener",
  "meeting-prep-agent",
]);

/**
 * Audit log for processor violations. In production, wire to Datadog/Sentry.
 */
function logProcessorViolation(violation: { processorId: string; message: string; detail?: unknown }) {
  console.warn(`[guardrail] ${violation.processorId}: ${violation.message}`, violation.detail ?? "");
}

/** Set onViolation callback on a processor (typed as any to work around class type limitations) */
function setOnViolation(processor: any, cb: typeof logProcessorViolation) {
  processor.onViolation = cb;
}

/**
 * Build a parallel processor workflow for agents needing multiple guardrails.
 * Runs PII detection and prompt injection detection concurrently, then
 * merges results via .map().
 *
 * Returns a workflow that can be passed directly to `inputProcessors`.
 */
function buildParallelGuardrailWorkflow(agentName: string) {
  const needsInjection = INJECTION_DETECTED_AGENTS.has(agentName);
  const needsPII = PII_DETECTED_AGENTS.has(agentName);

  if (!needsInjection && !needsPII) return null;

  const branches: any[] = [];

  if (needsInjection) {
    const detector = new PromptInjectionDetector({
      model: resolveModelString("openai/gpt-5-nano"),
      threshold: 0.8,
      strategy: "rewrite",
      detectionTypes: ["injection", "jailbreak", "system-override"],
    });
    setOnViolation(detector, logProcessorViolation);
    branches.push(createStep(detector));
  }

  if (needsPII) {
    const detector = new PIIDetector({
      model: resolveModelString("openai/gpt-5-nano"),
      threshold: 0.6,
      strategy: "redact",
      redactionMethod: "mask",
      detectionTypes: ["email", "phone", "credit-card"],
    });
    setOnViolation(detector, logProcessorViolation);
    branches.push(createStep(detector));
  }

  // Single branch — no workflow needed
  if (branches.length === 1) return null;

  // Multiple branches — run in parallel via workflow
  const workflow = createWorkflow({
    id: `guardrail-${agentName}`,
    inputSchema: ProcessorStepSchema,
    outputSchema: ProcessorStepSchema,
  })
    .parallel(branches)
    .map(async ({ inputData }) => {
      // Select injection detector output if available, otherwise PII
      return inputData["processor:prompt-injection-detector"]
        ?? inputData["processor:pii-detector"]
        ?? inputData[Object.keys(inputData)[0]];
    })
    .commit();

  return workflow;
}

/**
 * Build input processors for an agent based on its role.
 *
 * For agents needing multiple guardrails (e.g., kyc-screener needs both
 * PII + injection), returns a parallel workflow that runs them concurrently.
 * For agents needing a single guardrail, returns a simple array.
 */
function getAgentInputProcessors(agentName: string): any[] {
  const parallelWorkflow = buildParallelGuardrailWorkflow(agentName);
  if (parallelWorkflow) return [parallelWorkflow];

  // Single processor or none
  const processors: any[] = [];

  if (INJECTION_DETECTED_AGENTS.has(agentName)) {
    const detector = new PromptInjectionDetector({
      model: resolveModelString("openai/gpt-5-nano"),
      threshold: 0.8,
      strategy: "rewrite",
      detectionTypes: ["injection", "jailbreak", "system-override"],
    });
    setOnViolation(detector, logProcessorViolation);
    processors.push(detector);
  }

  if (PII_DETECTED_AGENTS.has(agentName)) {
    const detector = new PIIDetector({
      model: resolveModelString("openai/gpt-5-nano"),
      threshold: 0.6,
      strategy: "redact",
      redactionMethod: "mask",
      detectionTypes: ["email", "phone", "credit-card"],
    });
    setOnViolation(detector, logProcessorViolation);
    processors.push(detector);
  }

  return processors;
}

/**
 * Build output processors for an agent.
 * All agents get moderation; PII-sensitive agents also get PII redaction.
 */
function getAgentOutputProcessors(agentName: string): any[] {
  const moderation = new ModerationProcessor({
    model: resolveModelString("openai/gpt-5-nano"),
    threshold: 0.7,
    strategy: "block",
    categories: ["hate", "harassment", "violence"],
  });
  setOnViolation(moderation, logProcessorViolation);

  const processors: any[] = [moderation];

  if (PII_DETECTED_AGENTS.has(agentName)) {
    const pii = new PIIDetector({
      model: resolveModelString("openai/gpt-5-nano"),
      threshold: 0.6,
      strategy: "redact",
      redactionMethod: "mask",
      detectionTypes: ["email", "phone", "credit-card"],
    });
    setOnViolation(pii, logProcessorViolation);
    processors.push(pii);
  }

  return processors;
}

// ── Path resolution ────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKBOOKS_DIR = join(__dirname, "..", "..", "managed-agent-cookbooks");

// ── YAML type definitions ──────────────────────────────────────────
interface ToolConfig {
  name: string;
  enabled: boolean;
}

interface AgentToolset {
  type: "agent_toolset_20260401";
  default_config: { enabled: boolean };
  configs: ToolConfig[];
}

interface MCPToolset {
  type: "mcp_toolset";
  mcp_server_name: string;
  default_config: { enabled: boolean };
}

interface MCPServerDef {
  type: string;
  name: string;
  url: string;
}

interface SkillDef {
  from_plugin?: string;
  path?: string;
}

interface CallableAgent {
  manifest: string;
}

interface AgentYAML {
  name: string;
  model: string;
  system: {
    file?: string;
    text?: string;
    append?: string;
  };
  tools: (AgentToolset | MCPToolset)[];
  mcp_servers: MCPServerDef[];
  skills: SkillDef[];
  callable_agents: CallableAgent[];
}

interface OutputSchemaProperty {
  type?: string;
  enum?: string[];
  maxLength?: number;
  pattern?: string;
  items?: OutputSchemaProperty | Record<string, OutputSchemaProperty>;
  properties?: Record<string, OutputSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | { type: string };
}

export interface OutputSchema {
  type: "object";
  required: string[];
  additionalProperties: boolean;
  properties: Record<string, OutputSchemaProperty>;
}

interface SubagentYAML {
  name: string;
  model: string;
  system: { text: string; file?: string };
  tools: (AgentToolset | MCPToolset)[];
  mcp_servers: MCPServerDef[];
  skills: SkillDef[];
  callable_agents: CallableAgent[];
  output_schema?: OutputSchema;
}

interface SteeringExample {
  event: string;
  description: string;
}

// ── Cookbook data structures ────────────────────────────────────────

interface SubagentAgentEntry {
  agent: Agent;
  yaml: SubagentYAML;
  /** Resolved skill names for documentation */
  skillNames: string[];
}

export interface LoadedCMA {
  /** Parent orchestrator agents, keyed by cookbook name */
  parents: Record<string, Agent>;
  /** Subagent agents, keyed by "cookbook/subagentName" */
  subagents: Record<string, SubagentAgentEntry>;
  /** Steering examples keyed by cookbook name */
  steering: Record<string, SteeringExample[]>;
  /** All subagent IDs for dynamic dispatch */
  subagentIds: string[];
}

/** Memory instances keyed by agent ID. Agents without an entry get no memory. */
export type AgentMemoryMap = Record<string, Memory>;

let cachedCMA: LoadedCMA | null = null;

/** Get the most recently loaded CMA data (or null if not yet loaded) */
export function getLoadedCMA(): LoadedCMA | null {
  return cachedCMA;
}

/** Look up a subagent's output_schema by "cookbook/subagent" key */
export function getSubagentOutputSchema(key: string): OutputSchema | undefined {
  return cachedCMA?.subagents[key]?.yaml.output_schema;
}

// ── YAML parsing ────────────────────────────────────────────────────
async function parseYAML<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  const resolved = raw.replace(/\$\{[A-Z_]+\}/g, "https://localhost/placeholder");
  return yaml.load(resolved) as T;
}

async function parseJSON<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

// ── Tool access gating ──────────────────────────────────────────────

function getAllowedMCPServers(mcpToolsets: MCPToolset[]): Set<string> {
  const servers = new Set<string>();
  for (const mts of mcpToolsets) {
    if (mts.default_config?.enabled) {
      servers.add(mts.mcp_server_name);
    }
  }
  return servers;
}

function getEnabledCMATools(
  configs: ToolConfig[]
): Record<string, ReturnType<typeof createTool>> {
  const tools: Record<string, ReturnType<typeof createTool>> = {};
  for (const config of configs) {
    if (!config.enabled) continue;
    const tool = CMA_TOOLS[config.name];
    if (tool) {
      tools[`cma_${config.name}`] = tool;
    }
  }
  return tools;
}

function getEnabledCMAToolNames(configs: ToolConfig[]): string[] {
  return configs.filter((c) => c.enabled).map((c) => c.name);
}

function mergeTools(
  a: Record<string, ReturnType<typeof createTool>>,
  b: Record<string, ReturnType<typeof createTool>>
): Record<string, ReturnType<typeof createTool>> {
  return { ...a, ...b };
}

function filterMCPTools(
  allTools: Record<string, Tool<any, any, any, any>>,
  allowedServers: Set<string>
): Record<string, Tool<any, any, any, any>> {
  if (allowedServers.size === 0) return {};
  const sortedServers = Array.from(allowedServers).sort((a, b) => b.length - a.length);
  const filtered: Record<string, Tool<any, any, any, any>> = {};
  for (const [toolName, tool] of Object.entries(allTools)) {
    for (const server of sortedServers) {
      if (toolName.startsWith(server + "_")) {
        filtered[toolName] = tool;
        break;
      }
    }
  }
  return filtered;
}

// ── Steering examples injection ─────────────────────────────────────

function formatSteeringExamples(examples: SteeringExample[]): string {
  if (!examples || examples.length === 0) return "";

  const lines = examples.map(
    (ex) => `- **"${ex.event}"** — ${ex.description}`
  );
  return `
## STEERING EXAMPLES

You may receive requests like these. Each describes a valid way to invoke you:

${lines.join("\n")}
`;
}

// ── Command reference injection ─────────────────────────────────────

const STATIC_COMMAND_ASSOC: Record<string, string[]> = {
  "pitch-agent": ["comps", "dcf", "lbo", "3-statement-model", "teaser", "cim", "pitch-deck", "merger-model", "one-pager", "process-letter", "deal-tracker", "buyer-list"],
  "market-researcher": ["comps", "competitive-analysis", "earnings", "earnings-preview", "morning-note", "sector", "thesis", "catalysts", "screen", "initiate"],
  "earnings-reviewer": ["earnings", "earnings-preview", "model-update", "morning-note"],
  "model-builder": ["dcf", "lbo", "3-statement-model", "comps", "debug-model", "competitive-analysis"],
  "valuation-reviewer": ["comps", "dcf", "returns", "ic-memo", "portfolio", "value-creation", "ai-readiness", "unit-economics"],
  "gl-reconciler": [],
  "month-end-closer": [],
  "statement-auditor": [],
  "kyc-screener": [],
  "meeting-prep-agent": ["client-review", "client-report", "financial-plan", "rebalance", "proposal", "tlh"],
};

function getRelevantCommands(
  cookbookName: string,
  allCommands: Record<string, string>
): string[] {
  const candidates = STATIC_COMMAND_ASSOC[cookbookName] || [];
  return candidates.filter((c) => allCommands[c] !== undefined);
}

function formatCommandReference(
  commands: Record<string, string>,
  cookbookName: string
): string {
  const relevant = getRelevantCommands(cookbookName, commands);

  if (relevant.length === 0) return "";

  const lines = relevant.map(
    (name) => {
      const body = commands[name];
      return `### /${name}\n${body.slice(0, 300)}${body.length > 300 ? "..." : ""}`;
    }
  );
  return `
## AVAILABLE SLASH COMMANDS

You can execute any of these commands:

${lines.join("\n\n")}
`;
}

// ── Subagent availability description ───────────────────────────────

function formatSubagentAvailability(
  subagentYAMLs: Map<string, SubagentYAML>
): string {
  if (subagentYAMLs.size === 0) return "";

  const lines: string[] = [];
  for (const [name, yaml] of subagentYAMLs) {
    const cmaNames = getEnabledCMAToolNames(
      yaml.tools
        .filter((t): t is AgentToolset => t.type === "agent_toolset_20260401")
        .flatMap((t) => t.configs)
    );
    const mcpServers = getAllowedMCPServers(
      yaml.tools.filter((t): t is MCPToolset => t.type === "mcp_toolset")
    );
    const hasWrite = cmaNames.includes("write");
    const toolDesc = [
      ...cmaNames.map((n) => n.charAt(0).toUpperCase() + n.slice(1)),
      ...Array.from(mcpServers).map((s) => `MCP:${s}`),
    ].join(", ");

    lines.push(
      `- **agent-${name}** — ${toolDesc || "no tools"}${hasWrite ? " ⚡ WRITE-holder" : ""}`
    );
  }

  return `
## SUBAGENTS AVAILABLE

You have specialized subagents available as tools. Each is prefixed with \`agent-\`.
Use the tool directly to delegate work — Mastra handles routing and context passing.

${lines.join("\n")}

Only ONE subagent holds Write — use it as the final step for file output.
`;
}

// ── System prompt loading ───────────────────────────────────────────

/**
 * Load system prompt from agent.md file with YAML frontmatter.
 * Remaps plugin paths to src/agents/ and extracts skill references
 * from the "## Skills this agent uses" section.
 */
async function loadAgentMarkdownFile(
  cookbookName: string,
  cookbookDir: string,
  systemConfig: AgentYAML["system"]
): Promise<{ instructions: string; skillNames: string[] }> {
  let text = "";

  if (systemConfig.file) {
    // The cookbook YAML references paths like:
    //   "../../anthropic-financial-services/plugins/agent-plugins/<slug>/agents/<slug>.md"
    // from cookbookDir (e.g., "managed-agent-cookbooks/pitch-agent/").
    // This correctly resolves to the anthropic-financial-services/ copy.
    const resolvedPath = resolve(cookbookDir, systemConfig.file);
    try {
      const raw = await readFile(resolvedPath, "utf-8");
      const { data, content } = matter(raw);
      text = content.trim();
    } catch (err) {
      // Silent failure leaves orchestrator with empty system prompt — fail fast instead
      throw new Error(
        `Failed to load system prompt for cookbook "${cookbookName}": ${resolvedPath} — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else if (systemConfig.text) {
    text = systemConfig.text;
  }

  if (systemConfig.append) {
    text += "\n\n" + systemConfig.append;
  }

  // Extract skill references from "## Skills this agent uses" section
  const skillNames = extractSkillReferences(text);

  return { instructions: text.trim(), skillNames };
}

/**
 * Extract skill names from backtick-quoted kebab-case patterns
 * in the "Skills this agent uses" section of agent markdown files.
 */
function extractSkillReferences(text: string): string[] {
  const pattern = /`([a-z0-9]+(?:-[a-z0-9]+)+)`/g;
  const refs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    refs.add(match[1]);
  }
  return Array.from(refs);
}

// ── Model resolution with fallback ──────────────────────────────────

/**
 * Fallback chains for agent models. If the primary model fails
 * (rate limit, timeout), Mastra automatically tries the next entry.
 * Each entry goes through resolveModelString for gateway routing.
 *
 * Only agents explicitly listed here get fallback chains.
 * Agents without an entry use a single model (no retry array).
 */
const FALLBACK_CHAINS: Record<string, Array<{ model: string; maxRetries: number }>> = {
  "pitch-agent": [
    { model: "anthropic/claude-opus-4-7", maxRetries: 2 },
    { model: "openai/gpt-5", maxRetries: 1 },
  ],
  "earnings-reviewer": [
    { model: "anthropic/claude-sonnet-4-6", maxRetries: 2 },
    { model: "openai/gpt-5-mini", maxRetries: 1 },
  ],
  "meeting-prep-agent": [
    { model: "anthropic/claude-sonnet-4-6", maxRetries: 2 },
    { model: "openai/gpt-5-mini", maxRetries: 1 },
  ],
};

function resolveModel(modelName: string, agentId?: string): DynamicArgument<MastraModelConfig> {
  const resolved = resolveModelForAgent(modelName, agentId);

  // Check for fallback chain (only for explicitly listed agents)
  const chain = agentId ? FALLBACK_CHAINS[agentId] : null;

  if (chain) {
    // Return ModelWithRetries[] — Mastra handles automatic fallback
    // Each entry goes through resolveModelString for env var + alias resolution
    return chain.map((entry) => ({
      model: resolveModelString(entry.model, agentId),
      maxRetries: entry.maxRetries,
    })) as any;
  }

  return resolved;
}

// ── Main loader ─────────────────────────────────────────────────────

/**
 * Load all CMA cookbooks and create Mastra agents for every parent
 * orchestrator and every subagent with proper tool gating, skill
 * injection, command references, and dynamic dispatch support.
 *
 * This is a SINGLE-PASS loader that replaces the separate legacy
 * agent-loader.ts — it loads agent.md files directly and augments
 * them with CMA cookbook configuration.
 */
export async function loadCMACookbooks(
  memoryInstances?: AgentMemoryMap
): Promise<LoadedCMA> {
  const parents: Record<string, Agent> = {};
  const subagents: Record<string, SubagentAgentEntry> = {};
  const steering: Record<string, SteeringExample[]> = {};
  const allSubagentIds: string[] = [];

  // ── Load shared resources once (independent, run in parallel) ────
  const [allMCPTools, allSkills, allCommands] = await Promise.all([
    listMCPTools().catch((err: unknown) => {
      console.warn("  ⚠ MCP tools not available — continuing without MCP", err instanceof Error ? err.message : "");
      return {} as Record<string, Tool<any, any, any, any>>;
    }),
    loadAllCMASkills(),
    loadCommands(),
  ]);
  console.log(
    `  ✓ Loaded ${Object.keys(allCommands).length} slash commands`
  );

  // Discover cookbook directories
  let cookbookDirs: string[];
  try {
    const entries = await readdir(COOKBOOKS_DIR, { withFileTypes: true });
    cookbookDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    console.warn("  ⚠ No cookbook directories found");
    return { parents, subagents, steering, subagentIds: [] };
  }

  for (const cookbookName of cookbookDirs) {
    const cookbookDir = join(COOKBOOKS_DIR, cookbookName);

    // Parse agent.yaml
    let manifest: AgentYAML;
    try {
      manifest = await parseYAML<AgentYAML>(join(cookbookDir, "agent.yaml"));
    } catch {
      console.warn(`  ⚠ Could not parse agent.yaml for ${cookbookName}`);
      continue;
    }

    // Parse steering examples
    let steerExamples: SteeringExample[] = [];
    try {
      steerExamples = await parseJSON<SteeringExample[]>(
        join(cookbookDir, "steering-examples.json")
      );
    } catch {
      // Optional
    }
    steering[cookbookName] = steerExamples;

    // ── Build parent orchestrator ─────────────────────────────────

    // Load system prompt from agent.md (with skill reference extraction)
    const { instructions: agentInstructions, skillNames: agentSkillNames } =
      await loadAgentMarkdownFile(cookbookName, cookbookDir, manifest.system);

    // Resolve agent markdown skill references
    const agentSkills = resolveAgentMarkdownSkills(agentSkillNames, allSkills);

    // Build parent system prompt
    const parentSystemPrompt =
      agentInstructions +
      formatSkillsForPrompt(agentSkills) +
      formatSteeringExamples(steerExamples) +
      formatCommandReference(allCommands, cookbookName);

    // Build parent tool set
    const parentCMAConfigs = manifest.tools
      .filter((t): t is AgentToolset => t.type === "agent_toolset_20260401")
      .flatMap((t) => t.configs);
    const parentCMATools = getEnabledCMATools(parentCMAConfigs);

    const parentMCPServers = new Set(manifest.mcp_servers.map((s) => s.name));
    for (const tool of manifest.tools) {
      if (tool.type === "mcp_toolset" && tool.default_config?.enabled) {
        parentMCPServers.add(tool.mcp_server_name);
      }
    }
    const parentMCPTools = filterMCPTools(allMCPTools, parentMCPServers);

    let parentTools = mergeTools(parentCMATools, parentMCPTools);

    // ── Parse subagent YAMLs ─────────────────────────────────────
    const subagentYAMLs = new Map<string, SubagentYAML>();
    const subagentsDir = join(cookbookDir, "subagents");

    try {
      const subagentFiles = await readdir(subagentsDir);
      const allowlist = new Set<string>();
      if (Array.isArray(manifest.callable_agents) && manifest.callable_agents.length > 0) {
        for (const c of manifest.callable_agents) {
          if (c && typeof c.manifest === "string") {
            allowlist.add(c.manifest.split("/").pop() || c.manifest);
          }
        }
      }
      for (const file of subagentFiles) {
        if (!file.endsWith(".yaml")) continue;
        if (allowlist.size > 0 && !allowlist.has(file)) {
          continue;
        }

        let subYAML: SubagentYAML;
        try {
          subYAML = await parseYAML<SubagentYAML>(join(subagentsDir, file));
        } catch {
          console.warn(`  ⚠ Could not parse subagent: ${file}`);
          continue;
        }

        subagentYAMLs.set(subYAML.name, subYAML);
      }
    } catch {
      // No subagents dir
    }

    // Collect subagent Agent instances for supervisor delegation
    const subagentAgentInstances: Record<string, Agent> = {};

    parents[cookbookName] = new Agent({
      id: `${cookbookName}-orchestrator`,
      name: manifest.name
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      description: `Orchestrator for ${manifest.name}`,
      instructions:
        parentSystemPrompt +
        formatSubagentAvailability(subagentYAMLs),
      model: resolveModel(manifest.model, cookbookName),
      tools: Object.keys(parentTools).length > 0
        ? (parentTools as any)
        : undefined,
      agents: subagentYAMLs.size > 0 ? subagentAgentInstances : undefined,
      inputProcessors: getAgentInputProcessors(cookbookName),
      outputProcessors: getAgentOutputProcessors(cookbookName),
      memory: memoryInstances?.[cookbookName] ?? undefined,
    });

    console.log(
      `  ✓ Loaded CMA orchestrator: ${cookbookName}` +
        ` (${manifest.callable_agents.length} subagents, ` +
        `${agentSkills.length} skills, ` +
        `${Object.keys(parentTools).length} tools)`
    );

    // ── Create Mastra agents for each subagent ───────────────────
    for (const [subName, subYAML] of subagentYAMLs) {
      // CMA tools
      const cmaConfigs = subYAML.tools
        .filter((t): t is AgentToolset => t.type === "agent_toolset_20260401")
        .flatMap((t) => t.configs);
      const cmaToolNames = getEnabledCMAToolNames(cmaConfigs);
      const subCMATools = getEnabledCMATools(cmaConfigs);

      // MCP tools
      const allowedMCPServers = getAllowedMCPServers(
        subYAML.tools.filter((t): t is MCPToolset => t.type === "mcp_toolset")
      );
      const subMCPTools = filterMCPTools(allMCPTools, allowedMCPServers);

      // Resolve skills from subagent YAML
      const subSkills = resolveSubagentSkills(subYAML.skills, allSkills);
      const skillNames = subSkills.map((s) => s.name);

      // Merge tools
      const subTools = mergeTools(subCMATools, subMCPTools);

      // Build system prompt
      const systemPrompt =
        subYAML.system.text +
        formatSkillsForPrompt(subSkills);

      // Tool descriptions
      const toolDesc: string[] = [];
      if (cmaToolNames.length > 0) {
        toolDesc.push(`CMA:[${cmaToolNames.join(",")}]`);
      }
      for (const s of allowedMCPServers) {
        toolDesc.push(`MCP:${s}`);
      }
      if (skillNames.length > 0) {
        toolDesc.push(`Skills:[${skillNames.join(",")}]`);
      }

      const key = `${cookbookName}/${subName}`;
      const entry: SubagentAgentEntry = {
        yaml: subYAML,
        skillNames,
        agent: new Agent({
          id: subName,
          name: subName
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          description: `Subagent: ${subName} [${toolDesc.join(", ") || "none"}]`,
          instructions: systemPrompt,
          model: resolveModel(subYAML.model, subName),
          tools: Object.keys(subTools).length > 0
            ? (subTools as any)
            : undefined,
          inputProcessors: getAgentInputProcessors(subName),
          outputProcessors: getAgentOutputProcessors(subName),
        }),
      };

      subagents[key] = entry;
      // Register for supervisor delegation (parent uses agent-<subName> tools)
      subagentAgentInstances[subName] = entry.agent;
      // Deduplicate by bare subagent name — first occurrence wins (same name across cookbooks is a collision)
      if (!allSubagentIds.includes(subName)) {
        allSubagentIds.push(subName);
      }

      console.log(
        `    ↳ Subagent: ${subName} [${toolDesc.join(", ") || "no tools"}]` +
          `${subYAML.output_schema ? " +schema" : ""}` +
          `${skillNames.length > 0 ? ` +${skillNames.length} skills` : ""}`
      );
    }
  }

  cachedCMA = { parents, subagents, steering, subagentIds: allSubagentIds };
  return cachedCMA;
}
