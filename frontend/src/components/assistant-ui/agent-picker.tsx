"use client";

import { useState } from "react";

const AGENTS = [
  { id: "pitch-agent", name: "Pitch Agent", description: "M&A pitch decks and deal origination" },
  { id: "earnings-reviewer", name: "Earnings Reviewer", description: "Quarterly earnings analysis and review" },
  { id: "market-researcher", name: "Market Researcher", description: "Market and sector research" },
  { id: "model-builder", name: "Model Builder", description: "Financial model construction" },
  { id: "meeting-prep-agent", name: "Meeting Prep", description: "Client meeting preparation" },
  { id: "gl-reconciler", name: "GL Reconciler", description: "General ledger reconciliation" },
  { id: "kyc-screener", name: "KYC Screener", description: "Know-your-customer screening" },
  { id: "valuation-reviewer", name: "Valuation Reviewer", description: "Valuation analysis and review" },
  { id: "month-end-closer", name: "Month-End Closer", description: "Month-end close process" },
  { id: "statement-auditor", name: "Statement Auditor", description: "Financial statement auditing" },
] as const;

export type AgentId = (typeof AGENTS)[number]["id"];

interface AgentPickerProps {
  selectedAgent: AgentId;
  onAgentChange: (agentId: AgentId) => void;
}

export function AgentPicker({ selectedAgent, onAgentChange }: AgentPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const current = AGENTS.find((a) => a.id === selectedAgent)!;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <span className="h-2 w-2 rounded-full bg-green-500" />
        <span className="font-medium">{current.name}</span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
            <div className="p-1">
              {AGENTS.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => {
                    onAgentChange(agent.id);
                    setIsOpen(false);
                  }}
                  className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
                    agent.id === selectedAgent
                      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  <div className="text-sm font-medium">{agent.name}</div>
                  <div className="text-xs text-gray-500">{agent.description}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export { AGENTS };
