# Open Financial Agents

Model-agnostic, open-source financial services agent platform — ported from [Anthropic's financial-services reference library](https://github.com/anthropics/financial-services) and built on [Mastra](https://mastra.ai) with support for any LLM provider (OpenAI, Anthropic, Google, Mistral, OpenRouter, or Vercel AI Gateway).

Everything here is available as Mastra agents. Same system prompts, same skills — deploy as a Mastra server, run via CLI, or integrate into your own application.

> [!IMPORTANT]
> Nothing in this repository constitutes investment, legal, tax, or accounting advice. These agents draft analyst work product — models, memos, research notes, reconciliations — for review by a qualified professional. They do not make investment recommendations, execute transactions, bind risk, post to a ledger, or approve onboarding; every output is staged for human sign-off. You are responsible for verifying outputs and for compliance with the laws and regulations that apply to your firm.

## Agents

| Function | Agent | What it does |
|---|---|---|
| **Coverage & advisory** | **[Pitch Agent](./src/agents/pitch-agent.md)** | Comps, precedents, LBO → branded pitch deck, end to end |
| | **[Meeting Prep Agent](./src/agents/meeting-prep-agent.md)** | Briefing pack before every client meeting |
| **Research & modeling** | **[Market Researcher](./src/agents/market-researcher.md)** | Sector or theme → industry overview, competitive landscape, peer comps, ideas shortlist |
| | **[Earnings Reviewer](./src/agents/earnings-reviewer.md)** | Earnings call + filings → model update → note draft |
| | **[Model Builder](./src/agents/model-builder.md)** | DCF, LBO, 3-statement, comps — live in Excel |
| **Fund admin & finance ops** | **[Valuation Reviewer](./src/agents/valuation-reviewer.md)** | Ingests GP packages, runs valuation template, stages LP reporting |
| | **[GL Reconciler](./src/agents/gl-reconciler.md)** | Finds breaks, traces root cause, routes for sign-off |
| | **[Month-End Closer](./src/agents/month-end-closer.md)** | Accruals, roll-forwards, variance commentary |
| | **[Statement Auditor](./src/agents/statement-auditor.md)** | Audits LP statements before distribution |
| **Operations & onboarding** | **[KYC Screener](./src/agents/kyc-screener.md)** | Parses onboarding docs, runs the rules engine, flags gaps |

For Managed Agent deployment — `agent.yaml`, leaf-worker subagents, steering-event examples, and per-agent security notes — see **[managed-agent-cookbooks/](./managed-agent-cookbooks)**.

## Repository Layout

```
src/                           # All source code
  agents/                      # 10 agent .md files (canonical system prompts)
  workflows/                   # 10 Mastra workflows
  tools/                       # CMA tool implementations (read/write/edit/grep/glob/bash)
  lib/                         # Shared utilities (CMA loader, model router, dispatch)
  mcp/                         # MCP client + 19-server data connector configs
  commands/                    # 40+ slash commands
  skills/                      # 7 vertical skill directories (source of truth)
  agent-skills/                # Bundled skill copies per agent (synced from src/skills/)
  test/                        # Vitest tests
managed-agent-cookbooks/       # CMA cookbooks — one dir per agent
partner-plugins/               # Partner-authored plugins (LSEG, S&P Global)
claude-for-msft-365-install/   # Admin tooling for Microsoft 365 add-in
scripts/                       # check · deploy · sync · validate · orchestrate · version-bump
```

## Getting Started

### Prerequisites

```bash
npm install            # installs dependencies
cp .env.example .env   # configure API keys
```

### Environment Variables

```bash
# LLM provider (pick one)
OPENAI_API_KEY=sk-...              # OpenAI
ANTHROPIC_API_KEY=sk-ant-...       # Anthropic
GOOGLE_GENERATIVE_AI_API_KEY=...   # Google
MISTRAL_API_KEY=...                # Mistral
OPENROUTER_API_KEY=sk-or-...       # OpenRouter

# Vercel AI Gateway (routes through gateway.vercel.sh)
AI_GATEWAY_API_KEY=vck_...         # AI Gateway key
DEFAULT_MODEL=minimax/minimax-m3   # Model to use via gateway

# Guardrails (optional, defaults to openrouter/openai/gpt-oss-safeguard-20b)
GUARDRAIL_MODEL=anthropic/claude-haiku-4-5

# Storage (optional, defaults to in-memory)
MASTRA_DB_URL=file:./mastra.db     # LibSQL for conversation memory
```

### Run the CLI

```bash
# List all available agents
npm run cli -- list

# Run an agent
npm run cli -- run pitch-agent "Build pitch book: target NVDA, acquirer ORCL, situation: exploring strategic alternatives"
```

### Mastra Dev Server

```bash
npm run dev            # start Mastra dev server on :4111
```

### Type Check & Test

```bash
npx tsc --noEmit       # TypeScript type-check (must pass before commit)
npx tsx scripts/check.ts  # Lint manifests + verify cross-file refs
npm test               # Run vitest tests (55 tests)
```

## How It Fits Together

| | What it is | Where it lives |
|---|---|---|
| **Agents** | System prompts that define agent behavior and workflow | `src/agents/<slug>.md` |
| **Workflows** | Mastra step functions that orchestrate subagent dispatch | `src/workflows/<slug>-workflow.ts` |
| **Skills** | Domain expertise, conventions, and step-by-step methods | `src/skills/<vertical>/` (source) · `src/agent-skills/<slug>/` (bundled) |
| **Commands** | Slash actions you trigger explicitly (`/comps`, `/earnings`, `/ic-memo`) | `src/commands/` |
| **Connectors** | [MCP servers](https://modelcontextprotocol.io/) that wire agents to financial data | `src/mcp/mcp.json` |
| **Managed-agent wrappers** | `agent.yaml` + depth-1 subagents + steering examples for headless deployment | `managed-agent-cookbooks/<slug>/` |

## Architecture

### CMA Depth-1 Pattern

Parent orchestrator → subagent delegation via `agent-<key>` tools → leaf workers.

- **Supervisor agents**: Parent orchestrators use Mastra's `agents` config with subagent Agent instances. Mastra creates `agent-<key>` tools automatically.
- **Workflow dispatch**: `dispatchSubagentValidated()` resolves scoped/bare agent names with timeout.
- **Tool gating**: Per-subagent Read/Write/Edit/Grep/Glob/Bash via `agent_toolset_20260401`.
- **MCP routing**: Only the data servers declared per subagent.
- **Cross-agent handoff**: `handoff_request` JSON parsed from output, validated against allowlist, routed to target agent.
- **Fan-out**: `coverage-list` syntax triggers batch processing across ticker lists.

### Guardrail Processors

All agents handling untrusted data get:
- **PromptInjectionDetector** — detects injection, jailbreak, system-override attacks (kyc-screener, earnings-reviewer, market-researcher, meeting-prep-agent)
- **PIIDetector** — redacts email, phone, credit-card (kyc-screener, meeting-prep-agent)
- **ModerationProcessor** — blocks hate, harassment, violence on all agent outputs

### Memory

Conversation context via `@mastra/memory` + `@mastra/libsql`:
- meeting-prep-agent, earnings-reviewer, pitch-agent
- 20-message window, observational memory enabled

### Structured Output

Mastra's `structuredOutput` enforces JSON schemas at the API level (no post-hoc validation). Falls back to plain text if the model doesn't support structured output with tools.

### Model Routing

`resolveModelString()` returns `"provider/model"` strings — Mastra resolves providers internally. When AI Gateway is configured, all models route through `ai-gateway.vercel.sh` automatically.

## MCP Integrations

All connectors are configured in `src/mcp/mcp.json`. Supports 19 financial data providers:

| Provider | URL |
|---|---|
| [Daloopa](https://www.daloopa.com/) | `https://mcp.daloopa.com/server/mcp` |
| [Morningstar](https://www.morningstar.com/) | `https://mcp.morningstar.com/mcp` |
| [S&P Global](https://www.spglobal.com/) | `https://kfinance.kensho.com/integrations/mcp` |
| [FactSet](https://www.factset.com/) | `https://mcp.factset.com/mcp` |
| [Moody's](https://www.moodys.com/) | `https://api.moodys.com/genai-ready-data/m1/mcp` |
| [MT Newswires](https://www.mtnewswires.com/) | `https://vast-mcp.blueskyapi.com/mtnewswires` |
| [Aiera](https://www.aiera.com/) | `https://mcp-pub.aiera.com` |
| [LSEG](https://www.lseg.com/) | `https://api.analytics.lseg.com/lfa/mcp` |
| [PitchBook](https://pitchbook.com/) | `https://premium.mcp.pitchbook.com/mcp` |
| [Chronograph](https://www.chronograph.pe/) | `https://ai.chronograph.pe/mcp` |
| [Egnyte](https://www.egnyte.com/) | `https://mcp-server.egnyte.com/mcp` |
| [Box](https://www.box.com/home) | `https://mcp.box.com` |

> MCP access may require a subscription or API key from the provider.

## Vertical Skills

| Vertical | What it adds |
|---|---|
| **[financial-analysis](./src/skills/financial-analysis)** *(core)* | Comps, DCF, LBO, 3-statement, deck QC, Excel audit |
| **[investment-banking](./src/skills/investment-banking)** | CIMs, teasers, process letters, buyer lists, merger models |
| **[equity-research](./src/skills/equity-research)** | Earnings notes, initiations, model updates, thesis tracking |
| **[private-equity](./src/skills/private-equity)** | Sourcing, screening, diligence checklists, IC memos |
| **[wealth-management](./src/skills/wealth-management)** | Client reviews, financial plans, rebalancing, reporting |
| **[fund-admin](./src/skills/fund-admin)** | GL recon, break tracing, accruals, roll-forwards, NAV tie-out |
| **[operations](./src/skills/operations)** | KYC document parsing and rules-grid evaluation |

51 bundled skills across 10 agents. Sync from source with:
```bash
npx tsx scripts/sync-skills.ts
```

## Making It Yours

These are reference templates — they get better when you tune them to how your firm works.

- **Swap connectors** — point `src/mcp/mcp.json` at your data providers and internal systems.
- **Add firm context** — drop your terminology, processes, and formatting standards into skill files.
- **Adjust agent scope** — edit `src/agents/<slug>.md` to match how your team actually runs the workflow.
- **Add your own** — copy the structure for workflows we haven't covered.

## License

[Apache License 2.0](./LICENSE)
