/**
 * MCP Client for open-financial-agents.
 *
 * Connects to financial data providers using the Mastra MCPClient.
 * Loads server configs from JSON files, injects API key auth from
 * environment variables, and provides tools to all agents.
 *
 * Providers: Daloopa, Morningstar, S&P Global, FactSet, Moody's,
 * MT Newswires, Aiera, LSEG, PitchBook, Chronograph, Egnyte, Box
 */

import { MCPClient } from "@mastra/mcp";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "@mastra/core/tools";

// ── Path resolution ────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ───────────────────────────────────────────────────────────
interface JsonMCPConfig {
  mcpServers: Record<string, { type: string; url: string }>;
}

interface ServerEntry {
  name: string;
  url: URL;
}

// ── Auth configuration ──────────────────────────────────────────────
/** API key auth: bearer token sent as Authorization header */
interface ApiKeyAuthConfig {
  mode: "api-key";
  envKey: string;
  headerPrefix?: string;
}

/**
 * Maps server names to their API key environment variable.
 * All servers here use Bearer token auth (no OAuth servers currently).
 *
 * Servers required by official managed-agent-cookbooks YAML configs:
 *   capiq, daloopa, factset, screening, internal-gl, subledger, nav, portfolio, crm
 * General-purpose providers:
 *   morningstar, sp-global, moodys, mtnewswire, aiera, lseg, pitchbook, chronograph, egnyte, box
 */
const AUTH_CONFIG: Record<string, ApiKeyAuthConfig> = {
  // Official cookbook servers
  capiq: { mode: "api-key", envKey: "CAPIQ_API_KEY" },
  daloopa: { mode: "api-key", envKey: "DALOOPA_API_KEY" },
  factset: { mode: "api-key", envKey: "FACTSET_API_KEY" },
  screening: { mode: "api-key", envKey: "SCREENING_API_KEY" },
  "internal-gl": { mode: "api-key", envKey: "INTERNAL_GL_API_KEY" },
  subledger: { mode: "api-key", envKey: "SUBLEDGER_API_KEY" },
  nav: { mode: "api-key", envKey: "NAV_API_KEY" },
  portfolio: { mode: "api-key", envKey: "PORTFOLIO_API_KEY" },
  crm: { mode: "api-key", envKey: "CRM_API_KEY" },
  // General-purpose providers
  morningstar: { mode: "api-key", envKey: "MORNINGSTAR_API_KEY" },
  "sp-global": { mode: "api-key", envKey: "SP_GLOBAL_API_KEY" },
  moodys: { mode: "api-key", envKey: "MOODYS_API_KEY" },
  mtnewswire: { mode: "api-key", envKey: "MTNEWSWIRE_API_KEY" },
  aiera: { mode: "api-key", envKey: "AIERA_API_KEY" },
  lseg: { mode: "api-key", envKey: "LSEG_API_KEY", headerPrefix: "Bearer" },
  pitchbook: { mode: "api-key", envKey: "PITCHBOOK_API_KEY" },
  chronograph: { mode: "api-key", envKey: "CHRONOGRAPH_API_KEY" },
  egnyte: { mode: "api-key", envKey: "EGNYTE_API_KEY" },
  box: { mode: "api-key", envKey: "BOX_API_KEY" },
};

// ── Aliases ─────────────────────────────────────────────────────────
/**
 * Partner plugin server names that map to the primary server key.
 * spglobal (partner plugin) shares the same Kensho endpoint as sp-global,
 * so it uses SP_GLOBAL_API_KEY.
 */
const AUTH_ALIASES: Record<string, string> = {
  spglobal: "sp-global",
};

/**
 * Resolve the auth config for a server, following aliases.
 */
function resolveAuthConfig(serverName: string): ApiKeyAuthConfig | undefined {
  const resolved = AUTH_ALIASES[serverName] ?? serverName;
  return AUTH_CONFIG[resolved];
}

/**
 * Resolve the API key for a server.
 */
