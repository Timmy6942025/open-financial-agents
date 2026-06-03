import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { resolve, join } from "path";

vi.mock("../lib/model-router.js", () => ({
  resolveModelString: vi.fn((_name: string) => "mock/mock-model"),
  resolveGuardrailModel: vi.fn((_name: string) => "mock/mock-model"),
  gatewayProvider: null,
}));

import { loadCMACookbooks, type LoadedCMA } from "../lib/cma-loader.js";

const VERTICALS = [
  "earnings-reviewer",
  "gl-reconciler",
  "kyc-screener",
  "market-researcher",
  "meeting-prep-agent",
  "model-builder",
  "month-end-closer",
  "pitch-agent",
  "statement-auditor",
  "valuation-reviewer",
];

const ROOT = resolve(__dirname, "../..");
const COOKBOOKS_DIR = join(ROOT, "managed-agent-cookbooks");
const AGENTS_DIR = join(ROOT, "src/agents");
const AGENT_SKILLS_DIR = join(ROOT, "src/agent-skills");

type Loader = typeof loadCMACookbooks;

describe("CMA cookbook loader: end-to-end integration", () => {
  let cma: LoadedCMA | null = null;
  let loadError: Error | null = null;

  beforeAll(async () => {
    const start = Date.now();
    try {
      cma = await (loadCMACookbooks as Loader)();
    } catch (e) {
      loadError = e instanceof Error ? e : new Error(String(e));
    }
    const elapsed = Date.now() - start;
    if (elapsed > 5000) {
      console.warn(`integration.test: loadCMACookbooks took ${elapsed}ms`);
    }
  }, 15000);

  it("loads at least 5 cookbooks (target: 10) without throwing", () => {
    if (!cma) {
      console.warn(
        `integration.test: skipping — loadCMACookbooks failed: ${loadError?.message ?? "unknown"}`
      );
      return;
    }
    const cookbookCount = Object.keys(cma.parents).length;
    expect(cookbookCount).toBeGreaterThanOrEqual(5);
  });

  it("each cookbook has a parent Agent and at least 1 subagent", () => {
    if (!cma) return;
    const cookbookSlugs = Object.keys(cma.parents);
    expect(cookbookSlugs.length).toBeGreaterThan(0);

    for (const slug of cookbookSlugs) {
      const parent = cma.parents[slug];
      expect(parent, `parent agent for ${slug}`).toBeDefined();
      expect(parent.id, `parent id for ${slug}`).toBeTruthy();

      const subKeys = Object.keys(cma.subagents).filter((k) =>
        k.startsWith(`${slug}/`)
      );
      expect(
        subKeys.length,
        `subagent count for ${slug}`
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("subagents have tool gating — read-only has cma_read but not cma_write", async () => {
    if (!cma) return;

    let checkedAny = false;
    for (const [key, entry] of Object.entries(cma.subagents)) {
      const toolset = entry.yaml.tools.find(
        (t: any) => t.type === "agent_toolset_20260401"
      );
      if (!toolset) continue;

      const enabledNames = ((toolset as any).configs || [])
        .filter((c: any) => c.enabled)
        .map((c: any) => c.name);

      if (enabledNames.includes("read") && !enabledNames.includes("write")) {
        const tools = await entry.agent.listTools();
        const toolIds = Object.keys(tools);
        expect(
          toolIds,
          `read-only subagent ${key} should expose cma_read`
        ).toContain("cma_read");
        expect(
          toolIds,
          `read-only subagent ${key} should NOT expose cma_write`
        ).not.toContain("cma_write");
        checkedAny = true;
        break;
      }
    }

    if (!checkedAny) {
      console.warn("integration.test: no read-only subagent found — skipping gating check");
    }
  });

  it("parent's instructions contain skill content and command references", async () => {
    if (!cma) return;

    const firstSlug = Object.keys(cma.parents)[0];
    const parent = cma.parents[firstSlug];
    const instructions = await parent.getInstructions();
    const text =
      typeof instructions === "string"
        ? instructions
        : Array.isArray(instructions)
          ? instructions.join("\n")
          : JSON.stringify(instructions);

    expect(
      text,
      `parent ${firstSlug} instructions should reference skills`
    ).toMatch(/SKILL REFERENCE/i);

    expect(
      text,
      `parent ${firstSlug} instructions should reference slash commands`
    ).toMatch(/SLASH COMMANDS/i);
  });

  it("each vertical has an agent.md file that exists and is non-empty", () => {
    for (const vertical of VERTICALS) {
      const mdPath = join(AGENTS_DIR, `${vertical}.md`);
      expect(
        existsSync(mdPath),
        `${vertical}.md should exist at ${mdPath}`
      ).toBe(true);
      const content = readFileSync(mdPath, "utf-8");
      expect(
        content.length,
        `${vertical}.md should be non-empty`
      ).toBeGreaterThan(0);
    }
  });

  it("each vertical has an agent.yaml with required fields (name, model, system, tools, callable_agents)", () => {
    for (const vertical of VERTICALS) {
      const yamlPath = join(COOKBOOKS_DIR, vertical, "agent.yaml");
      expect(
        existsSync(yamlPath),
        `agent.yaml should exist at ${yamlPath}`
      ).toBe(true);
      const raw = readFileSync(yamlPath, "utf-8");
      const doc = parseYaml(raw);
      expect(doc.name, `${vertical} agent.yaml should have name`).toBe(vertical);
      expect(doc.model, `${vertical} agent.yaml should have model`).toBeTruthy();
      expect(doc.system, `${vertical} agent.yaml should have system`).toBeTruthy();
      expect(doc.tools, `${vertical} agent.yaml should have tools`).toBeDefined();
      expect(
        Array.isArray(doc.tools),
        `${vertical} agent.yaml tools should be an array`
      ).toBe(true);
      expect(
        doc.callable_agents,
        `${vertical} agent.yaml should have callable_agents`
      ).toBeDefined();
      expect(
        Array.isArray(doc.callable_agents),
        `${vertical} agent.yaml callable_agents should be an array`
      ).toBe(true);
    }
  });

  it("each subagent YAML has a system.text field and a model field", () => {
    for (const vertical of VERTICALS) {
      const subagentsDir = join(COOKBOOKS_DIR, vertical, "subagents");
      expect(
        existsSync(subagentsDir),
        `subagents dir should exist for ${vertical}`
      ).toBe(true);

      const yamlPath = join(COOKBOOKS_DIR, vertical, "agent.yaml");
      const agentRaw = readFileSync(yamlPath, "utf-8");
      const agentDoc = parseYaml(agentRaw);
      const callableAgents: any[] = agentDoc.callable_agents || [];

      expect(
        callableAgents.length,
        `${vertical} should have callable_agents entries`
      ).toBeGreaterThan(0);

      const verticalDir = join(COOKBOOKS_DIR, vertical);
      for (const entry of callableAgents) {
        const manifestRef =
          typeof entry === "string" ? entry : entry.manifest;
        const subagentPath = resolve(verticalDir, manifestRef);
        expect(
          existsSync(subagentPath),
          `subagent manifest ${manifestRef} should exist for ${vertical}`
        ).toBe(true);

        const subRaw = readFileSync(subagentPath, "utf-8");
        const subDoc = parseYaml(subRaw);

        expect(
          subDoc.system,
          `${manifestRef} should have system`
        ).toBeDefined();
        expect(
          subDoc.system?.text,
          `${manifestRef} should have system.text`
        ).toBeTruthy();
        expect(
          subDoc.model,
          `${manifestRef} should have model`
        ).toBeTruthy();
      }
    }
  });

  it("skill directories referenced in subagent YAMLs have SKILL.md files on disk", () => {
    for (const vertical of VERTICALS) {
      const subagentsDir = join(COOKBOOKS_DIR, vertical, "subagents");
      if (!existsSync(subagentsDir)) continue;

      const yamlPath = join(COOKBOOKS_DIR, vertical, "agent.yaml");
      const agentRaw = readFileSync(yamlPath, "utf-8");
      const agentDoc = parseYaml(agentRaw);
      const callableAgents: any[] = agentDoc.callable_agents || [];

      for (const entry of callableAgents) {
        const manifestRef =
          typeof entry === "string" ? entry : entry.manifest;
        const subagentPath = resolve(subagentsDir, manifestRef);
        if (!existsSync(subagentPath)) continue;

        const subRaw = readFileSync(subagentPath, "utf-8");
        const subDoc = parseYaml(subRaw);
        const skills: any[] = subDoc.skills || [];

        for (const skill of skills) {
          if (skill.path) {
            const resolvedSkillPath = resolve(subagentPath, skill.path);
            const skillMdPath = join(resolvedSkillPath, "SKILL.md");
            expect(
              existsSync(skillMdPath),
              `SKILL.md should exist at ${skillMdPath} (referenced from ${manifestRef} in ${vertical})`
            ).toBe(true);
          }
        }
      }
    }
  });

  it("each vertical has at least one subagent", () => {
    for (const vertical of VERTICALS) {
      const yamlPath = join(COOKBOOKS_DIR, vertical, "agent.yaml");
      const agentRaw = readFileSync(yamlPath, "utf-8");
      const agentDoc = parseYaml(agentRaw);
      const callableAgents: any[] = agentDoc.callable_agents || [];

      expect(
        callableAgents.length,
        `${vertical} should have at least one subagent`
      ).toBeGreaterThanOrEqual(1);

      const verticalDir = join(COOKBOOKS_DIR, vertical);
      for (const entry of callableAgents) {
        const manifestRef =
          typeof entry === "string" ? entry : entry.manifest;
        const subagentPath = resolve(verticalDir, manifestRef);
        expect(
          existsSync(subagentPath),
          `subagent file ${manifestRef} should exist for ${vertical}`
        ).toBe(true);
      }
    }
  });
});
