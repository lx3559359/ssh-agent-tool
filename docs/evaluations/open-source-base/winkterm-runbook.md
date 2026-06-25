# WinkTerm Evaluation Runbook

Repository: https://github.com/Cznorth/winkterm
Evaluation date: 2026-06-25

## Clone

```powershell
New-Item -ItemType Directory -Force -Path external | Out-Null
git clone https://github.com/Cznorth/winkterm.git external/winkterm
```

Result: PASS. `external/winkterm` cloned successfully and `external/` is ignored by git.

## Repository Snapshot

| Item | Value |
|---|---|
| Default branch | `master` |
| Latest commit | `2471cd5` - `refactor(skill): split HTTP API reference, make CLI the default path` |
| Latest commit date | `2026-06-14 04:45:49 +0800` |
| License | MIT; `LICENSE` starts with `MIT License` and README has a `License-MIT` badge. |
| Main languages | Python and TypeScript by layout: `git ls-files` shows 55 `.py`, 20 `.ts`, 19 `.tsx`, 18 `.md`, 13 `.css`, and 10 `.json` files among the top extensions. |
| Backend stack | Python + FastAPI + Uvicorn + LangGraph/LangChain; evidence: `backend/main.py`, `backend/requirements.txt`, README Tech Stack. |
| Frontend stack | Next.js 14 + React 18 + TypeScript + xterm.js; evidence: `frontend/package.json`. |
| Desktop packaging | Docker Compose and PyInstaller/pywebview desktop packaging; evidence: `docker-compose.yml`, `Dockerfile`, `build/winkterm.spec`, `desktop/entrypoint.py`, README deployment notes. |

Top-level files/directories observed:

```text
.claude-plugin
.devcontainer
.github
agent-skill
assets
backend
build
cli
desktop
docs
frontend
plugins
scripts
test
website
.env.example
.gitattributes
.gitignore
CLAUDE.md
CONTRIBUTING.md
docker-compose.yml
Dockerfile
LICENSE
README.md
README.zh-CN.md
SECURITY.md
SHOWHN.md
TODO.md
```

## Build Attempts

### Docker Compose

Planned command:

```powershell
Set-Location external/winkterm
docker compose config
docker compose up -d
```

Result:

- Status: BLOCKED.
- Error output: Docker was not present, so `docker compose config` was not run. Tool evidence from `Get-Command docker -ErrorAction SilentlyContinue`: `docker command not found via Get-Command`.
- Workaround: install/start Docker Desktop, then rerun `docker compose config` and `docker compose up -d` from `external/winkterm`.

Relevant packaging evidence:

- `docker-compose.yml` defines one `winkterm` service, maps `3000:3000` and `8000:8000`, builds `Dockerfile`, passes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `MODEL_NAME`, mounts `./backend:/app/backend`, and persists `winkterm-data:/root/.winkterm`.
- `Dockerfile` builds the frontend from `node:20-alpine`, then runs the backend from `python:3.12-slim` with `python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000`.

### Backend

Planned command:

```powershell
Set-Location external/winkterm/backend
python --version
python -m uvicorn backend.main:app --reload --port 8000
```

Result:

- Status: BLOCKED.
- Backend start command: README documents `python -m uvicorn backend.main:app --reload --port 8000`.
- Error output: `Get-Command python` resolves to the Windows Store Python shim (`%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe`), but `python --version` exits with `LASTEXITCODE=9009`; Task 1 also recorded no usable Python runtime.
- Workaround: install Python 3.12+, then run `python -m venv .venv`, activate it, install `backend/requirements.txt`, and start Uvicorn.

Backend stack evidence:

- `backend/main.py` creates a FastAPI app, includes HTTP, WebSocket, SSH, Agent, auth, and session routers, exposes `/health`, and starts Uvicorn when run as `__main__`.
- `backend/requirements.txt` includes `fastapi`, `uvicorn[standard]`, `websockets`, `langgraph`, `langchain-openai`, `langchain-anthropic`, `paramiko`, `pywinpty` for Windows PTY, `ptyprocess` for non-Windows PTY, and `pywebview`.

### Frontend

Planned command:

```powershell
Set-Location external/winkterm/frontend
npm install
npm run dev
```

Result:

- Status: BLOCKED.
- URL: Not started.
- Error output: `Get-Command npm -ErrorAction SilentlyContinue` produced no command; Task 1 recorded `npm : The term 'npm' is not recognized as the name of a cmdlet, function, script file, or operable program.`
- Workaround: install Node.js 20+ and npm, then rerun `npm install` and `npm run dev` from `external/winkterm/frontend`.

Frontend stack evidence:

