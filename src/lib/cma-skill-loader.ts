/**
 * CMA Skill Loader
 *
 * Loads SKILL.md files from the anthropic-financial-services plugin tree
 * and partner-plugins directory. Resolves skill path references found in
 * subagent YAML files (e.g. `../../../plugins/agent-plugins/pitch-agent/skills/dcf-model`)
 * to their actual SKILL.md content on disk.
 *
 * Two resolution strategies:
 *   1. Anthropic agent-plugins:  managed-agent-cookbooks/<agent>/ → resolve ../../../plugins/...
 *      → look in anthropic-financial-services/plugins/agent-plugins/<agent>/skills/<name>/SKILL.md
 *   2. Partner plugins:          direct path resolution to partner-plugins/<partner>/skills/<name>/SKILL.md
 *
 * Also loads skills from src/skills/ for agent markdown file references.
 */

import { readFile, readdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

// Skill loading cache — avoids re-reading files for every subagent
let skillsCache: Record<string, LoadedSkill> | null = null;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");

/**
 * Our local agent skill bundles — mirrors the structure of the official
 * agent-plugins but lives under src/agent-skills/{agent}/skills/{skill}/SKILL.md
 *
 * Resolves skill paths from cookbook YAML like:
 *   ../../../plugins/agent-plugins/pitch-agent/skills/xlsx-author
 * → src/agent-skills/pitch-agent/skills/xlsx-author/SKILL.md
 *
 * Also mirrors the vertical-plugin skill source dirs under:
 *   src/skills/{vertical}/{skill}/SKILL.md
 */
const SRC_AGENT_SKILLS = join(PROJECT_ROOT, "src", "agent-skills");

/** Partner plugin skills */
const PARTNER_PLUGINS = join(PROJECT_ROOT, "partner-plugins");

/** Vertical skill files (for agent markdown references) */
const SRC_SKILLS = join(PROJECT_ROOT, "src", "skills");

interface SkillDef {
  path?: string;
}

/**
 * Result from loading a single skill.
 */
export interface LoadedSkill {
  /** Skill name (directory basename) */
  name: string;
  /** Skill description from frontmatter */
  description: string;
  /** Full markdown body (YAML frontmatter stripped) */
  body: string;
}

/**
 * Load ALL SKILL.md files from local agent-skills and partner-plugins.
 * Returns a flat map of skill name → LoadedSkill.
 */
export async function loadAllCMASkills(): Promise<Record<string, LoadedSkill>> {
  // Return cached skills if already loaded
  if (skillsCache) {
    return skillsCache;
  }

  const skills: Record<string, LoadedSkill> = {};

  // 1. Our local agent skill bundles (src/agent-skills/)
  // This is the primary local source — mirrors the official agent-plugins structure
  await loadAgentPluginSkills(SRC_AGENT_SKILLS, skills);

  // 3. Partner plugins
  for (const partner of ["lseg", "spglobal"]) {
    const partnerSkills = join(PARTNER_PLUGINS, partner, "skills");
    await loadAgentPluginSkills(partnerSkills, skills);
  }

  // 4. src/skills/ (for agent markdown file references)
  await loadSrcSkills(SRC_SKILLS, skills);

  // Cache for subsequent calls
  skillsCache = skills;

  console.log(
    `  ✓ Loaded ${Object.keys(skills).length} CMA skills from plugins`
  );
  return skills;
}

/**
 * Clear the skill cache — useful for testing or hot-reload scenarios.
 */
export function clearSkillsCache(): void {
  skillsCache = null;
}

/**
 * Recursively find and load all SKILL.md files under a directory.
 */
async function loadAgentPluginSkills(
  root: string,
  target: Record<string, LoadedSkill>
): Promise<void> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = join(root, entry.name);

      // Check for SKILL.md directly in this directory
      const skillPath = join(dirPath, "SKILL.md");
      try {
        await access(skillPath);
        const skill = await loadSkillFile(skillPath, entry.name);
        // Deduplicate — first writer wins (agent-plugins take priority over partners)
        if (!target[skill.name]) {
          target[skill.name] = skill;
        }
      } catch {
        // Recurse into subdirectories (e.g., earnings-analysis/references/)
        await loadAgentPluginSkills(dirPath, target);
      }
    }
  } catch {
    // Directory may not exist
  }
}

/**
 * Load SKILL.md files from src/skills/ (organized by vertical).
 */
