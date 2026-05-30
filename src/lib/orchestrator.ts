/**
 * Port of orchestrator.py — cross-agent handoff loop.
 *
 * Extracted from orchestrator.ts into scripts/orchestrate.ts as the
 * canonical implementation. This file is kept for backward compatibility
 * re-exporting from the canonical source.
 *
 * In production, replace with Temporal, Airflow, or your firm's workflow engine.
 */

export { extractHandoff, routeHandoff } from "../../scripts/orchestrate.js";
