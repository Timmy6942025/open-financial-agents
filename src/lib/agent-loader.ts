import { Agent } from "@mastra/core/agent";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { modelRouter } from "./model-router.js";
import { loadSkills } from "./skill-loader.js";
import { loadCommands } from "./command-loader.js";
import { listTools as listMCPTools } from "../mcp/mcp-client.js";
import type { LanguageModel } from "ai";

/** Mastra internal utility type — not exported from @mastra/core barrel */
type DynamicArgument<T> = T | ((opts: { requestContext: unknown; mastra?: unknown }) => Promise<T> | T);

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, "..", "agents");

export interface AgentDefinition {
  name: string;
  description: string;
  instructions: string;
  tools?: string;
  skills?: string[];
  model?: LanguageModel;
}

/**
 * Parse a single agent markdown file into an AgentDefinition.
 * Files use YAML frontmatter with name, description, tools.
 */
async function parseAgentFile(filePath: string): Promise<AgentDefinition> {
  const raw = await readFile(filePath, "utf-8");
  const { data, content } = matter(raw);

  return {
    name: data.name || "",
    description: data.description || "",
    instructions: content.trim(),
    tools: data.tools,
    skills: extractSkillReferences(content),
  };
}

/**
 * Extract skill names referenced in backtick-quoted kebab-case patterns
 * from the "Skills this agent uses" section.
 */
function extractSkillReferences(text: string): string[] {
  // Match backtick-wrapped kebab-case references (e.g. `dcf-model`, `comps-analysis`)
  const pattern = /`([a-z0-9]+(?:-[a-z0-9]+)+)`/g;
  const refs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    refs.add(match[1]);
  }
  return Array.from(refs);
}

/**
 * Load all agents from the agents/ directory.
 * Each agent is defined as a .md file with YAML frontmatter.
 */
export async function loadAllAgents(): Promise<Record<string, Agent>> {
  const files = await readdir(AGENTS_DIR);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const loaded: Record<string, Agent> = {};

  // Load all skills and commands for augmentation
  const allSkills = await loadSkills();
  const allCommands = await loadCommands();

  // Fetch MCP tools from connected financial data servers
  let mcpTools: Record<string, unknown> = {};
  try {
    mcpTools = await listMCPTools() as Record<string, unknown>;
  } catch {
    console.warn("MCP tools not available — continuing without MCP");
  }

  for (const file of mdFiles) {
    const filePath = join(AGENTS_DIR, file);
    const def = await parseAgentFile(filePath);

    // Skip agents with missing required fields
    if (!def.name) {
      console.warn(`  ⚠ Skipping agent ${file}: missing 'name' in frontmatter`);
      continue;
    }
    if (!def.description) {
      console.warn(`  ⚠ Agent ${def.name}: missing 'description' in frontmatter`);
    }

    // Build augmented instructions with bundled skills
    let augmentedInstructions = def.instructions;

    // Append skill content for all skills referenced by the agent
    if (def.skills && def.skills.length > 0) {
      const skillTexts: string[] = [];
      for (const skillName of def.skills) {
        if (allSkills[skillName]) {
          skillTexts.push(`\n## Skill: ${skillName}\n${allSkills[skillName]}`);
        }
      }
      if (skillTexts.length > 0) {
        augmentedInstructions += "\n\n---\n\n# SKILL REFERENCE\n" + skillTexts.join("\n\n---\n");
      }
    }

    // Append command reference matching the agent's skills
    const commandTexts = Object.entries(allCommands)
      .filter(([name]) => def.skills?.some((s) => name.includes(s) || s.includes(name)))
      .map(([name, cmd]) => `### /${name}\n${cmd}`);

    if (commandTexts.length > 0) {
      augmentedInstructions += "\n\n---\n\n# COMMAND REFERENCE\n" + commandTexts.join("\n\n");
    }

    const displayName = def.name
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    loaded[def.name] = new Agent({
      id: def.name,
      name: displayName,
      description: def.description,
      instructions: augmentedInstructions,
      model: def.model || modelRouter.getModel(process.env.DEFAULT_MODEL || "openai/gpt-4o"),
      tools: Object.keys(mcpTools).length > 0 ? mcpTools as DynamicArgument<any> : undefined,
    });

    console.log(`  ✓ Loaded agent: ${def.name}`);
  }

  return loaded;
}
