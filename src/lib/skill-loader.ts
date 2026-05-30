import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "..", "skills");

/**
 * Load all skill files from the skills/ directory tree.
 * Skills are organized by vertical (financial-analysis/, investment-banking/, etc.).
 * Each skill is a .md file with YAML frontmatter (name + description) and markdown body.
 */
export async function loadSkills(): Promise<Record<string, string>> {
  const skills: Record<string, string> = {};

  const verticals = await readdir(SKILLS_DIR, { withFileTypes: true });
  for (const vertical of verticals) {
    if (!vertical.isDirectory()) continue;
    const verticalDir = join(SKILLS_DIR, vertical.name);

    try {
      const skillFiles = await readdir(verticalDir, { withFileTypes: true });
      for (const sf of skillFiles) {
        if (!sf.isFile() || !sf.name.endsWith(".md")) continue;
        const skillPath = join(verticalDir, sf.name);
        const raw = await readFile(skillPath, "utf-8");

        // Use gray-matter to parse frontmatter and get clean body content
        const { content } = matter(raw);
        const skillName = sf.name.replace(".md", "");
        skills[skillName] = content;
      }
    } catch {
      // Skip verticals that don't have skill files yet
      continue;
    }
  }

  console.log(`  ✓ Loaded ${Object.keys(skills).length} skills across ${verticals.length} verticals`);
  return skills;
}

/**
 * Load a single skill by name from the vertical plugins.
 */
export async function loadSkill(skillName: string): Promise<string | null> {
  const allSkills = await loadSkills();
  return allSkills[skillName] || null;
}