export function resolveApiKey(serverName: string): string | undefined {
  const config = resolveAuthConfig(serverName);
  if (!config) return undefined;
  return process.env[config.envKey];
}

/**
 * Build RequestInit with auth headers for an API-key server.
 */
export function buildRequestInit(serverName: string): RequestInit | undefined {
  const apiKey = resolveApiKey(serverName);
  if (!apiKey) return undefined;

  const config = resolveAuthConfig(serverName);
  const prefix = config?.headerPrefix?.trim() || "Bearer";

  return {
    headers: {
      Authorization: `${prefix} ${apiKey}`,
    },
  };
}

// ── Config loading ──────────────────────────────────────────────────
/**
 * Load and parse a JSON MCP config file, substituting ${VAR} patterns
 * from environment variables. This allows mcp.json to reference env vars
 * for sensitive URLs (e.g. ${CAPIQ_MCP_URL}, ${SCREENING_MCP_URL}).
 */
async function loadJsonConfig(filePath: string): Promise<JsonMCPConfig> {
  try {
    const raw = await readFile(filePath, "utf-8");
    // Substitute ${VAR} patterns from environment variables
    const substituted = raw.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] || "");
    return JSON.parse(substituted) as JsonMCPConfig;
  } catch {
    return { mcpServers: {} };
  }
}

/**
 * Collect all MCP server URLs from all config files.
 * Deduplicates by server name (first wins).
 */
async function collectAllServers(): Promise<ServerEntry[]> {
  const serverMap = new Map<string, ServerEntry>();

  // 1. Root MCP config (primary — loaded first, takes precedence)
  const rootConfig = await loadJsonConfig(join(__dirname, "mcp.json"));
  for (const [name, server] of Object.entries(rootConfig.mcpServers)) {
    if (server.url) {
      serverMap.set(name, { name, url: new URL(server.url) });
    }
  }

  // 2. Partner plugin configs — these add servers NOT already in root
  // (only adds if not already present — first-wins per server name)
  const partnerConfigs = [
    join(__dirname, "..", "..", "partner-plugins", "lseg", ".mcp.json"),
    join(__dirname, "..", "..", "partner-plugins", "spglobal", ".mcp.json"),
  ];

  for (const configPath of partnerConfigs) {
    const config = await loadJsonConfig(configPath);
    for (const [name, server] of Object.entries(config.mcpServers)) {
      if (server.url && !serverMap.has(name)) {
        serverMap.set(name, { name, url: new URL(server.url) });
      }
    }
  }

  return Array.from(serverMap.values());
}

// ── Server connection tracking ──────────────────────────────────────
const serverConnectionStatus = new Map<string, "connecting" | "connected" | "failed">();
const serverErrors = new Map<string, string>();

function getServerStatus(): Record<string, { status: string; error?: string }> {
  const status: Record<string, { status: string; error?: string }> = {};
  for (const [name, s] of serverConnectionStatus) {
    status[name] = { status: s, error: serverErrors.get(name) };
  }
  return status;
}

// ── MCP Client singleton ────────────────────────────────────────────
let mcpClientInstance: MCPClient | null = null;
let serverNames: string[] = [];

/**
 * Initialize the MCP client with all configured servers.
 *
 * API keys are read from environment variables. Servers without
 * API keys are still registered but will fail at connection time
 * unless they allow unauthenticated access.
 */
