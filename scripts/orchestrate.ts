/**
 * Cross-agent handoff routing + fan-out coverage list support.
 *
 * Port of orchestrate.py — handles:
 *   1. Handoff extraction: parse handoff_request JSON from agent output
 *   2. Handoff routing: validate against allowlist and dispatch to target agent
 *   3. Fan-out: iterate across coverage lists for batch processing
 *
 * Security: hard-allowlists target_agent against deployed slugs,
 * schema-validates the payload before steering.
 */

import type { Agent } from "@mastra/core/agent";
import { z } from "zod";

const HANDOFF_RE = /\{"type":\s*"handoff_request".*?\}/s;

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

const HandoffPayloadSchema = z.object({
  event: z.string().max(2000),
  context_ref: z.string().max(256).regex(/^[A-Za-z0-9 ._/:#-]+$/).optional(),
});

const HandoffRequestSchema = z.object({
  type: z.literal("handoff_request"),
  target_agent: z.string(),
  payload: HandoffPayloadSchema,
});

export type HandoffRequest = z.infer<typeof HandoffRequestSchema>;

/**
 * Extract a handoff request from agent output text.
 * Returns null if no valid handoff is found.
 */
export function extractHandoff(text: string): HandoffRequest | null {
  const match = HANDOFF_RE.exec(text);
  if (!match) return null;

  try {
    const obj = JSON.parse(match[0]);
    const parsed = HandoffRequestSchema.safeParse(obj);

    if (!parsed.success) return null;
    if (!ALLOWED_TARGETS.has(parsed.data.target_agent)) return null;

    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Route a handoff to the target agent via the agent registry.
 */
export async function routeHandoff(
  text: string,
  agentRegistry: Record<string, Agent>
): Promise<{ targetSlug: string; result: string } | null> {
  const handoff = extractHandoff(text);
  if (!handoff) return null;

  const targetAgent = agentRegistry[handoff.target_agent];
  if (!targetAgent) return null;

  const result = await targetAgent.generate(handoff.payload.event);
  return {
    targetSlug: handoff.target_agent,
    result: result.text,
  };
}

// ── Coverage list / fan-out ─────────────────────────────────────────

/** Regex to detect coverage-list steering events */
const COVERAGE_LIST_RE = /coverage-list\s+(\S+)/i;

/**
 * Parse a steering event string for coverage-list fan-out directives.
 * Returns the list name if this is a batch operation, null otherwise.
 *
 * Examples:
 *   "Process earnings: coverage-list semis, period Q1-FY27" → "semis"
 *   "Process earnings: NVDA Q1-FY27" → null
 */
export function detectCoverageList(event: string): string | null {
  const match = COVERAGE_LIST_RE.exec(event);
  return match ? match[1] : null;
}

/**
 * Resolve a coverage list name to an array of tickers.
 * In production, this would query a database or external API.
 * The stub returns ticker lists for common coverage sets.
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
