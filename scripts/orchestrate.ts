/**
 * Cross-agent handoff routing + fan-out coverage list support.
 *
 * Port of orchestrate.py — handles:
 *   1. Handoff extraction: parse handoff_request JSON from agent output
 *   2. Handoff routing: validate against allowlist and dispatch to target agent
 *   3. Fan-out: iterate across coverage lists for batch processing
 *   4. Direct agent dispatch: resolve + call agent.generate()
 *
 * Security: hard-allowlists target_agent against deployed slugs,
 * schema-validates the payload before steering.
 */

import type { Agent } from "@mastra/core/agent";
import type { Mastra } from "@mastra/core/mastra";

// ── Handoff types + parsing ─────────────────────────────────────────

export interface HandoffRequest {
  type: "handoff_request";
  target_agent: string;
  payload: {
    event: string;
    context_ref?: string;
  };
}

const HANDOFF_RE = /\{"type":\s*"handoff_request".*?\}/s;

/**
 * Extract and validate a handoff request from agent output text.
 * Returns null if no valid handoff is found.
 */
export function parseHandoffRequest(text: string): HandoffRequest | null {
  const match = HANDOFF_RE.exec(text);
  if (!match) return null;

  try {
    const obj = JSON.parse(match[0]);
    if (
      obj.type !== "handoff_request" ||
      typeof obj.target_agent !== "string" ||
      !obj.payload ||
      typeof obj.payload.event !== "string"
    ) {
      return null;
    }
    return {
      type: "handoff_request",
      target_agent: obj.target_agent,
      payload: {
        event: obj.payload.event,
        ...(typeof obj.payload.context_ref === "string" ? { context_ref: obj.payload.context_ref } : {}),
      },
    };
  } catch {
    return null;
  }
}

// ── Agent dispatch ────────────────────────────────────────────────

/**
 * Resolve an agent by scoped key ("cookbook/subagent") or bare name.
 * Falls back to partial match on scoped keys ending with "/{name}".
 */
function resolveAgent(mastra: Mastra, agentId: string): Agent {
  // Try direct lookup with scoped key
  const direct = mastra.getAgent(agentId);
  if (direct) return direct;

  // Try bare name: find a scoped key ending with "/{agentId}"
  const allAgents = (mastra as unknown as Record<string, unknown>).agents ?? ({} as Record<string, unknown>);
  const scopedKey = Object.keys(allAgents).find(
    (key) => key.endsWith(`/${agentId}`) || key === agentId
  );
  if (scopedKey) {
    const found = mastra.getAgent(scopedKey);
    if (found) return found;
  }

  throw new Error(`Agent not found: ${agentId}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer!));
}

/**
 * Dispatch a subagent by scoped ID or bare name.
 *
 * Workflows resolve agents directly via Mastra instead of going through
 * a separate dispatch layer.
 *
 * Resolution order:
 * 1. Direct lookup via mastra.getAgent(id) with scoped key
 * 2. If no "/" in id, try finding a scoped key ending with "/{id}"
 * 3. Error if neither works
 */
export async function dispatchAgent(
  mastra: Mastra,
  agentId: string,
  prompt: string,
  options: { timeoutMs?: number } = {}
): Promise<string> {
  const { timeoutMs = 60000 } = options;
  const agent = resolveAgent(mastra, agentId);
  const result = await withTimeout(agent.generate(prompt), timeoutMs, `Agent "${agentId}"`);
  return result.text;
}

// ── Handoff routing ────────────────────────────────────────────────

const ALLOWED_TARGETS = new Set([
  "pitch-agent",
  "market-researcher",
  "earnings-reviewer",
  "meeting-prep-agent",
  "model-builder",
  "gl-reconciler",
  "kyc-screener",
  "valuation-reviewer",
  "month-end-closer",
  "statement-auditor",
]);

export { ALLOWED_TARGETS };

/**
 * Extract a handoff request from agent output text.
 * Returns null if no valid handoff is found or target is not in allowlist.
 */
export function extractHandoff(text: string): HandoffRequest | null {
  const handoff = parseHandoffRequest(text);
  if (!handoff) return null;
  if (!ALLOWED_TARGETS.has(handoff.target_agent)) return null;
  return handoff;
}

/**
 * Route a handoff to the target agent via the agent registry.
 * Delegates to dispatchAgent for consistent timeout + resolution.
 */
export async function routeHandoff(
  text: string,
  agentRegistry: Record<string, Agent>
): Promise<{ targetSlug: string; result: string } | null> {
  const handoff = extractHandoff(text);
  if (!handoff) return null;

  const targetAgent = agentRegistry[handoff.target_agent];
  if (!targetAgent) return null;

  const result = await dispatchAgent(
    { getAgent: (id: string) => agentRegistry[id] } as any,
    handoff.target_agent,
    handoff.payload.event
  );
  return {
    targetSlug: handoff.target_agent,
    result,
  };
}

// ── Coverage list / fan-out ─────────────────────────────────────────

/** Regex to detect coverage-list steering events */
const COVERAGE_LIST_RE = /coverage-list\s+(\S+)/i;

/**
 * Parse a steering event string for coverage-list fan-out directives.
 * Returns the list name if this is a batch operation, null otherwise.
 */
export function detectCoverageList(event: string): string | null {
  const match = COVERAGE_LIST_RE.exec(event);
  return match ? match[1] : null;
}

/**
 * Resolve a coverage list name to an array of tickers.
 * In production, this would query a database or external API.
 */
export function resolveCoverageList(listName: string): string[] {
  const lists: Record<string, string[]> = {
    semis: ["NVDA", "AMD", "INTC", "QCOM", "AVGO", "MRVL", "MU", "TXN"],
    faang: ["META", "AAPL", "AMZN", "NFLX", "GOOGL"],
    banks: ["JPM", "BAC", "WFC", "C", "GS", "MS"],
    biotech: ["REGN", "VRTX", "BIIB", "GILD", "MRNA"],
    energy: ["XOM", "CVX", "COP", "EOG", "SLB"],
    industrials: ["CAT", "DE", "GE", "HON", "MMM", "BA"],
    consumer: ["PG", "KO", "PEP", "WMT", "COST", "HD"],
  };

  return lists[listName.toLowerCase()] || [listName];
}

/**
 * Fan out a steering event across a coverage list.
 * Returns entries for each ticker in the list.
 */
export function fanOutCoverageList(
  event: string,
  listName: string
): Array<{ ticker: string; event: string }> {
  const tickers = resolveCoverageList(listName);

  return tickers.map((ticker) => ({
    ticker,
    event: event.replace(
      /coverage-list\s+\S+/i,
      ticker
    ),
  }));
}