export async function connect(): Promise<void> {
  if (mcpClientInstance) return;

  const servers = await collectAllServers();

  if (servers.length === 0) {
    console.log("  ℹ No MCP servers configured");
    return;
  }

  // Build server definitions with appropriate auth
  const serverDefs: Record<string, { url: URL; requestInit?: RequestInit }> = {};

  for (const server of servers) {
    const config = resolveAuthConfig(server.name);
    const def: { url: URL; requestInit?: RequestInit } = {
      url: server.url,
      requestInit: buildRequestInit(server.name),
    };

    serverDefs[server.name] = def;
    serverNames.push(server.name);
    serverConnectionStatus.set(server.name, "connecting");
    const hasKey = !!resolveApiKey(server.name);
    console.log(
      `  ✓ MCP server configured: ${server.name} (${server.url.hostname}) ${hasKey ? "[API key set]" : "[no API key]"}`
    );
  }

  // Create MCPClient instance
  mcpClientInstance = new MCPClient({
    servers: serverDefs,
    timeout: 30000,
  });

  // Trigger warm-up: list toolsets to detect connection errors early
  try {
    const { toolsets, errors } = await mcpClientInstance.listToolsetsWithErrors();

    for (const [name] of Object.entries(toolsets)) {
      serverConnectionStatus.set(name, "connected");
    }
    for (const [name, errMsg] of Object.entries(errors)) {
      serverConnectionStatus.set(name, "failed");
      serverErrors.set(name, errMsg);

      const isAuthError = /401|403|invalid_token|unauthorized|Unauthorized/i.test(errMsg);
      if (isAuthError) {
        const authCfg = resolveAuthConfig(name);
        const envHint = authCfg ? authCfg.envKey : "API key";
        console.log(`  ✗ MCP auth failed: ${name} — set ${envHint} in .env to enable`);
      } else {
        console.warn(`  ✗ MCP server unreachable: ${name} — ${errMsg}`);
      }
    }

    // Mark any remaining "connecting" servers as failed
    for (const [name, status] of serverConnectionStatus) {
      if (status === "connecting") {
        serverConnectionStatus.set(name, "failed");
        serverErrors.set(name, "No response from server");
        console.warn(`  ✗ MCP server unreachable: ${name} — no response`);
      }
    }

    const connected = Array.from(serverConnectionStatus.values()).filter(
      (s) => s === "connected"
    ).length;
    if (connected > 0) {
      console.log(`  ✓ MCP ready: ${connected}/${servers.length} servers connected`);
    } else {
      console.log(`  ℹ MCP: 0/${servers.length} servers connected — set API keys in .env to enable`);
    }
  } catch (err) {
    console.warn(
      `  ⚠ MCP initialization error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * List all tools from all connected MCP servers.
 * Tools are namespaced as `serverName_toolName`.
 * Returns Mastra-compatible Tool objects ready for Agent definitions.
 */
export async function listTools(): Promise<Record<string, Tool<any, any, any, any>>> {
  if (!mcpClientInstance) {
    console.warn("  ⚠ MCP client not initialized — no tools available");
    return {};
  }

  try {
    const tools = await mcpClientInstance.listTools();
    return tools;
  } catch (err) {
    console.warn(
      `  ⚠ Failed to list MCP tools: ${err instanceof Error ? err.message : String(err)}`
    );
    return {};
  }
}

/**
 * Get the underlying MCPClient instance for direct access.
 */
export function getClient(): MCPClient | null {
  return mcpClientInstance;
}

/**
 * Get the list of all configured server names.
 */
export function getServerNames(): string[] {
  return [...serverNames];
}

/**
 * Get the connection status of all MCP servers.
 */
export function getStatus(): Record<string, { status: string; error?: string }> {
  return getServerStatus();
}

/**
 * Disconnect from all MCP servers.
 */
export async function disconnect(): Promise<void> {
  if (mcpClientInstance) {
    await mcpClientInstance.disconnect();
    mcpClientInstance = null;
    serverConnectionStatus.clear();
    serverErrors.clear();
    serverNames = [];
  }
}

/**
 * Reconnect a single server by name.
 */
export async function reconnectServer(name: string): Promise<void> {
  if (mcpClientInstance) {
    serverConnectionStatus.set(name, "connecting");
    try {
      await mcpClientInstance.reconnectServer(name);
      serverConnectionStatus.set(name, "connected");
      serverErrors.delete(name);
    } catch (err) {
      serverConnectionStatus.set(name, "failed");
      serverErrors.set(name, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}