- `frontend/package.json` scripts include `dev: next dev`, `build: next build`, `start: next start`, and `lint: next lint`.
- `frontend/package.json` dependencies include `next`, `react`, `react-dom`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-serialize`, and `@xterm/addon-web-links`.

## Feature Checks

| Capability | Result | Evidence |
|---|---|---|
| SSH connection management | STATIC YES | README lists SSH remote connections; `backend/api/agent_routes.py` has `GET/POST/PUT/DELETE /api/agent/ssh/connections[/{conn_id}]`; `backend/ssh/connection_manager.py` persists profiles in `~/.winkterm/config.json` and masks secrets. |
| PTY terminal | STATIC YES | README describes a shared PTY session; `backend/terminal/pty_manager.py` uses `pywinpty` on Windows and `ptyprocess` on Unix; `frontend/package.json` uses xterm.js; `backend/ssh/paramiko_channel.py` adapts Paramiko shells to the PTY manager interface. |
| SFTP/file transfer | STATIC YES | `backend/api/agent_routes.py` exposes `/api/agent/ssh/{conn_id}/files`, `/upload`, `/download`, `/directories`, and `/paths`; `backend/ssh/file_transfer.py` uses Paramiko SFTP for list/read/write/upload/download/delete. |
| Agent API | STATIC YES | `backend/api/agent_routes.py` declares `prefix="/api/agent"` and routes for `/terminals`, `/terminals/{id}/exec`, `/terminals/{id}/input`, `/terminals/{id}/snapshot`, `/ssh/{conn_id}/run`, async jobs, and event streams. |
| Skill support | STATIC YES | `agent-skill/SKILL.md` exists with frontmatter `name: winkterm-remote`; `backend/api/agent_routes.py` serves `/api/agent/skill.md`, `/api/agent/http.md`, and `/api/agent/install.md`; README documents downloading a raw skill from `/api/agent/skill.md`. |
| OpenAI-compatible model provider | STATIC YES | README and `.env.example` document `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `MODEL_NAME`; `backend/agent/core/builder.py` imports `ChatOpenAI` and `ChatAnthropic`; `backend/config.py` labels the LLM settings as OpenAI-compatible. |
| Windows local run feasibility | BLOCKED | Source includes Windows PTY support through `pywinpty` and README requires Python 3.12+ and Node.js 20+, but this machine lacks usable Python, Node.js/npm, and Docker, so no backend/frontend/container runtime could be started. |
| Fork complexity | MEDIUM | The repository is modular (`backend`, `frontend`, `cli`, `agent-skill`, `desktop`), but product behavior spans FastAPI routes, WebSocket/PTY sessions, Paramiko SSH, Next.js UI, npm CLI, and PyInstaller desktop packaging. |

## API and Skill Surface Search

Commands used:

```powershell
Set-Location external/winkterm
rg -n --hidden -S "/api/agent|skill\.md|ssh_run|terminal_exec|OpenAI|ANTHROPIC_API_KEY|api/agent|Agent|Skill|MCP|ssh|terminal|LLM|model|provider|anthropic|openai"
rg -n -S "@(router|public_router)\.|def |async def |APIRouter|prefix=|/api/agent|skill\.md|http\.md|handshake|ssh/connections|terminals|run_async|upload|download|files|directories|paths" backend\api\agent_routes.py
rg -n -S "class |def |SFTP|sftp|upload|download|listdir|read|write|paramiko" backend\ssh backend\api\ssh_routes.py
```

High-signal findings:

- `backend/api/agent_routes.py:70` sets `prefix="/api/agent"`.
- `backend/api/agent_routes.py:92`, `:104`, `:116`, and `:146` serve skill, HTTP API reference, handshake, and install guide endpoints.
- `backend/api/agent_routes.py:316-368` covers SSH connection CRUD and Electerm import.
- `backend/api/agent_routes.py:381-515` covers terminal creation, list/get/delete, snapshot, input, exec, and stream.
- `backend/api/agent_routes.py:550-664` covers `ssh_run`, async SSH run jobs, job list/get/cancel.
- `backend/api/agent_routes.py:676-685` covers recent and streaming agent events.
- `backend/api/agent_routes.py:706-770` covers SSH file list/read/write/upload/download/mkdir/delete operations.
- `agent-skill/SKILL.md` maps WS methods including `terminal.exec`, `terminal.input`, `terminal.snapshot`, `ssh.connections.*`, `ssh.run`, `ssh.files.*`, `ssh.upload`, and `ssh.download`.
- `agent-skill/HTTP_API.md` documents HTTP fallback endpoints including `POST /api/agent/terminals/{id}/exec`, `POST /api/agent/ssh/{conn_id}/run`, and file-transfer endpoints.

## Notes

- What should be reused:
  - `backend/api/agent_routes.py` as the strongest candidate API surface for SSH connection CRUD, terminal exec/input/snapshot, one-shot SSH runs, async jobs, events, and SFTP operations.
  - `backend/terminal/pty_manager.py` and `backend/ssh/paramiko_channel.py` for shared local/SSH PTY behavior.
  - `backend/ssh/connection_manager.py`, `backend/ssh/file_transfer.py`, and `backend/ssh/command_exec.py` for SSH profile storage, file transfer, and isolated command execution.
  - `agent-skill/SKILL.md`, `agent-skill/HTTP_API.md`, and `cli/` as an existing agent-facing tool contract.
  - `frontend/src/components/SSHPanel`, `frontend/src/components/Terminal`, and xterm.js integration for SSH/terminal UX reference.
- What should be replaced or tightened:
  - Add an MCP-native server/tool layer if MCP is required; no MCP server protocol implementation was found in this inspection.
  - Add explicit command approval/policy/audit persistence for production diagnosis workflows; current agent event log is in-memory and the existing API appears optimized for direct remote operation.
  - Revisit secret storage for fork goals; current evidence shows config persisted under `~/.winkterm/config.json`, with secret masking in API responses but no encrypted-at-rest proof from this pass.
- Risks:
  - Local runtime is unverified on this machine because Python, Node.js/npm, and Docker are missing.
  - Agent API is powerful enough to run terminal and SSH commands; secondary development should add plan-first approval and policy controls before production use.
  - Fork maintenance spans Python backend, Next.js frontend, npm CLI, Docker, and PyInstaller desktop packaging.
  - README and skill files contain Chinese text that rendered with encoding mojibake in PowerShell output, so future doc extraction should use UTF-8-aware tooling.
