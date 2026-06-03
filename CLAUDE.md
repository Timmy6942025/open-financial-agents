# Open Financial Agents

Model-agnostic financial services agent platform built on [Mastra](https://mastra.ai). Ported from Anthropic's financial-services reference library with a full TypeScript/Mastra architecture.

## Repository Structure

```
├── src/
│   ├── mastra/index.ts           # Mastra entry point — connects MCP, loads cookbooks, registers agents/workflows
│   ├── agents/                   # 10 agent .md files (canonical system prompts with YAML frontmatter)
│   │   └── <slug>.md
│   ├── workflows/                # 10 Mastra workflows — one per agent (CMA depth-1 pattern)
│   │   └── <slug>-workflow.ts
│   ├── tools/                    # CMA tool implementations
│   │   └── cma-tools.ts          # Read/Write/Edit/Grep/Glob/Bash tool wrappers
│   ├── lib/                      # Shared utilities
│   │   ├── cma-loader.ts         # Single-pass CMA cookbook loader (agent.md + YAML → Mastra Agent)
│   │   ├── cma-skill-loader.ts   # SKILL.md resolution from src/agent-skills/ and src/skills/
│   │   ├── command-loader.ts     # Slash command loader
│   │   ├── dispatch.ts           # Subagent dispatch helper (scoped/bare name resolution + timeout)
│   │   ├── model-router.ts       # Model string validation and CMA alias mapping
│   │   └── skill-loader.ts       # Legacy skill loader
│   ├── mcp/                      # MCP client + 19-server config
│   │   ├── mcp-client.ts         # MCP connection, auth, tool listing, reconnect
│   │   └── mcp.json              # MCP server URLs (19 providers)
│   ├── commands/                 # 40+ slash commands (.md files by vertical)
│   ├── skills/                   # 7 vertical skill directories (source of truth)
│   │   └── <vertical>/<skill>/
│   ├── agent-skills/             # Bundled skill copies per agent (synced from src/skills/)
│   │   └── <slug>/skills/<skill>/SKILL.md
│   └── test/                     # Vitest tests
├── managed-agent-cookbooks/      # CMA cookbooks (one per agent, agent.yaml + subagents/ + steering)
│   └── <slug>/
│       ├── agent.yaml             # References system prompt + skills from src/ layout
│       ├── subagents/*.yaml
│       ├── steering-examples.json
│       └── README.md
├── partner-plugins/              # LSEG + S&P Global partner plugins
├── claude-for-msft-365-install/  # Admin tooling for Microsoft 365 add-in
└── scripts/                      # check, deploy, sync, validate, orchestrate, version-bump
```

## Development

```bash
npm install            # installs dependencies
npx tsc --noEmit       # type-check (must pass before commit)
npx tsx scripts/check.ts  # lint manifests + verify cross-file refs
npm test               # run vitest tests
npm run dev            # start Mastra dev server on :4111
npm run cli -- list    # list all available agents
npm run cli -- run <slug> "prompt"  # run an agent via CLI
```

## Key Workflows

1. Edit skills in `src/skills/<vertical>/`, then run `npm run sync-skills` to propagate to agent bundles.
2. Run `npx tsx scripts/check.ts` before committing — it lints manifests, verifies references resolve, and catches drift.
3. `scripts/version_bump.py` auto-patch-bumps plugins via pre-commit hook (`.githooks/pre-commit`).

## Architecture

- **CMA depth-1 pattern**: parent supervisor orchestrator → subagent delegation via `agent-<key>` tools → leaf workers
- **Tool gating**: per-subagent Read/Write/Edit/Grep/Glob/Bash via `agent_toolset_20260401`
- **MCP routing**: only the data servers declared per subagent
- **Guardrail processors**: PromptInjectionDetector, PIIDetector, ModerationProcessor on agents handling untrusted data
- **Structured output**: Mastra `structuredOutput` enforces JSON schemas at API level (no post-hoc AJV validation)
- **Model routing**: `resolveModelString()` returns `"provider/model"` strings — Mastra resolves providers internally
- **Memory**: `@mastra/memory` + `@mastra/libsql` for conversation context on key agents (meeting-prep, earnings-reviewer, pitch-agent)
- **Cross-agent handoff**: `handoff_request` JSON parsed from output, validated against allowlist, routed to target agent
- **Fan-out**: `coverage-list` syntax triggers batch processing across ticker lists
- **AI Gateway**: All models route through `ai-gateway.vercel.sh` when `AI_GATEWAY_API_KEY` is set. Uses `@ai-sdk/gateway` provider. Guardrail models also route through gateway.

## Packages

- `ai@6.0.195` — AI SDK v6
- `@ai-sdk/openai@3.0.67`, `@ai-sdk/anthropic@3.0.81`, `@ai-sdk/google@3.0.80`, `@ai-sdk/mistral@3.0.37`
- `@openrouter/ai-sdk-provider@2.9.0`
- `@mastra/core@1.38.0`, `@mastra/mcp@1.9.0`
- `@mastra/memory`, `@mastra/libsql` (new)
