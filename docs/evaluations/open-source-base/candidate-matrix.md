# Candidate Matrix

Scoring: 1 = poor, 3 = usable, 5 = strong. Scores are evidence-backed only for evaluated candidates.

| Candidate | License | Local Build | SSH/PTTY | Agent API | Skills | MCP | Extensibility | Windows Fit | Fork Risk | Total | Recommendation |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| WinkTerm | MIT | 2 | 5 | 5 | 5 | 2 | 4 | 2 | 3 | 28 | Primary candidate for Task 2 evidence: strong SSH/PTTY and Agent API base, but local runtime is blocked by missing Docker/Python/Node and MCP is not native. |
| Chaterm | Pending Task 3 evaluation | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Product reference unless later build and fork-risk evidence supports direct reuse. |
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
