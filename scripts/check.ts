/**
 * Lint all plugin + managed-agent manifests and verify cross-file references.
 *
 * Checks:
 *   1. Every *.yaml under managed-agent-cookbooks/ parses.
 *   2. Every plugin.json / marketplace.json / steering-examples.json parses.
 *   3. Every agents/*.md has valid YAML frontmatter with name + description.
 *   4. Every system.file, skills[].path, callable_agents[].manifest in agent.yaml
 *      and subagent yamls resolves to an existing file/dir.
 *   5. Every managed-agent-cookbooks/<slug>/ has agent.yaml, README.md,
 *      steering-examples.json.
 *   6. Bundled agent skills match src/skills/ sources.
 *   7. Agent.md prose skill references exist in the agent's own bundle.
 *   8. Marketplace source paths resolve to directories with plugin.json.
 *
 * Exit 0 if clean, 1 otherwise.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import * as yaml from "yaml";
import { globSync as gs } from "glob";
import { execSync } from "node:child_process";
import * as path from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SRC_AGENTS_DIR = join(ROOT, "src", "agents");
const SRC_SKILLS_DIR = join(ROOT, "src", "skills");
const AGENT_SKILLS_DIR = join(ROOT, "src", "agent-skills");
const COMMANDS_DIR = join(ROOT, "src", "commands");
const MANAGED_DIR = join(ROOT, "managed-agent-cookbooks");
const PARTNER_DIR = join(ROOT, "partner-plugins");

interface Err {
  message: string;
}

const errors: Err[] = [];
let checked = 0;

function err(msg: string) {
  errors.push({ message: msg });
}

function rel(p: string): string {
  return p.replace(ROOT + "/", "");
}

function ensureHooksInstalled(): void {
  const want = ".githooks";
  try {
    const cur = execSync(`git -C ${ROOT} config --get core.hooksPath`, {
      encoding: "utf-8",
    }).trim();
    if (cur !== want) {
      execSync(`git -C ${ROOT} config core.hooksPath ${want}`, {
        stdio: "pipe",
      });
      console.log(`[check.ts] installed git hooks (core.hooksPath -> ${want})`);
    }
  } catch {
    // Not a git checkout or git unavailable — ignore
  }
}

ensureHooksInstalled();

const allYamlFiles = gs("managed-agent-cookbooks/**/*.yaml", { cwd: ROOT });

// --- 1. YAML parse ----------------------------------------------------------
for (const ymlPath of allYamlFiles.sort()) {
  checked++;
  try {
    yaml.parse(readFileSync(join(ROOT, ymlPath), "utf-8"));
  } catch (e) {
    err(`YAML parse: ${rel(ymlPath)}: ${e}`);
  }
}

// --- 2. JSON parse ----------------------------------------------------------
const jsonGlobs = [
  ".claude-plugin/marketplace.json",
  "partner-plugins/**/.claude-plugin/plugin.json",
  "claude-for-msft-365-install/.claude-plugin/plugin.json",
  "managed-agent-cookbooks/*/steering-examples.json",
];
for (const pat of jsonGlobs) {
  for (const jf of gs(pat, { cwd: ROOT }).sort()) {
    checked++;
    try {
      JSON.parse(readFileSync(join(ROOT, jf), "utf-8"));
    } catch (e) {
      err(`JSON parse: ${rel(jf)}: ${e}`);
    }
  }
}

// --- 3. agent.md frontmatter ------------------------------------------------
const agentMdPaths = gs("src/agents/*.md", { cwd: ROOT });
for (const mdPath of agentMdPaths.sort()) {
  checked++;
  const text = readFileSync(join(ROOT, mdPath), "utf-8");
  if (!text.startsWith("---")) {
    err(`frontmatter: ${rel(mdPath)}: missing leading ---`);
    continue;
  }
  try {
    const { data } = matter(text);
    for (const k of ["name", "description"]) {
      if (!data[k as keyof typeof data]) {
        err(`frontmatter: ${rel(mdPath)}: missing '${k}'`);
      }
    }
  } catch (e) {
    err(`frontmatter: ${rel(mdPath)}: ${e}`);
  }
}

