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
│   │   ├── model-router.ts       # Model string validation, CMA alias mapping, AI Gateway provider
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
└── scripts/                      # check, deploy-agent, sync-skills, validate, orchestrate, smoke, version_bump.py
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
3. `scripts/version_bump.py` auto-patch-bumps plugin versions.

## Architecture

- **CMA depth-1 pattern**: parent supervisor orchestrator → subagent delegation via `agent-<key>` tools → leaf workers
- **Tool gating**: per-subagent Read/Write/Edit/Grep/Glob/Bash via `agent_toolset_20260401`
- **MCP routing**: only the data servers declared per subagent
- **Guardrail processors**: PromptInjectionDetector, PIIDetector, ModerationProcessor on agents handling untrusted data
- **Structured output**: Mastra `structuredOutput` enforces JSON schemas at API level (no post-hoc AJV validation)
- **Model routing**: Model-agnostic — `MODEL_<AGENT_ID>` per-agent env vars → `DEFAULT_MODEL` global → CMA alias fallback → passthrough. Any AI SDK v6 provider works (OpenAI, Anthropic, Google, Mistral, OpenRouter, AI Gateway).
- **Memory**: `@mastra/memory` + `@mastra/libsql` for conversation context on key agents (meeting-prep, earnings-reviewer, pitch-agent)
- **Cross-agent handoff**: `handoff_request` JSON parsed from output, validated against allowlist, routed to target agent
- **Fan-out**: `coverage-list` syntax triggers batch processing across ticker lists
- **AI Gateway**: All models route through `ai-gateway.vercel.sh` when `AI_GATEWAY_API_KEY` is set. Uses `@ai-sdk/gateway` provider.

## Packages

- `ai@6.0.195` — AI SDK v6
- `@ai-sdk/openai@3.0.67`, `@ai-sdk/anthropic@3.0.81`, `@ai-sdk/google@3.0.80`, `@ai-sdk/mistral@3.0.37`
- `@openrouter/ai-sdk-provider@2.9.0`
- `@mastra/core@1.38.0`, `@mastra/mcp@1.9.0`
- `@mastra/memory`, `@mastra/libsql` (new)

Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.
<available_skills>
  <skill>
    <name>customize-opencode</name>
    <description>Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself.</description>
    <location>file:///home/timmy/open-financial-agents/%3Cbuilt-in%3E</location>
  </skill>
  <skill>
    <name>find-skills</name>
    <description>Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.</description>
    <location>file:///home/timmy/.agents/skills/find-skills/SKILL.md</location>
  </skill>
  <skill>
    <name>mastra</name>
    <description>Comprehensive Mastra framework guide for building agents, workflows, tools, memory, workspaces, and storage with current APIs. Use for documentation lookup, API verification, TypeScript setup, common errors, migrations, and `mastra api` CLI tasks: inspect or call resources on local, Mastra platform, or remote servers.</description>
    <location>file:///home/timmy/.agents/skills/mastra/SKILL.md</location>
  </skill>
  <skill>
    <name>opentui</name>
    <description>Build terminal UIs with OpenTUI. Covers the core API, native audio, keymaps, React and Solid bindings, components, layout, keyboard input, plugins, and testing.</description>
    <location>file:///home/timmy/.agents/skills/opentui/SKILL.md</location>
  </skill>
</available_skills>
