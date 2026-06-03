#!/usr/bin/env -S npx tsx
/**
 * open-financial-agents CLI
 *
 * Model-agnostic, file-based financial services agent platform.
 * Uses Mastra for agent orchestration with support for any LLM provider.
 *
 * Usage:
 *   npx tsx cli/index.ts run <agent-slug> [prompt]
 *   npx tsx cli/index.ts list
 *   npx tsx cli/index.ts deploy <slug>
 *   npx tsx cli/index.ts check
 *   npx tsx cli/index.ts validate <output.json> <schema.json|schema.yaml>
 *   npx tsx cli/index.ts sync-skills
 */

import { config } from "dotenv";
config(); // Load .env

import { Command } from "commander";
import chalk from "chalk";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const AGENTS_DIR = join(ROOT, "src", "agents");

const program = new Command();

program
  .name("ofa")
  .description("open-financial-agents — model-agnostic financial services agent platform")
  .version("0.1.0");

/**
 * ofa list — list all available agents with descriptions
 */
program
  .command("list")
  .description("List all available agents")
  .action(async () => {
    let entries: Array<{ slug: string; name: string; description: string }> = [];

    try {
      const { mastra } = await import("../src/mastra/index.js");
      const agents = (mastra as any).listAgents ? (mastra as any).listAgents() : (mastra as any).agents || {};
      entries = Object.entries(agents)
        .filter(([key]) => !key.includes("/"))
        .map(([slug, agent]: [string, any]) => {
          return {
            slug,
            name: agent?.name || slug,
            description: agent?.description || "",
          };
        });
    } catch {
      // Fall back to file-system listing if Mastra can't be loaded
    }

    if (entries.length === 0) {
      const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
      const { default: matter } = await import("gray-matter");
      const { readFileSync } = await import("node:fs");
      for (const file of files) {
        const text = readFileSync(join(AGENTS_DIR, file), "utf-8");
        try {
          const { data } = matter(text);
          entries.push({
            slug: file.replace(".md", ""),
            name: data.name || file.replace(".md", ""),
            description: data.description || "(no description)",
          });
        } catch {
          entries.push({
            slug: file.replace(".md", ""),
            name: file.replace(".md", ""),
            description: "(no description)",
          });
        }
      }
    }

    console.log(chalk.bold(`\nAvailable agents (${entries.length}):\n`));

    for (const { slug, name, description } of entries) {
      console.log(`  ${chalk.cyan.bold(slug)} — ${chalk.white(name)}`);
      if (description) {
        console.log(`    ${chalk.gray(description)}`);
      }
      console.log();
    }
  });

/**
 * ofa run <slug> [prompt] — run a single agent
 */
program
  .command("run <slug> [prompt]")
  .description("Run an agent with an optional prompt")
  .option("-m, --model <model>", "Model to use (e.g. openai/gpt-4o)")
  .action(async (slug: string, prompt?: string, options?: { model?: string }) => {
    const agentFile = join(AGENTS_DIR, `${slug}.md`);

    if (!existsSync(agentFile)) {
      console.error(chalk.red(`Agent "${slug}" not found.`));
      console.error(`Available: ${readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", "")).join(", ")}`);
      process.exit(1);
    }

    console.log(chalk.bold(`\nStarting agent: ${chalk.cyan(slug)}`));

    const userPrompt = prompt || await new Promise<string>((resolve) => {
      process.stdout.write(chalk.gray("\nEnter prompt: "));
      process.stdin.once("data", (data) => resolve(data.toString().trim()));
    });

    console.log(chalk.gray(`\nPrompt: ${userPrompt}\n`));

    try {
      let mastra;
      try {
        const imported = await import("../src/mastra/index.js");
        mastra = imported.mastra;
      } catch (initErr) {
        console.error(chalk.red(`Failed to initialize Mastra: ${initErr instanceof Error ? initErr.message : String(initErr)}`));
        if ((initErr as Error).message?.includes("MCP")) {
          console.error(chalk.gray("\nTip: Check MCP server URLs and API keys in .env. See .env.example"));
        } else if ((initErr as Error).message?.includes("API key") || (initErr as Error).message?.includes("not configured")) {
          console.error(chalk.gray("\nTip: Set API keys in .env. See .env.example"));
        }
        process.exit(1);
      }

      if (!mastra) {
        console.error(chalk.red(`Mastra not initialized. Run "npm run dev" first.`));
        process.exit(1);
      }

      const agent = mastra.getAgent(slug);

      if (!agent) {
        // Suggest available agents
        const available = Object.keys((mastra as any).agents || {}).slice(0, 20);
        console.error(chalk.red(`Agent "${slug}" not registered in Mastra.`));
        if (available.length > 0) {
          console.error(chalk.gray(`Available agents: ${available.join(", ")}`));
        }
        process.exit(1);
      }

      console.log(chalk.yellow("━━━ Response ━━━\n"));

      const result = await agent.generate(userPrompt);
      console.log(result.text);

      console.log(chalk.yellow("\n\n━━━ Complete ━━━\n"));
    } catch (e) {
      console.error(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`));

      if ((e as Error).message?.includes("not configured")) {
        console.error(chalk.gray("\nTip: Set API keys in .env. See .env.example"));
      }

      process.exit(1);
    }
  });

/**
 * ofa skills <slug> — list skills for an agent
 */
program
  .command("skills <slug>")
  .description("List skills available for an agent")
  .action(async (slug: string) => {
    const agentFile = join(AGENTS_DIR, `${slug}.md`);

    if (!existsSync(agentFile)) {
      console.error(chalk.red(`Agent "${slug}" not found.`));
      process.exit(1);
    }

    const { default: matter } = await import("gray-matter");
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(agentFile, "utf-8");
    const { content } = matter(text);

    const refs = Array.from(content.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)).map((m) => m[1]);

    console.log(chalk.bold(`\nSkills for ${chalk.cyan(slug)}:\n`));
    for (const ref of refs) {
      console.log(`  ${chalk.green("✦")} ${ref}`);
    }
    console.log(`\n  Total: ${refs.length} skills`);
  });

/**
 * ofa commands — list all slash commands
 */
program
  .command("commands")
  .description("List all slash commands")
  .action(async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const COMMANDS_DIR = join(ROOT, "src", "commands");

    if (!existsSync(COMMANDS_DIR)) {
      console.log(chalk.gray("No commands directory found."));
      return;
    }

    const files = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith(".md"));

    console.log(chalk.bold(`\nSlash commands (${files.length}):\n`));

    for (const file of files) {
      const { default: matter } = await import("gray-matter");
      const text = readFileSync(join(COMMANDS_DIR, file), "utf-8");

      try {
        const { data } = matter(text);
        const name = file.replace(".md", "");
        const desc = data.description || "(no description)";
        const hint = data["argument-hint"] || "";

        console.log(`  ${chalk.green("/" + name)} ${chalk.gray(hint)}`);
        console.log(`    ${chalk.gray(desc)}`);
      } catch {
        console.log(`  ${chalk.green("/" + file.replace(".md", ""))}`);
      }
    }
    console.log();
  });

program.parse(process.argv);