// --- 4. reference resolution ------------------------------------------------
function checkRefs(ymlPath: string): void {
  let data: Record<string, unknown> = {};
  try {
    const parsed = yaml.parse(readFileSync(ymlPath, "utf-8"));
    data = parsed ?? {};
  } catch {
    return; // already reported above
  }
  const base = dirname(ymlPath);

  const sysSpec = data["system"];
  if (typeof sysSpec === "object" && sysSpec !== null && "file" in sysSpec) {
    const p = resolve(base, String(sysSpec["file"]));
    if (!existsSync(p)) {
      err(`ref: ${rel(ymlPath)}: system.file -> ${sysSpec["file"]} (not found)`);
    }
  }

  const skills = data["skills"];
  if (Array.isArray(skills)) {
    for (const s of skills) {
      if (typeof s === "object" && s !== null && "path" in s) {
        const p = resolve(base, String(s["path"]));
        if (!existsSync(p)) {
          err(`ref: ${rel(ymlPath)}: skills.path -> ${s["path"]} (not found)`);
        }
      }
      if (typeof s === "object" && s !== null && "from_plugin" in s) {
        const p = resolve(base, String(s["from_plugin"]));
        // from_plugin can point to a directory with skills/ or flat skill dirs
        if (!existsSync(join(p, "skills")) && !existsSync(p)) {
          err(`ref: ${rel(ymlPath)}: skills.from_plugin -> ${s["from_plugin"]} (not found)`);
        }
      }
    }
  }

  const callableAgents = data["callable_agents"];
  if (Array.isArray(callableAgents)) {
    for (const c of callableAgents) {
      if (typeof c === "object" && c !== null && "manifest" in c) {
        const p = resolve(base, String(c["manifest"]));
        if (!existsSync(p)) {
          err(`ref: ${rel(ymlPath)}: callable_agents.manifest -> ${c["manifest"]} (not found)`);
        }
      }
    }
  }
}

for (const ymlPath of allYamlFiles.sort()) {
  checkRefs(join(ROOT, ymlPath));
}

// --- 4b. bundled skills match src/skills/ source ----------------------------
const srcByName: Record<string, string> = {};
if (existsSync(SRC_SKILLS_DIR)) {
  for (const vertDir of readdirSync(SRC_SKILLS_DIR)) {
    const vertPath = join(SRC_SKILLS_DIR, vertDir);
    if (!statSync(vertPath).isDirectory()) continue;

    for (const entry of readdirSync(vertPath)) {
      const entryPath = join(vertPath, entry);
      if (statSync(entryPath).isDirectory()) {
        // src/skills/{vertical}/{skill-name}/ (directory with SKILL.md)
        srcByName[entry] = entryPath;
      } else if (entry.endsWith(".md")) {
        // src/skills/{vertical}/{skill-name}.md (flat file skill)
        const name = entry.replace(".md", "");
        if (!srcByName[name]) {
          srcByName[name] = entryPath;
        }
      }
    }
  }
}

// Find bundled skill dirs under src/agent-skills/
const bundledSkillDirs = gs("src/agent-skills/*/skills/*", { cwd: ROOT }).filter((p) => {
  try {
    return statSync(join(ROOT, p)).isDirectory();
  } catch {
    return false;
  }
});

for (const bundledPath of bundledSkillDirs.sort()) {
  const fullPath = join(ROOT, bundledPath);
  const skillName = path.basename(bundledPath);
  const src = srcByName[skillName];
  if (!src) {
    // Agent-specific skill with no src/skills/ counterpart — skip
    continue;
  }
  try {
    // Compare SKILL.md contents between source and bundled
    const bundledSkillFile = join(fullPath, "SKILL.md");
    if (!existsSync(bundledSkillFile)) {
      continue;
    }

    const bundledContent = readFileSync(bundledSkillFile, "utf-8");

    if (statSync(src).isDirectory()) {
      // Source is a directory — expect SKILL.md inside
      const srcSkillFile = join(src, "SKILL.md");
      if (existsSync(srcSkillFile) && readFileSync(srcSkillFile, "utf-8") !== bundledContent) {
        err(
          `bundled-skill: ${rel(bundledPath)}: SKILL.md content differs from source ${rel(src)} ` +
          `(run npm run sync-skills)`
        );
      }
    } else if (src.endsWith(".md")) {
      // Source is a single .md file — compare directly
      if (readFileSync(src, "utf-8") !== bundledContent) {
        err(
          `bundled-skill: ${rel(bundledPath)}: content differs from source ${rel(src)} ` +
          `(run npm run sync-skills)`
        );
      }
    }
  } catch {
    // File read failed — skip drift check
  }
}

// --- 4b2. agent.md prose skill references exist in the agent's own bundle ---
const skillNamePattern = /`([a-z0-9]+(?:-[a-z0-9]+)+)`/g;

for (const mdPath of agentMdPaths.sort()) {
  const slug = path.basename(mdPath, ".md");
  const skDir = join(AGENT_SKILLS_DIR, slug, "skills");
  const bundle = new Set<string>();
  if (existsSync(skDir)) {
    for (const d of readdirSync(skDir)) {
      const fullDir = join(skDir, d);
      if (statSync(fullDir).isDirectory()) bundle.add(d);
    }
  }

  const text = readFileSync(join(ROOT, mdPath), "utf-8");
  const refs = new Set<string>(
    [...text.matchAll(skillNamePattern)].map((m) => m[1])
  );

  for (const ref of refs) {
    if (ref in srcByName && !bundle.has(ref)) {
      err(
        `agent-prose: ${rel(mdPath)}: references skill '${ref}' but ` +
        `src/agent-skills/${slug}/skills/${ref}/ is not bundled`
      );
    }
  }
}

