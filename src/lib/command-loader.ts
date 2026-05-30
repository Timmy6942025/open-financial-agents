import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = join(__dirname, "..", "commands");

/**
 * Load all command files from the commands/ directory recursively.
 * Each command is a .md file with YAML frontmatter (description + argument-hint) and markdown body.
 * Handles nested subdirectories (e.g., investment-banking/).
 */
export async function loadCommands(): Promise<Record<string, string>> {
  const commands: Record<string, string> = {};

  try {
    await loadCommandsRecursive(COMMANDS_DIR, "", commands);
  } catch {
    // Commands directory may not exist yet
  }

  return commands;
}

/**
 * Recursively walk a directory tree and load all .md files as commands.
 * Nested files get namespaced: investment-banking/buyer-list → "investment-banking/buyer-list"
 */
async function loadCommandsRecursive(
  dir: string,
  prefix: string,
  target: Record<string, string>
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      const newPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      await loadCommandsRecursive(fullPath, newPrefix, target);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const raw = await readFile(fullPath, "utf-8");
      const { content } = matter(raw);
      const commandName = prefix
        ? `${prefix}/${entry.name.replace(".md", "")}`
        : entry.name.replace(".md", "");
      target[commandName] = content;
    }
  }
}