async function loadSrcSkills(
  root: string,
  target: Record<string, LoadedSkill>
): Promise<void> {
  try {
    const verticals = await readdir(root, { withFileTypes: true });
    for (const vertical of verticals) {
      if (!vertical.isDirectory()) continue;
      const vDir = join(root, vertical.name);

      try {
        const files = await readdir(vDir, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith(".md")) continue;
          const skillName = file.name.replace(".md", "");
          // Only add if not already loaded from agent-plugins
          if (!target[skillName]) {
            const skillPath = join(vDir, file.name);
            try {
              const skill = await loadSkillFile(skillPath, skillName);
              target[skill.name] = skill;
            } catch {
              // skip unreadable files
            }
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Directory may not exist
  }
}

/**
 * Load a single SKILL.md file, parsing YAML frontmatter with gray-matter.
 */
async function loadSkillFile(
  filePath: string,
  fallbackName: string
): Promise<LoadedSkill> {
  const raw = await readFile(filePath, "utf-8");
  const { data, content } = matter(raw);

  return {
    name: data.name || fallbackName,
    description: data.description || "",
    body: content.trim(),
  };
}

// ── Skill path resolution ───────────────────────────────────────────

/**
 * Given a subagent YAML's skill definitions and the cookbook directory,
 * resolve all skills referenced by path into LoadedSkill objects.
 *
 * Handles two path patterns:
 *   1. Official cookbook path: ../../../plugins/agent-plugins/<agent>/skills/<skill>
 *      → resolves to src/agent-skills/<agent>/skills/<skill>/SKILL.md
 *   2. Direct src/ path:         ../../../plugins/agent-plugins/<agent>/skills/<skill>
 *      where the skill already lives under src/agent-skills/ (our local structure)
 *
 * Skill name is extracted as the last path component.
 */
export function resolveSubagentSkills(
  skillDefs: SkillDef[],
  allSkills: Record<string, LoadedSkill>
): LoadedSkill[] {
  const resolved: LoadedSkill[] = [];

  for (const def of skillDefs) {
    if (!def.path) continue;

    // Extract the skill name from the path (last path component)
    // e.g., "../../../plugins/agent-plugins/pitch-agent/skills/dcf-model" → "dcf-model"
    const parts = def.path.replace(/\/+$/, "").split("/");
    const skillName = parts[parts.length - 1];

    // The cookbook path `../../../plugins/agent-plugins/<agent>/skills/<skill>`
    // from `managed-agent-cookbooks/<cookbook>/subagents/` resolves to:
    //   <cookbook_dir>/../../../plugins/agent-plugins/<agent>/skills/<skill>
    // = <PROJECT_ROOT>/plugins/agent-plugins/<agent>/skills/<skill>
    //
    // Our local equivalent is:
    //   <PROJECT_ROOT>/src/agent-skills/<agent>/skills/<skill>/SKILL.md
    //
    // Since loadAllCMASkills already loads from SRC_AGENT_SKILLS (src/agent-skills/),
    // we just need to find the skill by name in the allSkills map.
    // The skill name is the last path component, so "dcf-model" matches
    // a skill loaded from src/agent-skills/<any>/skills/dcf-model/SKILL.md.

    // Try exact name first, then fallback attempts
    const skill =
      allSkills[skillName] ||
      // Try with underscores removed (some names use underscore-separated form)
      Object.values(allSkills).find(
        (s) => s.name.replace(/-/g, "") === skillName.replace(/-/g, "")
      );

    if (skill) {
      resolved.push(skill);
    } else {
      console.warn(`  ⚠ Skill not found: ${skillName} (referenced in subagent YAML as ${def.path})`);
    }
  }

  return resolved;
}

/**
 * Format resolved skills for injection into a system prompt.
 */
export function formatSkillsForPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return "";

  const sections = skills.map(
    (s) =>
      `### ${s.name}\n${s.description ? `> ${s.description}\n\n` : ""}${s.body}`
  );

  return `\n\n---\n\n# SKILL REFERENCE\n\nThe following skills are available. Invoke them by name when their domain knowledge is needed:\n\n${sections.join("\n\n---\n\n")}`;
}

/**
 * Load skills referenced in agent markdown files (backtick references
 * like `dcf-model`, `comps-analysis` in "## Skills this agent uses" section).
 *
 * Returns formatted skill content for injection into parent orchestrator prompts.
 */
export function resolveAgentMarkdownSkills(
  skillNames: string[],
  allSkills: Record<string, LoadedSkill>
): LoadedSkill[] {
  const resolved: LoadedSkill[] = [];
  for (const name of skillNames) {
    const skill =
      allSkills[name] ||
      // Try finding by name with different formatting
      Object.values(allSkills).find(
        (s) => s.name.replace(/-/g, "") === name.replace(/-/g, "")
      );
    if (skill) {
      resolved.push(skill);
    }
  }
  return resolved;
}