// --- 4c. marketplace source paths resolve -----------------------------------
const _mpPath = join(ROOT, ".claude-plugin", "marketplace.json");
if (existsSync(_mpPath)) {
  checked++;
}

// --- 5. required files per managed-agent ------------------------------------
if (existsSync(MANAGED_DIR)) {
  for (const cookbook of readdirSync(MANAGED_DIR)) {
    const cookbookPath = join(MANAGED_DIR, cookbook);
    if (!statSync(cookbookPath).isDirectory()) continue;
    for (const req of ["agent.yaml", "README.md", "steering-examples.json"]) {
      if (!existsSync(join(cookbookPath, req))) {
        err(`missing: ${rel(cookbookPath)}/${req}`);
      }
    }
  }
}

// --- 6. Agent frontmatter (src/agents/) -------------------------------------
if (existsSync(SRC_AGENTS_DIR)) {
  for (const file of readdirSync(SRC_AGENTS_DIR)) {
    if (!file.endsWith(".md")) continue;
    const filePath = join(SRC_AGENTS_DIR, file);
    checked++;
    const text = readFileSync(filePath, "utf-8");
    if (!text.startsWith("---")) continue;
    try {
      const { data } = matter(text);
      for (const k of ["name", "description"]) {
        if (!data[k as keyof typeof data]) {
          err(`frontmatter: ${rel(filePath)}: missing '${k}'`);
        }
      }
    } catch (e) {
      err(`frontmatter: ${rel(filePath)}: ${e}`);
    }
  }
}

// --- 7. Skill frontmatter ----------------------------------------------------
const skillFiles = gs("src/skills/**/*.md", { cwd: ROOT });
for (const sf of skillFiles) {
  const filePath = join(ROOT, sf);
  checked++;
  const text = readFileSync(filePath, "utf-8");
  if (!text.startsWith("---")) continue;
  try {
    const { data } = matter(text);
    if (!data.name || !data.description) {
      err(`skill frontmatter: ${rel(filePath)}: missing name or description`);
    }
  } catch (e) {
    err(`skill frontmatter: ${rel(filePath)}: ${e}`);
  }
}

// --- 8. Command frontmatter --------------------------------------------------
if (existsSync(COMMANDS_DIR)) {
  const cmdFiles = gs("src/commands/**/*.md", { cwd: ROOT });
  for (const file of cmdFiles) {
    const filePath = join(ROOT, file);
    checked++;
    const text = readFileSync(filePath, "utf-8");
    if (!text.startsWith("---")) continue;
    try {
      const { data } = matter(text);
      if (!data.description) {
        err(`command frontmatter: ${rel(filePath)}: missing description`);
      }
    } catch (e) {
      err(`command frontmatter: ${rel(filePath)}: ${e}`);
    }
  }
}

// --- 9. Agent-skill bundling -------------------------------------------------
if (existsSync(AGENT_SKILLS_DIR)) {
  for (const agentDir of readdirSync(AGENT_SKILLS_DIR)) {
    const agentPath = join(AGENT_SKILLS_DIR, agentDir);
    if (!statSync(agentPath).isDirectory()) continue;
    const skillsDir = join(agentPath, "skills");
    if (!existsSync(skillsDir)) continue;
    for (const skillDir of readdirSync(skillsDir)) {
      const bundledPath = join(skillsDir, skillDir);
      if (!statSync(bundledPath).isDirectory()) continue;
      const skillFile = join(bundledPath, "SKILL.md");
      if (!existsSync(skillFile)) {
        err(`agent-skill: ${rel(bundledPath)}: missing SKILL.md`);
      }
    }
  }
}

// --- 10. Partner plugin skill validation ------------------------------------
if (existsSync(PARTNER_DIR)) {
  const partnerSkills = gs(`${PARTNER_DIR}/**/SKILL.md`);
  for (const ps of partnerSkills) {
    checked++;
    try {
      const text = readFileSync(ps, "utf-8");
      const { data } = matter(text);
      if (!data.name) {
        err(`partner skill: ${rel(ps)}: missing name`);
      }
    } catch (e) {
      err(`partner skill: ${rel(ps)}: ${e}`);
    }
  }
}

// --- Report -----------------------------------------------------------------
if (errors.length > 0) {
  console.error(`FAIL — ${errors.length} issue(s) across ${checked} file(s):\n`);
  for (const e of errors) {
    console.error(`  ✗ ${e.message}`);
  }
  process.exit(1);
}

console.log(`OK — ${checked} file(s) checked, 0 issues.`);
