"use client";

import { useState, useMemo } from "react";
import { MenuIcon } from "lucide-react";
import { AssistantRuntimeProvider, useAui, Suggestions } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { AgentPicker, type AgentId } from "@/components/assistant-ui/agent-picker";
import {
  ReadToolUI,
  WriteToolUI,
  EditToolUI,
  GrepToolUI,
  GlobToolUI,
  BashToolUI,
} from "@/components/assistant-ui/tool-ui-cma";
import { createLocalHistoryAdapter } from "@/components/assistant-ui/history-adapter";

const MASTRA_URL = process.env.NEXT_PUBLIC_MASTRA_URL ?? "http://localhost:4111/api/chat";

const historyAdapter = createLocalHistoryAdapter();

const AGENT_SUGGESTIONS: Record<AgentId, Array<{ title: string; label: string; prompt: string }>> = {
  "pitch-agent": [
    { title: "Create M&A pitch", label: "for a mid-market tech acquisition", prompt: "Create an M&A pitch deck for a mid-market technology company acquisition in the enterprise SaaS space" },
    { title: "Analyze deal comps", label: "in the healthcare sector", prompt: "Analyze recent comparable M&A transactions in the healthcare sector and identify valuation trends" },
    { title: "Draft buyer list", label: "for a manufacturing company", prompt: "Draft a potential buyer list for a $200M revenue manufacturing company looking for strategic acquirers" },
  ],
  "earnings-reviewer": [
    { title: "Review quarterly earnings", label: "for AAPL", prompt: "Review Apple's latest quarterly earnings and identify key takeaways for investors" },
    { title: "Compare guidance", label: "across FAANG stocks", prompt: "Compare forward guidance across FAANG stocks this quarter and identify divergences" },
    { title: "Analyze margin trends", label: "in semiconductor sector", prompt: "Analyze gross margin trends in the semiconductor sector over the last 4 quarters" },
  ],
  "market-researcher": [
    { title: "Research AI market", label: "enterprise adoption trends", prompt: "Research the enterprise AI adoption market size, growth rate, and key players" },
    { title: "Sector deep dive", label: "on clean energy", prompt: "Provide a deep dive analysis of the clean energy sector including regulatory tailwinds and competitive dynamics" },
    { title: "TAM analysis", label: "for fintech vertical", prompt: "Estimate the total addressable market for B2B fintech infrastructure over the next 5 years" },
  ],
  "model-builder": [
    { title: "Build DCF model", label: "for a SaaS company", prompt: "Build a DCF valuation model for a high-growth SaaS company with $50M ARR growing 40% YoY" },
    { title: "LBO analysis", label: "for a retail chain", prompt: "Create an LBO model for a $500M revenue retail chain with stable cash flows" },
    { title: "Sensitivity analysis", label: "on revenue assumptions", prompt: "Run sensitivity analysis on revenue growth and margin assumptions for a 3-statement model" },
  ],
  "meeting-prep-agent": [
    { title: "Prepare for board meeting", label: "with quarterly updates", prompt: "Prepare talking points and Q&A prep for an upcoming board meeting covering quarterly performance" },
    { title: "Client meeting brief", label: "for portfolio review", prompt: "Prepare a client meeting brief for a portfolio review meeting with a $50M institutional client" },
    { title: "Investor day prep", label: "with presentation notes", prompt: "Prepare presentation notes and anticipated investor questions for an upcoming investor day" },
  ],
  "gl-reconciler": [
    { title: "Reconcile GL accounts", label: "for month-end close", prompt: "Reconcile the general ledger accounts for month-end close and identify any discrepancies" },
    { title: "Investigate variance", label: "in operating expenses", prompt: "Investigate a 15% variance in operating expenses versus budget and provide root cause analysis" },
    { title: "Review intercompany", label: "elimination entries", prompt: "Review intercompany elimination entries for consolidation accuracy" },
  ],
  "kyc-screener": [
    { title: "Screen entity", label: "for AML compliance", prompt: "Screen a new corporate entity for AML/KYC compliance and flag any adverse findings" },
    { title: "Enhanced due diligence", label: "on PEP exposure", prompt: "Conduct enhanced due diligence on a client with potential politically exposed person connections" },
    { title: "Sanctions check", label: "for cross-border transaction", prompt: "Run sanctions screening for a cross-border transaction involving multiple jurisdictions" },
  ],
  "valuation-reviewer": [
    { title: "Review DCF valuation", label: "methodology and assumptions", prompt: "Review the DCF valuation methodology and key assumptions for a target company analysis" },
    { title: "Comparable analysis", label: "for tech sector valuation", prompt: "Review comparable company analysis for a technology sector valuation and assess selection criteria" },
    { title: "Fair value opinion", label: "for intangible assets", prompt: "Assess fair value of intangible assets including patents, customer relationships, and brand value" },
  ],
  "month-end-closer": [
    { title: "Close checklist", label: "for fiscal month-end", prompt: "Generate a month-end close checklist and identify any outstanding items for completion" },
    { title: "Review accruals", label: "and prepayments", prompt: "Review accrual and prepayment entries for accuracy and completeness" },
    { title: "Reconcile subledgers", label: "to GL", prompt: "Reconcile accounts payable and accounts receivable subledgers to the general ledger" },
  ],
  "statement-auditor": [
    { title: "Audit financials", label: "for revenue recognition", prompt: "Audit the financial statements focusing on revenue recognition compliance under ASC 606" },
    { title: "Review disclosures", label: "for completeness", prompt: "Review financial statement disclosures for completeness and compliance with GAAP requirements" },
    { title: "Test internal controls", label: "over financial reporting", prompt: "Assess the design and operating effectiveness of internal controls over financial reporting" },
  ],
};

function AssistantContent() {
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("pitch-agent");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const api = `${MASTRA_URL}/${selectedAgent}`;

  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api }),
    adapters: { history: historyAdapter },
  });

  const suggestions = useMemo(() => {
    const agentSuggestions = AGENT_SUGGESTIONS[selectedAgent];
    return Suggestions(
      agentSuggestions.map((s) => ({
        title: s.title,
        label: s.label,
        prompt: s.prompt,
      }))
    );
  }, [selectedAgent]);

  const aui = useAui({ suggestions });

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-gray-950">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Toggle sidebar"
          >
            <MenuIcon className="h-5 w-5 text-gray-500" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Open Financial Agents
          </h1>
          <AgentPicker
            selectedAgent={selectedAgent}
            onAgentChange={setSelectedAgent}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            Powered by Mastra + assistant-ui
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="w-64 border-r border-gray-200 dark:border-gray-800 p-3 overflow-y-auto">
            <ThreadList />
          </aside>
        )}

        {/* Chat Area */}
        <main className="flex-1 overflow-hidden">
          <AssistantRuntimeProvider key={selectedAgent} aui={aui} runtime={runtime}>
            {/* Tool UIs — registered inside provider, rendered automatically on tool-call parts */}
            <ReadToolUI />
            <WriteToolUI />
            <EditToolUI />
            <GrepToolUI />
            <GlobToolUI />
            <BashToolUI />
            <Thread />
          </AssistantRuntimeProvider>
        </main>
      </div>
    </div>
  );
}

export function Assistant() {
  return <AssistantContent />;
}
