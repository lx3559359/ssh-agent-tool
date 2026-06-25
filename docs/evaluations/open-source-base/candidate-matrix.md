# Candidate Matrix

Scoring: 1 = poor, 3 = usable, 5 = strong. Scores are evidence-backed only for evaluated candidates.

| Candidate | License | Local Build | SSH/PTTY | Agent API | Skills | MCP | Extensibility | Windows Fit | Fork Risk | Total | Recommendation |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| WinkTerm | MIT | 2 | 5 | 5 | 5 | 2 | 4 | 2 | 3 | 28 | Primary candidate for Task 2 evidence: strong SSH/PTTY and Agent API base, but local runtime is blocked by missing Docker/Python/Node and MCP is not native. |
| Chaterm | GPL-3.0 | 1 | 5 | 4 | 5 | 5 | 4 | 2 | 1 | 27 | Product and architecture reference. Static evidence is strong for SSH/PTTY, Agent, Skills, and MCP, but runtime is blocked by missing Node/npm and direct fork risk is high because of GPL-3.0 and broad Electron app scope. |
| mcp-ssh-manager | MIT | 1 | 4 | 4 | 1 | 5 | 4 | 3 | 4 | 26 | Supporting component only: reuse MCP tool schema, SFTP/sync, health checks, tool activation, and audit ideas; not a primary product base because it is a broad MCP utility without product UI or built-in skill workflow. |
| mcp-ssh-orchestrator | Apache-2.0 | 1 | 3 | 4 | 2 | 5 | 4 | 2 | 4 | 25 | Supporting component only: reuse deny-by-default policy, `ssh_plan`, structured denials, host/tag resources, async task pattern, and audit design; not a primary product base because it intentionally omits PTY, file transfer, and product UI. |

## WinkTerm Score Evidence

| Criterion | Score | Evidence |
|---|---:|---|
| Local Build | 2 | Clone/static inspection passed, but Docker, Python, Node.js, and npm are missing on this machine, so Docker Compose, backend, and frontend runtime checks are blocked. |
| SSH/PTTY | 5 | `backend/terminal/pty_manager.py` supports local PTY and SSH PTY paths; `backend/ssh/paramiko_channel.py` wraps Paramiko shell channels; frontend uses xterm.js. |
| Agent API | 5 | `backend/api/agent_routes.py` exposes `/api/agent` terminal exec/input/snapshot/stream, SSH CRUD, one-shot SSH run, async jobs, events, and file-transfer routes. |
| Skills | 5 | `agent-skill/SKILL.md` exists and is served by `/api/agent/skill.md`; README documents installable Claude Code plugin and raw skill download. |
| MCP | 2 | No MCP server implementation found during `/api/agent`, skill, `ssh_run`, `terminal_exec`, OpenAI, and related-term search; reusable surface is HTTP/WS/CLI rather than MCP-native. |
| Extensibility | 4 | Modular directories (`backend`, `frontend`, `cli`, `agent-skill`, `desktop`) and explicit Agent API make extension practical, though behavior spans several runtimes. |
| Windows Fit | 2 | Source includes Windows PTY support through `pywinpty` and PyInstaller desktop packaging, but local Windows run is blocked by missing Python, Node.js/npm, and Docker. |
| Fork Risk | 3 | MIT license and modular layout are favorable; risk remains medium because the fork would inherit Python + Next.js + npm CLI + Docker + desktop packaging and a powerful command-execution API needing safety hardening. |

## Chaterm Score Evidence

| Criterion | Score | Evidence |
|---|---:|---|
| Local Build | 1 | Clone/static inspection passed, but README setup requires `node scripts/patch-package-lock.js`, `npm install`, and `npm run dev`; README/package build scripts need reconciliation (`build:win` vs `build:win:cn`/`build:win:global`); `node`, `npm`, and `pnpm` are not recognized on this machine, so runtime/build is BLOCKED. |
| SSH/PTTY | 5 | STATIC YES: `package.json` depends on `ssh2`, `node-pty`, and `@xterm/xterm`; `src/main/ssh/sshHandle.ts` registers SSH connect/shell/exec handlers; `src/main/ssh/localSSHHandle.ts` uses `pty.spawn`. |
| Agent API | 4 | STATIC YES: `src/main/agent` contains provider, prompt, task, terminal-integration, tool, storage, and controller layers; renderer has Agents mode, but the surface is integrated Electron IPC/UI rather than a small standalone API. |
| Skills | 5 | STATIC YES: `src/main/agent/services/skills/SkillsManager.ts` manages `SKILL.md`, prompt injection, ZIP import/export, and create/update flows; `src/main/index.ts` and `src/preload/index.ts` expose `skills:*` IPC. |
| MCP | 5 | STATIC YES: `@modelcontextprotocol/sdk` is a dependency; `src/main/agent/services/mcp/McpHub.ts` supports stdio/SSE/streamable HTTP transports, `callTool`, server listing, and tool auto-approval; UI and IPC expose MCP settings. |
| Extensibility | 4 | Provider adapters exist for Anthropic, Bedrock, DeepSeek, LiteLLM, Ollama, and OpenAI; repository has organized `src/main`, `src/preload`, `src/renderer`, `src/main/agent`, and `src/main/ssh` boundaries, but the app is large and cross-cut by IPC/state/storage. |
| Windows Fit | 2 | Electron-builder Windows packaging exists, but local Windows dev/build is blocked by missing Node/npm and native modules such as `node-pty` and `better-sqlite3` still need installation validation. |
| Fork Risk | 1 | License is GPL-3.0 and the codebase includes broad desktop, Agent, MCP, Skills, K8s, DB, storage, and SSH functionality; direct fork has high license, merge, and safety-review risk. |

