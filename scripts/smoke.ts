/**
 * Smoke test — verify the CMA cookbook port is healthy.
 *
 * For each cookbook:
 *   - parent Agent exists
 *   - at least 1 subagent exists
 *   - system prompt is non-empty
 *   - tools array is sensible (subset of {read, write, edit, grep, glob, bash})
 *
 * Exits 0 on success, 1 on any failure.
 *
 * Usage: npx tsx scripts/smoke.ts
 */

import { config } from "dotenv";
config();

if (
  !process.env.ANTHROPIC_API_KEY &&
  !process.env.OPENAI_API_KEY &&
  !process.env.GOOGLE_GENERATIVE_AI_API_KEY &&
  !process.env.MISTRAL_API_KEY
) {
  process.env.ANTHROPIC_API_KEY = "smoke-test-dummy-key";
}

import { loadCMACookbooks, type LoadedCMA } from "../src/lib/cma-loader.js";

const ALLOWED_CMA_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "bash",
]);

interface Row {
  cookbook: string;
  parent: string;
  subs: number;
  promptLen: number;
  tools: string;
  ok: boolean;
  err: string;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + "…";
  return s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  const start = Date.now();

  let cma: LoadedCMA;
  try {
    cma = await loadCMACookbooks();
  } catch (e) {
    console.error(
      `✗ loadCMACookbooks failed: ${e instanceof Error ? e.message : String(e)}`
    );
    process.exit(1);
  }

  const rows: Row[] = [];
  let totalFailures = 0;

  for (const [slug, parent] of Object.entries(cma.parents)) {
    const row: Row = {
      cookbook: slug,
      parent: parent.id,
      subs: 0,
      promptLen: 0,
      tools: "",
      ok: true,
      err: "",
    };

    try {
      const instructions = await parent.getInstructions();
      const prompt =
        typeof instructions === "string"
          ? instructions
          : Array.isArray(instructions)
            ? instructions.join("\n")
            : "";
      row.promptLen = prompt.length;

      if (row.promptLen === 0) {
        row.ok = false;
        row.err = "empty system prompt";
        totalFailures++;
      }

      const subKeys = Object.keys(cma.subagents).filter((k) =>
        k.startsWith(`${slug}/`)
      );
      row.subs = subKeys.length;
      if (row.subs < 1) {
        row.ok = false;
        row.err = row.err || "no subagents";
        totalFailures++;
      }

      let allToolNames: string[] = [];
      for (const key of subKeys) {
        const entry = cma.subagents[key];
        const toolset = entry.yaml.tools.find(
          (t: any) => t.type === "agent_toolset_20260401"
        );
        if (!toolset) continue;
        const enabled = ((toolset as any).configs || [])
          .filter((c: any) => c.enabled)
          .map((c: any) => c.name);
        allToolNames.push(...enabled);
      }
      const unique = Array.from(new Set(allToolNames)).sort();
      row.tools = unique.length > 0 ? unique.join(",") : "(none)";

      for (const name of unique) {
        if (!ALLOWED_CMA_TOOLS.has(name)) {
          row.ok = false;
          row.err = `unknown tool: ${name}`;
          totalFailures++;
          break;
        }
      }
    } catch (e) {
      row.ok = false;
      row.err = e instanceof Error ? e.message : String(e);
      totalFailures++;
    }

    rows.push(row);
  }

  const elapsed = Date.now() - start;
  const totalCookbooks = rows.length;
  const passing = rows.filter((r) => r.ok).length;

  console.log("");
  console.log("┌─ CMA Smoke Test ─────────────────────────────────────────────");
  console.log(
    `│ ${pad("Cookbook", 22)} ${pad("Parent ID", 28)} ${pad("Subs", 5)} ${pad("Prompt", 8)} ${pad("Tools", 32)} Status`
  );
  console.log(
    "├─" +
      "─".repeat(22) +
      "─" +
      "─".repeat(28) +
      "─" +
      "─".repeat(5) +
      "─" +
      "─".repeat(8) +
      "─" +
      "─".repeat(32) +
      "─".repeat(7)
  );
  for (const r of rows) {
    const status = r.ok ? "  ✓" : `  ✗ ${r.err}`;
    console.log(
      `│ ${pad(r.cookbook, 22)} ${pad(r.parent, 28)} ${pad(String(r.subs), 5)} ${pad(String(r.promptLen), 8)} ${pad(r.tools, 32)} ${status}`
    );
  }
  console.log(
    "└─" +
      "─".repeat(22) +
      "─" +
      "─".repeat(28) +
      "─" +
      "─".repeat(5) +
      "─" +
      "─".repeat(8) +
      "─" +
      "─".repeat(32) +
      "─".repeat(7)
  );

  const totalSubagents = Object.keys(cma.subagents).length;
  console.log("");
  console.log(
    `  ${passing}/${totalCookbooks} cookbooks healthy, ${totalSubagents} subagents, ${elapsed}ms`
  );
  console.log("");

  if (totalFailures > 0) {
    console.error(`✗ ${totalFailures} check(s) failed`);
    process.exit(1);
  }

  console.log("✓ All checks passed");
  process.exit(0);
}

main().catch((e) => {
  console.error(
    `✗ smoke test crashed: ${e instanceof Error ? e.message : String(e)}`
  );
  process.exit(1);
});
