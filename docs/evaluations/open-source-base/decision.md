# Open Source Base Decision

Date: 2026-06-25

## Decision

Selected primary base: WinkTerm

WinkTerm is the selected primary base candidate for the first fork of the SSH + Agent secondary-development effort. This is a static-evidence decision with a required runtime validation gate: install Node.js/npm, Python, and Docker prerequisites, then rerun WinkTerm backend, frontend, and Docker checks before treating the fork as fully validated.

## Why This Base

- SSH/terminal reuse: WinkTerm has the strongest direct SSH/PTTY reuse evidence. The runbook records SSH connection CRUD in `backend/api/agent_routes.py`, persistent SSH profiles in `backend/ssh/connection_manager.py`, Paramiko shell adaptation in `backend/ssh/paramiko_channel.py`, Windows/Unix PTY handling in `backend/terminal/pty_manager.py`, SFTP operations in `backend/ssh/file_transfer.py`, and xterm.js frontend dependencies in `frontend/package.json`.
- Agent reuse: WinkTerm already exposes an agent-facing API rather than only an internal desktop flow. The runbook cites `backend/api/agent_routes.py` with `prefix="/api/agent"` plus terminal create/list/get/delete, exec, input, snapshot, stream, SSH run, async SSH jobs, recent events, and file-transfer routes.
- Skill reuse: WinkTerm has an existing Skill contract. Evidence includes `agent-skill/SKILL.md`, `agent-skill/HTTP_API.md`, `/api/agent/skill.md`, `/api/agent/http.md`, and `/api/agent/install.md`; the runbook also records skill methods for `terminal.exec`, `ssh.run`, `ssh.files.*`, upload, and download.
- MCP impact: WinkTerm is not MCP-native, so MCP should be added as an integration layer rather than assumed present. Supporting MCP notes identify mcp-ssh-manager as useful for MCP tool schema, SFTP upload/download/sync, health checks, and audit redaction, and mcp-ssh-orchestrator as useful for `ssh_plan`, deny-by-default policy, structured denials, host/tag resources, async task status/output/result, and JSON audit/progress logging.
- Windows development fit: WinkTerm has source-level Windows fit through `pywinpty` and PyInstaller/pywebview desktop packaging, and Docker maps documented frontend/backend ports. The environment check also records the current blocker clearly: this worktree has Git only; Node.js/npm, pnpm, Python, Docker/Docker Compose, Rust, and Go are missing or unusable on PATH, so runtime validation remains required.
- Fork/merge risk: WinkTerm has medium fork risk, which is acceptable for a primary base. The matrix cites an MIT license and modular `backend`, `frontend`, `cli`, `agent-skill`, and `desktop` layout, while noting that behavior spans FastAPI, WebSocket/PTTY sessions, Paramiko SSH, Next.js, npm CLI, Docker, and desktop packaging.
- License fit: WinkTerm is MIT licensed according to `LICENSE` and the README badge recorded in the runbook. Chaterm is GPL-3.0, while mcp-ssh-manager is MIT and mcp-ssh-orchestrator is Apache-2.0, making the MCP projects suitable as design inspirations or selectively reusable components, but not better primary bases.

## Alternatives Considered

### WinkTerm

- Strengths: MIT license; static evidence for SSH connection management, PTY terminal, SFTP/file transfer, Agent API, Skill support, OpenAI-compatible provider settings, CLI/HTTP/WS agent-facing contracts, and modular project boundaries.
- Weaknesses: local runtime was blocked because Python, Node.js/npm, and Docker are missing; no MCP server implementation was found; command execution surfaces need plan-first approval, policy, and persistent audit hardening before production use.
- Decision: select.

### Chaterm

- Strengths: strong static product evidence for SSH/PTTY, SFTP, Agent mode, Skills, MCP settings, provider adapters, Electron packaging, and terminal UX. The runbook cites `src/main/ssh/sshHandle.ts`, `src/main/ssh/sftpTransfer.ts`, `src/main/agent`, `SkillsManager.ts`, `McpHub.ts`, and `@modelcontextprotocol/sdk`.
- Weaknesses: direct fork risk is high because the license is GPL-3.0, the app is a broad Electron/Vue/TypeScript desktop product with many cross-cutting features, runtime/build was blocked by missing Node.js/npm, and native dependencies such as `node-pty` and `better-sqlite3` still need Windows validation.
- Decision: reference only.

### Supporting MCP SSH Projects

- mcp-ssh-manager: reuse tool schema and selected implementation ideas. Evidence supports MCP tool design for `ssh_execute`, `ssh_upload`, `ssh_download`, `ssh_sync`, `ssh_health_check`, persistent sessions, host configuration, and JSONL audit redaction, but it is a broad MCP utility rather than a primary SSH terminal product base.
- mcp-ssh-orchestrator: reuse policy design. Evidence supports `ssh_plan`, deny-by-default policy, command-chain parsing, structured denials, host/tag inventory, safe MCP resources, async task patterns, and audit/progress logs; it intentionally omits file transfer and interactive sessions, so it should complement WinkTerm rather than replace it.

## First Fork Scope

The first fork should include:

1. Preserve upstream SSH/PTTY terminal functionality.
2. Add or expose a local Agent diagnosis API.
3. Add `linux-basic-health` built-in skill.
4. Add plan-first command approval.
5. Add Markdown diagnosis report.
6. Add minimal CLI command: `ssh-ai diagnose <host> --profile linux-basic`.

The first fork should not include:

1. Full enterprise user management.
2. Skill marketplace.
3. Automatic production repair.
4. Desktop UI redesign.
5. Cloud sync.
6. Direct Chaterm source import.
7. Broad adoption of every mcp-ssh-manager tool.
8. Production repair actions without explicit approval and audit.

## Immediate Next Plan

Create the Milestone 1 implementation plan around a WinkTerm first fork with these gates:

1. Install and record Node.js/npm, Python 3.12+, and Docker Desktop prerequisites on the Windows development machine.
2. Clone or fork WinkTerm into the working repository and rerun Docker Compose, backend, and frontend startup checks.
3. Map the minimal fork changes against WinkTerm modules: Agent API exposure, built-in `linux-basic-health` skill, CLI command, report generation, and approval/audit policy.
4. Design an internal MCP-compatible tool surface using mcp-ssh-manager schema ideas and mcp-ssh-orchestrator policy/audit ideas.
5. Stop Milestone 1 if WinkTerm fails runtime validation in a way that invalidates the fork premise; otherwise proceed with the smallest working diagnosis loop.