## mcp-ssh-manager Score Evidence

| Criterion | Score | Evidence |
|---|---:|---|
| Local Build | 1 | STATIC ONLY: clone and source inspection succeeded, but `package.json` requires Node `>=18.0.0` and npm scripts; local runtime/build was blocked because Node/npm are missing in this environment. |
| SSH/PTTY | 4 | STATIC YES for SSH command execution and persistent sessions: `src/tool-registry.js` includes `ssh_execute`, `ssh_session_start`, `ssh_session_send`, and `ssh_connection_status`. It is not a full terminal product UI/PTTY base. |
| Agent API | 4 | STATIC YES as an MCP agent-facing API: `src/index.js` conditionally registers 37 MCP tools, including command execution, sessions, monitoring, backups, database tools, tunnels, and groups. It lacks a broader desktop/web Agent UX. |
| Skills | 1 | STATIC NO for first-class Skill support: inspected tool registry/README/source evidence shows command aliases, profiles, hooks, and tool groups, but no `SKILL.md` workflow or skill execution model comparable to WinkTerm/Chaterm. |
| MCP | 5 | STATIC YES: package depends on `@modelcontextprotocol/sdk`; `src/index.js` uses `McpServer` and `registerToolConditional`; `src/tool-registry.js` organizes 37 MCP tools. |
| Extensibility | 4 | `src/tool-registry.js` groups tools, `src/tool-config-manager.js` supports activation/configuration, and modules split SSH, sessions, policy, audit, health, backups, databases, tunnels, profiles, hooks, and aliases. |
| Windows Fit | 3 | Static evidence includes Node cross-platform runtime and Windows host support via `.env.example` `PLATFORM=windows` plus README changelog entries for Windows OpenSSH fixes; local Windows runtime remains unverified because Node/npm are missing. |
| Fork Risk | 4 | MIT license, focused MCP component boundaries, and reusable tool schemas lower component reuse risk; risk remains because the default mode is unrestricted unless configured and the 37-tool surface is broader than the initial product scope. |

## mcp-ssh-orchestrator Score Evidence

| Criterion | Score | Evidence |
|---|---:|---|
| Local Build | 1 | STATIC ONLY: clone and source inspection succeeded, but `pyproject.toml` requires Python `>=3.11` and README quickstart is Docker-oriented; local runtime/build was blocked because Python/Docker are missing in this environment. |
| SSH/PTTY | 3 | STATIC PARTIAL: `src/mcp_ssh/mcp_server.py` provides `ssh_run`, `ssh_run_on_tag`, and async execution, but `docs/wiki/03-Design-Goals.md` explicitly says no file transfer and no interactive sessions, so it is command-only rather than PTY/product-terminal ready. |
| Agent API | 4 | STATIC YES as a focused MCP API: tools include `ssh_list_hosts`, `ssh_describe_host`, `ssh_plan`, `ssh_run`, tag execution, async run/status/output/result, cancellation, and config reload. |
| Skills | 2 | STATIC PARTIAL: it exposes MCP prompts for safe orchestration and policy-denial guidance, but no `SKILL.md` import/run model or troubleshooting skill registry. |
| MCP | 5 | STATIC YES: `pyproject.toml` depends on `mcp`; `src/mcp_ssh/mcp_server.py` uses `FastMCP`, `@mcp.tool`, `@mcp.resource`, and `@mcp.prompt`. |
| Extensibility | 4 | Small Python module layout (`config.py`, `policy.py`, `ssh_client.py`, `mcp_server.py`, utilities), declarative YAML policy, host/tag resources, and async task utilities make policy/command reuse straightforward. |
| Windows Fit | 2 | Runtime is Python/Docker with Linux-style container quickstart and Paramiko SSH; local Windows runtime is unverified due missing Python/Docker, and the component intentionally stays headless. |
| Fork Risk | 4 | Apache-2.0 license, focused codebase, deny-by-default design, and clear policy model make component reuse low-risk; limitation is that missing PTY/file-transfer/product UI require complementary implementation. |
