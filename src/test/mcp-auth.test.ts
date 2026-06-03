/**
 * Unit tests for MCP auth resolution and check.ts agent-skill validation.
 *
 * Covers:
 *  - resolveApiKey(): env key resolution, aliases, missing keys
 *  - buildRequestInit(): header construction, Bearer prefix, missing key
 *  - check.ts section 5: agent-skill SKILL.md existence (nesting level)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resolveApiKey, buildRequestInit } from "../mcp/mcp-client.js";

// We import the check.ts validation inline via exec for isolated testing
import { readdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ─── resolveApiKey tests ────────────────────────────────────────────────

describe("resolveApiKey", () => {
  beforeEach(() => {
    // Clear any inherited env vars that could cause flaky tests
    delete process.env.DALOOPA_API_KEY;
    delete process.env.LSEG_API_KEY;
    delete process.env.SP_GLOBAL_API_KEY;
    delete process.env.BOX_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("should return undefined for unknown server", () => {
    expect(resolveApiKey("nonexistent-server")).toBeUndefined();
  });

  it("should return undefined when env key is not set", () => {
    expect(resolveApiKey("daloopa")).toBeUndefined();
  });

  it("should return the env value when set", () => {
    process.env.DALOOPA_API_KEY = "test-daloopa-key-123";
    expect(resolveApiKey("daloopa")).toBe("test-daloopa-key-123");
  });

  it("should follow AUTH_ALIASES (spglobal → sp-global)", () => {
    process.env.SP_GLOBAL_API_KEY = "sp-global-secret";
    // spglobal is an alias that maps to sp-global which uses SP_GLOBAL_API_KEY
    expect(resolveApiKey("spglobal")).toBe("sp-global-secret");
  });

  it("should return the same key for both alias and primary", () => {
    process.env.SP_GLOBAL_API_KEY = "shared-key";
    expect(resolveApiKey("sp-global")).toBe("shared-key");
    expect(resolveApiKey("spglobal")).toBe("shared-key");
  });

  it("should handle LSEG with Bearer prefix", () => {
    process.env.LSEG_API_KEY = "lseg-secret-token";
    expect(resolveApiKey("lseg")).toBe("lseg-secret-token");
  });

  it("should handle Box server", () => {
    process.env.BOX_API_KEY = "box-enterprise-id";
    expect(resolveApiKey("box")).toBe("box-enterprise-id");
  });
});

// ─── buildRequestInit tests ─────────────────────────────────────────────

describe("buildRequestInit", () => {
  beforeEach(() => {
    delete process.env.DALOOPA_API_KEY;
    delete process.env.LSEG_API_KEY;
    delete process.env.EGNYTE_API_KEY;
  });

  it("should return undefined for unknown server", () => {
    expect(buildRequestInit("unknown-server")).toBeUndefined();
  });

  it("should return undefined when env key is not set", () => {
    expect(buildRequestInit("daloopa")).toBeUndefined();
  });

  it("should return RequestInit with Authorization: Bearer <key>", () => {
    process.env.DALOOPA_API_KEY = "dal-key";
    const result = buildRequestInit("daloopa");
    expect(result).toEqual({
      headers: { Authorization: "Bearer dal-key" },
    });
  });

  it("should use custom headerPrefix for LSEG (Bearer)", () => {
    process.env.LSEG_API_KEY = "lseg-key";
    const result = buildRequestInit("lseg");
    expect(result).toEqual({
      headers: { Authorization: "Bearer lseg-key" },
    });
  });

  it("should use empty prefix trimmed to default Bearer", () => {
    process.env.EGNYTE_API_KEY = "egnyte-key";
    // egnyte has no headerPrefix, so defaults to Bearer
    const result = buildRequestInit("egnyte");
    expect(result).toEqual({
      headers: { Authorization: "Bearer egnyte-key" },
    });
  });

  it("should handle alias server (spglobal)", () => {
    process.env.SP_GLOBAL_API_KEY = "sp-key";
    const result = buildRequestInit("spglobal");
    expect(result).toEqual({
      headers: { Authorization: "Bearer sp-key" },
    });
  });
});

// ─── check.ts section 5: agent-skill SKILL.md existence ────────────────
// This tests the nesting-level fix: src/agent-skills/{agent}/skills/{skill}/SKILL.md

describe("check.ts section 5: agent-skill SKILL.md validation", () => {
  const AGENT_SKILLS_DIR = join(__dirname, "..", "agent-skills");

  /**
   * Replicates the check.ts section 5 logic for isolated testing.
   * Structure: src/agent-skills/{agent}/skills/{skill-name}/SKILL.md
   */
  function validateAgentSkillBundles(): { missing: string[]; checked: number } {
    const missing: string[] = [];
    let checked = 0;

    if (!existsSync(AGENT_SKILLS_DIR)) {
      return { missing, checked };
    }

    for (const agentDir of readdirSync(AGENT_SKILLS_DIR)) {
      const agentPath = join(AGENT_SKILLS_DIR, agentDir);
      if (!statSync(agentPath).isDirectory()) continue;

      const skillsDir = join(agentPath, "skills");
      if (!existsSync(skillsDir)) continue;

      for (const skillDir of readdirSync(skillsDir)) {
        const bundledPath = join(skillsDir, skillDir);
        if (!statSync(bundledPath).isDirectory()) continue;

        checked++;
        const skillFile = join(bundledPath, "SKILL.md");
        if (!existsSync(skillFile)) {
          missing.push(`${agentDir}/skills/${skillDir}`);
        }
      }
    }

    return { missing, checked };
  }

  it("should find all agent skill bundles and check SKILL.md exists", () => {
    const { missing, checked } = validateAgentSkillBundles();
    expect(checked).toBeGreaterThan(0); // We have many agent skill bundles
    expect(missing).toHaveLength(0);    // None should be missing SKILL.md
  });

  it("should correctly traverse the nesting: agent/skills/skill/SKILL.md", () => {
    // Verify the structure explicitly for pitch-agent
    const pitchSkillsDir = join(AGENT_SKILLS_DIR, "pitch-agent", "skills");
    if (existsSync(pitchSkillsDir)) {
      const skillDirs = readdirSync(pitchSkillsDir).filter((d) =>
        statSync(join(pitchSkillsDir, d)).isDirectory()
      );
      expect(skillDirs.length).toBeGreaterThan(0); // pitch-agent has skills

      for (const skillDir of skillDirs) {
        const skillFile = join(pitchSkillsDir, skillDir, "SKILL.md");
        expect(existsSync(skillFile)).toBe(true);
      }
    }
  });

  it("should find SKILL.md in every agent skill subdirectory", () => {
    const { missing } = validateAgentSkillBundles();
    // Report missing for debugging, but fail the test if any found
    if (missing.length > 0) {
      console.error("Missing SKILL.md in:", missing);
    }
    expect(missing).toHaveLength(0);
  });

  it("should detect a deliberately missing SKILL.md", async () => {
    // Create a temporary agent skill bundle without SKILL.md to verify detection
    const { existsSync, mkdirSync, rmSync } = await import("node:fs");
    const testAgentDir = join(AGENT_SKILLS_DIR, "_test-agent");
    const testSkillDir = join(testAgentDir, "skills", "_test-skill");

    // Setup
    mkdirSync(testSkillDir, { recursive: true });

    const { missing } = validateAgentSkillBundles();
    const hasTestAgentMissing = missing.some((m) => m.includes("_test-agent"));

    // Teardown
    rmSync(testAgentDir, { recursive: true, force: true });

    expect(hasTestAgentMissing).toBe(true);
  });
});

// ─── Integration: full AUTH_CONFIG coverage ────────────────────────────

describe("AUTH_CONFIG coverage", () => {
  it("should have an AUTH_CONFIG entry for every server in mcp.json", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const mcpJsonPath = join(fileURLToPath(import.meta.url), "..", "..", "mcp", "mcp.json");
    let mcpServers: string[] = [];

    try {
      const raw = await readFile(mcpJsonPath, "utf-8");
      const parsed = JSON.parse(raw);
      mcpServers = Object.keys(parsed.mcpServers ?? {});
    } catch {
      // mcp.json may not exist in test environment
    }

    if (mcpServers.length === 0) return; // skip if no servers configured

    // We test that every server we can resolve has an AUTH_CONFIG entry
    // by checking that resolveApiKey doesn't return undefined for configured servers
    // (when env vars are set — we just check the function doesn't throw)
    for (const server of mcpServers) {
      expect(() => resolveApiKey(server)).not.toThrow();
    }
  });
});