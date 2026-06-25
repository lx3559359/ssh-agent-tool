# Candidate Matrix

Scoring: 1 = poor, 3 = usable, 5 = strong. Scores are evidence-backed only for evaluated candidates.

| Candidate | License | Local Build | SSH/PTTY | Agent API | Skills | MCP | Extensibility | Windows Fit | Fork Risk | Total | Recommendation |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| WinkTerm | MIT | 2 | 5 | 5 | 5 | 2 | 4 | 2 | 3 | 28 | Primary candidate for Task 2 evidence: strong SSH/PTTY and Agent API base, but local runtime is blocked by missing Docker/Python/Node and MCP is not native. |
| Chaterm | GPL-3.0 | 1 | 5 | 4 | 5 | 5 | 4 | 2 | 1 | 27 | Product and architecture reference. Static evidence is strong for SSH/PTTY, Agent, Skills, and MCP, but runtime is blocked by missing Node/npm and direct fork risk is high because of GPL-3.0 and broad Electron app scope. |
| mcp-ssh-manager | Pending Task 4 evaluation | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Supporting component candidate. |
| mcp-ssh-orchestrator | Pending Task 4 evaluation | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Supporting component candidate. |

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
