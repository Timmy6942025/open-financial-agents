/**
 * CMA (Claude Managed Agent) Tool Implementations
 *
 * These are Mastra-native implementations of the six Claude
 * agent_toolset_20260401 tools: Read, Write, Edit, Grep, Glob, Bash.
 *
 * Each tool mirrors the original Claude tool's behavior so that
 * the CMA subagent tool-gating config is enforced at runtime —
 * a subagent configured with only {read, grep} will NOT have
 * access to Write, Edit, or Bash.
 */

import { createTool } from "@mastra/core/tools";
import type { ToolAction } from "@mastra/core/tools";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { glob as globLib } from "glob";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ── Project root for resolving relative paths ───────────────────────
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Helper: resolve a user-provided path relative to project root ───
function resolvePath(userPath: string): string {
  if (userPath.startsWith("/")) return userPath;
  return resolve(PROJECT_ROOT, userPath);
}

// ── Helper: ensure the parent directory exists for a file path ──────
async function ensureParentDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

// ── 1. Read ─────────────────────────────────────────────────────────
export const readTool = createTool({
  id: "read",
  description:
    "Read the contents of a file from the local filesystem. " +
    "Use this to inspect source code, configuration files, data files, " +
    "or any text-based file in the project.",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to read, relative to the project root"),
  }),
  outputSchema: z.object({
    content: z.string().describe("The full text content of the file"),
    path: z.string().describe("The absolute path of the file that was read"),
  }),
  execute: async (inputData) => {
    const filePath = resolvePath(inputData.path);
    const content = await readFile(filePath, "utf-8");
    return { content, path: filePath };
  },
});

// ── 2. Write ────────────────────────────────────────────────────────
export const writeTool = createTool({
  id: "write",
  description:
    "Write content to a file, creating it if it doesn't exist or " +
    "overwriting it if it does. Parent directories are created automatically. " +
    "Use this to create new files or completely replace file contents.",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to write, relative to the project root"),
    content: z.string().describe("The content to write to the file"),
  }),
  outputSchema: z.object({
    path: z.string().describe("The absolute path of the written file"),
    bytesWritten: z.number().describe("Number of bytes written"),
  }),
  execute: async (inputData) => {
    const filePath = resolvePath(inputData.path);
    await ensureParentDir(filePath);
    await writeFile(filePath, inputData.content, "utf-8");
    const bytesWritten = Buffer.byteLength(inputData.content, "utf-8");
    return { path: filePath, bytesWritten };
  },
});

// ── 3. Edit ─────────────────────────────────────────────────────────
export const editTool = createTool({
  id: "edit",
  description:
    "Replace a specific string in an existing file with a new string. " +
    "The oldString must match exactly (including whitespace). " +
    "All occurrences are replaced. Use this for targeted edits instead " +
    "of rewriting entire files.",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to edit, relative to the project root"),
    oldString: z.string().describe("The exact string to find and replace"),
    newString: z.string().describe("The string to replace it with"),
  }),
  outputSchema: z.object({
    path: z.string().describe("The absolute path of the edited file"),
    replaced: z.boolean().describe("Whether the old string was found and replaced"),
    occurrences: z.number().describe("Number of times the old string was found and replaced"),
  }),
  execute: async (inputData) => {
    const filePath = resolvePath(inputData.path);

    // Guard against empty oldString (split("") produces artifacts)
    if (!inputData.oldString) {
      return { path: filePath, replaced: false, occurrences: 0 };
    }

    const original = await readFile(filePath, "utf-8");
    const occurrences = original.split(inputData.oldString).length - 1;

    if (occurrences === 0) {
      return { path: filePath, replaced: false, occurrences: 0 };
    }

    const updated = original.split(inputData.oldString).join(inputData.newString);
    await writeFile(filePath, updated, "utf-8");
    return { path: filePath, replaced: true, occurrences };
  },
});

