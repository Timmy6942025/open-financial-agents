/**
 * Port of sync-agent-skills.py — sync bundled agent skills from vertical source.
 *
 * Agent plugins under src/agent-skills/<slug>/skills/<name>/ are vendored copies
 * of src/skills/<vertical>/<name>/SKILL.md. The vertical copy is the source of truth.
 *
 * Structure:
 *   - Vertical source:     src/skills/{vertical}/{skill-name}/SKILL.md
 *   - Agent bundle dest:   src/agent-skills/{agent}/skills/{skill-name}/SKILL.md
 *
 * Usage: npx tsx scripts/sync-skills.ts
 */

import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SKILLS_DIR = join(ROOT, "src", "skills");
const AGENT_SKILLS_DIR = join(ROOT, "src", "agent-skills");

// ── Build index: skill-name → vertical source directory ────────────────
// Our vertical skills live at: src/skills/{vertical}/{skill-name}/
// (either as a directory with SKILL.md, or a .md file)
const srcByName = new Map<string, string>();

for (const vertical of readdirSync(SKILLS_DIR)) {
  const vDir = join(SKILLS_DIR, vertical);
  if (!statSync(vDir).isDirectory()) continue;

  for (const entry of readdirSync(vDir)) {
    const entryPath = join(vDir, entry);
    // Skill bundles are directories (e.g., src/skills/financial-analysis/xlsx-author/)
    // Skill markdown files are .md files (e.g., src/skills/investment-banking/teaser.md)
    if (statSync(entryPath).isDirectory()) {
      // It's a skill bundle directory — SKILL.md is inside it
      srcByName.set(entry, vDir); // key: "xlsx-author", value: "src/skills/financial-analysis"
    } else if (entry.endsWith(".md")) {
      // It's a skill markdown file — use the file directly
      const name = entry.replace(/\.md$/, "");
      srcByName.set(name, vDir);
    }
  }
}

// ── Sync each agent's bundled skills from the vertical source ──────────
let synced = 0;
const missing: string[] = [];
const skipped: string[] = []; // Agent-specific skills with no vertical source

if (!existsSync(AGENT_SKILLS_DIR)) {
  console.log("No agent-skill bundles to sync.");
  process.exit(0);
}

for (const agentDir of readdirSync(AGENT_SKILLS_DIR)) {
  const agentPath = join(AGENT_SKILLS_DIR, agentDir);
  if (!statSync(agentPath).isDirectory()) continue;

  // Navigate into the agent's skills/ subdirectory (not the agent root)
  // Structure: src/agent-skills/{agent}/skills/{skill-name}/SKILL.md
  const skillsDir = join(agentPath, "skills");
  if (!existsSync(skillsDir)) {
    // Some agents may not have bundled skills yet — skip silently
    continue;
  }

  for (const skillDir of readdirSync(skillsDir)) {
    const bundledPath = join(skillsDir, skillDir);
    if (!statSync(bundledPath).isDirectory()) continue;

    // Look up the vertical source for this skill
    const srcDir = srcByName.get(skillDir);
    if (!srcDir) {
      // Agent-specific skill (e.g., gl-recon, audit-xls, xlsx-author)
      // that doesn't have a vertical-plugin counterpart — skip but track
      skipped.push(`${agentDir}/skills/${skillDir}`);
      continue;
    }

    // Find the vertical source SKILL.md
    // The vertical source may be a directory (skill bundle) or a .md file
    const srcSkillFile = join(srcDir, skillDir, "SKILL.md");
    if (!existsSync(srcSkillFile)) {
      // Try as a flat .md file (legacy/alternate structure)
      const srcMdFile = join(srcDir, `${skillDir}.md`);
      if (existsSync(srcMdFile)) {
        const destSkillFile = join(bundledPath, "SKILL.md");
        cpSync(srcMdFile, destSkillFile);
        synced++;
        continue;
      }
      // Neither form exists
      missing.push(`${agentDir}/skills/${skillDir} (source not found)`);
      continue;
    }

    // Copy from vertical source to agent bundle
    const destSkillFile = join(bundledPath, "SKILL.md");
    cpSync(srcSkillFile, destSkillFile);
    synced++;
  }
}

// ── Report ─────────────────────────────────────────────────────────────
console.log(`synced ${synced} bundled skill file(s) from vertical source.`);

if (skipped.length > 0) {
  console.log(
    `skipped ${skipped.length} agent-specific skill(s) with no vertical source:`
  );
  for (const s of skipped) {
    console.log(`  - ${s} (standalone — no vertical source)`);
  }
}

if (missing.length > 0) {
  console.warn(`ERROR: ${missing.length} skill bundle(s) missing vertical source:`);
  for (const m of missing) {
    console.warn(`  - ${m}`);
  }
  process.exit(1);
}

if (synced === 0 && skipped.length === 0) {
  console.log("Nothing to sync — all agent skills already up to date.");
}