// ── 4. Grep ─────────────────────────────────────────────────────────
export const grepTool = createTool({
  id: "grep",
  description:
    "Search for a pattern in files using ripgrep. " +
    "Returns matching lines with file paths and line numbers. " +
    "Use flags like '-i' for case-insensitive, '-g *.ts' to filter, " +
    "'-A 3' for context lines.",
  inputSchema: z.object({
    pattern: z.string().describe("The regex pattern to search for"),
    path: z
      .string()
      .optional()
      .describe("Optional file or directory path to search in (defaults to project root)"),
    flags: z
      .string()
      .optional()
      .describe("Optional ripgrep flags (e.g., '-i', '-g *.ts', '-A 3')"),
  }),
  outputSchema: z.object({
    matches: z.array(
      z.object({
        file: z.string().describe("Relative file path of the match"),
        line: z.number().describe("Line number of the match (1-based)"),
        content: z.string().describe("The matched line content"),
      })
    ),
    count: z.number().describe("Total number of matches"),
  }),
  execute: async (inputData) => {
    const searchPath = inputData.path ? resolvePath(inputData.path) : PROJECT_ROOT;
    const flags = inputData.flags || "";
    const pattern = inputData.pattern;

    try {
      const { stdout } = await execAsync(
        `rg --line-number --no-heading ${flags} ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)}`,
        {
          cwd: PROJECT_ROOT,
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024, // 10 MB
          encoding: "utf-8",
        }
      );

      const matches = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          // ripgrep output: path:lineNum:content
          const colonIdx = line.indexOf(":");
          const secondColonIdx = line.indexOf(":", colonIdx + 1);
          return {
            file: line.slice(0, colonIdx),
            line: parseInt(line.slice(colonIdx + 1, secondColonIdx), 10),
            content: line.slice(secondColonIdx + 1),
          };
        });

      return { matches, count: matches.length };
    } catch (err: any) {
      // rg exits with code 1 when no matches found
      if (err.code === 1) {
        return { matches: [], count: 0 };
      }
      // rg exits with code 2 on error
      throw new Error(`grep failed: ${err.stderr || err.message}`);
    }
  },
});

// ── 5. Glob ─────────────────────────────────────────────────────────
export const globTool = createTool({
  id: "glob",
  description:
    "Find files matching a glob pattern. " +
    "Use * to match any characters except /, ** to match any characters " +
    "including /, ? for single character, [abc] for character classes. " +
    "Returns matching file paths.",
  inputSchema: z.object({
    pattern: z.string().describe("The glob pattern to match (e.g., '**/*.test.ts', 'src/**/*.ts')"),
    cwd: z
      .string()
      .optional()
      .describe("Optional directory to search within, relative to project root"),
  }),
  outputSchema: z.object({
    files: z.array(z.string()).describe("Matching file paths, relative to the search directory"),
    count: z.number().describe("Number of matching files"),
  }),
  execute: async (inputData) => {
    const cwd = inputData.cwd ? resolvePath(inputData.cwd) : PROJECT_ROOT;

    const files = (await globLib(inputData.pattern, {
      cwd,
      nodir: true,
      dot: false,
      ignore: ["node_modules/**", ".git/**"],
    })) as string[];

    return { files, count: files.length };
  },
});

// ── 6. Bash ─────────────────────────────────────────────────────────
export const bashTool = createTool({
  id: "bash",
  description:
    "Execute a shell command in the project directory. " +
    "Use this for running scripts, building, testing, installing packages, " +
    "or any other terminal operation. Output is captured and returned.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
    cwd: z
      .string()
      .optional()
      .describe("Working directory for the command, relative to project root"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 30,000)"),
  }),
  outputSchema: z.object({
    stdout: z.string().describe("Standard output of the command"),
    stderr: z.string().describe("Standard error of the command"),
    exitCode: z.number().describe("Exit code of the command (0 = success)"),
  }),
  execute: async (inputData) => {
    const cwd = inputData.cwd ? resolvePath(inputData.cwd) : PROJECT_ROOT;
    const timeout = inputData.timeout || 30_000;

    try {
      const { stdout } = await execAsync(inputData.command, {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        encoding: "utf-8",
      });
      return { stdout, stderr: "", exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || err.message || "Command failed",
        exitCode: err.code || 1,
      };
    }
  },
});

// ── Tool registry ───────────────────────────────────────────────────
//
// Maps CMA tool names to Mastra Tool instances. Used by cma-loader.ts
// to build per-subagent tool sets based on agent_toolset_20260401 config.
// Type is permissive to accept both ToolAction and VercelTool (createTool return).

export const CMA_TOOLS: Record<string, ReturnType<typeof createTool>> = {
  read: readTool,
  write: writeTool,
  edit: editTool,
  grep: grepTool,
  glob: globTool,
  bash: bashTool,
};

/**
 * All CMA tools as a flat record for Mastra registration.
 * Registered at the Mastra instance level so agents can reference
 * them via tool names like "cma_read", "cma_write", etc.
 */
export const allCMATools = {
  cma_read: readTool,
  cma_write: writeTool,
  cma_edit: editTool,
  cma_grep: grepTool,
  cma_glob: globTool,
  cma_bash: bashTool,
};
