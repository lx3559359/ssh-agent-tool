# Chaterm Evaluation Runbook

Repository: https://github.com/chaterm/chaterm
Evaluation date: 2026-06-25

## Clone

```powershell
New-Item -ItemType Directory -Force -Path external | Out-Null
git clone https://github.com/chaterm/chaterm.git external/chaterm
```

Result:

- Status: PASS.
- Local clone path: `external/chaterm` (ignored by repository `.gitignore`).

## Repository Snapshot

| Item | Value |
|---|---|
| Default branch | `main` |
| Latest commit | `0d72b153` |
| Latest commit subject/date | `2026-06-25 10:57:12 +0800 Merge pull request #2357 from chaterm/dependabot/npm_and_yarn/openai-6.44.0` |
| License | GPL-3.0: `LICENSE` states "This project is licensed under the GNU General Public License v3.0." It also notes Cline-derived software under Apache-2.0 in `LICENSES/Cline/Apache-2.0.txt`. |
| Top-level files | `.claude`, `.github`, `.husky`, `.vscode`, `build`, `LICENSES`, `logs`, `resources`, `scripts`, `src`, `tests`, `__mocks__`, `.coderabbit.yml`, `.editorconfig`, `.gitignore`, `.gitleaks.toml`, `.npmrc`, `.prettierignore`, `.prettierrc.yaml`, `AGENTS.md`, `CLAUDE.md`, `codecov.yml`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `CONTRIBUTING_zh.md`, `electron-builder.cn.yml`, `electron-builder.global.yml`, `electron-builder.yml`, `electron.vite.config.ts`, `eslint.config.mjs`, `keyword-highlight.json`, `LICENSE`, `osv-scanner.toml`, `package-lock.json`, `package.json`, `playwright.config.ts`, `README.md`, `README_ja.md`, `README_zh.md`, `SECURITY.md`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.mts`. |
| Main languages | TypeScript/Vue/Electron project from `package.json`, `src/main`, `src/preload`, `src/renderer`, `electron.vite.config.ts`, and Vue renderer files. |
| Backend stack | Electron main process plus TypeScript services. `AGENTS.md` describes `src/main` as Electron main logic and `src/main/agent` as LLM provider/context/tool capabilities. |
| Frontend stack | Vue 3 + TypeScript + Pinia + Ant Design Vue + xterm.js from `CLAUDE.md` and `package.json` dependencies (`vue`, `pinia`, `ant-design-vue`, `@xterm/xterm`). |
| Desktop packaging | Electron/electron-builder: `package.json` scripts include `dev`, `build:win:cn`, `build:win:global`, `build:mac:*`, and `build:linux:*`; `electron-builder.yml`, `electron-builder.cn.yml`, and `electron-builder.global.yml` define Windows NSIS, macOS dmg/zip, and Linux AppImage/deb packaging. |

## Build Attempts

### README Path

Official setup path from `README.md`:

```powershell
Set-Location external/chaterm
npm i electron -D
node scripts/patch-package-lock.js
npm install
npm run dev
```

Official build path from `README.md`:

```powershell
npm run build:win
npm run build:mac
npm run build:linux
```

Package-manager evidence:

- `package.json` exists.
- `package-lock.json` exists.
- No `pnpm-lock.yaml` or `yarn.lock` was found by recursive search.
- README lists `npm run build:win`, `npm run build:mac`, and `npm run build:linux`; `package.json` instead exposes edition-specific package scripts such as `build:win:cn`, `build:win:global`, `build:mac:cn`, `build:mac:global`, `build:linux:cn`, and `build:linux:global`.

Feasible commands run:

```powershell
node --version
npm --version
pnpm --version
```

Result:

- README setup command: `node scripts/patch-package-lock.js && npm install`, after optional `npm i electron -D`.
- README/package build command: README says `npm run build:win`; package scripts indicate `npm run build:win:cn` or `npm run build:win:global` are the actual Windows package commands.
- Status: BLOCKED.
- Error output:

```text
node : The term 'node' is not recognized as the name of a cmdlet, function, script file, or operable program.
npm : The term 'npm' is not recognized as the name of a cmdlet, function, script file, or operable program.
pnpm : The term 'pnpm' is not recognized as the name of a cmdlet, function, script file, or operable program.
```

- Workaround: install a usable Node.js/npm toolchain, then rerun `node scripts/patch-package-lock.js`, `npm install`, and `npm run dev`. Do not claim runtime success until `npm run dev` launches the Electron app.

## Feature Checks

| Capability | Result | Evidence |
|---|---|---|
| SSH connection management | STATIC YES | `package.json` depends on `ssh2`; `src/main/ssh/sshHandle.ts` creates `Client` instances and registers IPC handlers including `ssh:connect`, `ssh:shell`, and `ssh:conn:exec`; `src/preload/index.ts` exposes those SSH IPC calls to the renderer. |
| PTY terminal | STATIC YES | `package.json` depends on `node-pty`, `@xterm/xterm`, and xterm addons; `src/main/ssh/localSSHHandle.ts` uses `pty.spawn`; `src/main/ssh/sshHandle.ts` opens SSH shell streams with PTY options. |
| SFTP/file transfer | STATIC YES | `src/main/ssh/sftpTransfer.ts` registers `ssh:sftp:list`, `ssh:sftp:upload-file`, `ssh:sftp:download-file`, directory transfer, chmod, rename, delete, and remote-to-remote transfer handlers; `src/preload/index.ts` exposes upload/download/list APIs. |
| Agent mode | STATIC YES | README describes an AI Agent that plans and performs troubleshooting; `AGENTS.md` identifies `src/main/agent` as in-project AI Agent capabilities; `src/renderer/src/views/layouts/TerminalLayout.vue` has `agents` mode layout; `src/main/agent/core/prompts/system.ts` defines `execute_command`, `ask_followup_question`, and `attempt_completion` tools. |
| Skills | STATIC YES | README lists reusable Agent Skills; `src/main/agent/services/skills/SkillsManager.ts` loads `SKILL.md`, builds skills prompts, imports/exports ZIP skills, and creates/updates user skills; `src/main/index.ts` registers `skills:*` IPC handlers; `src/preload/index.ts` exposes skill management APIs. |
| MCP settings | STATIC YES | `package.json` depends on `@modelcontextprotocol/sdk`; `src/main/agent/services/mcp/McpHub.ts` supports stdio, SSE, and streamable HTTP transports, server listing, tool calls, and tool auto-approval; `src/main/index.ts` stores `mcp_settings.json` and registers MCP IPC handlers; renderer settings include `src/renderer/src/views/components/LeftTab/setting/mcp.vue`. |
| OpenAI-compatible model provider | STATIC YES | `src/main/agent/api/providers` contains `anthropic.ts`, `bedrock.ts`, `deepseek.ts`, `litellm.ts`, `ollama.ts`, and `openai.ts`; `src/main/agent/shared/api.ts` defines providers `anthropic`, `bedrock`, `litellm`, `deepseek`, `default`, `openai`, and `ollama`, with OpenAI and LiteLLM model/base URL settings. |
| DeepSeek provider | STATIC YES | `src/main/agent/api/providers/deepseek.ts` exists; `src/main/agent/shared/api.ts` defines DeepSeek model IDs including `deepseek-chat` and `deepseek-reasoner`. |
| Qwen surface | STATIC YES/PARTIAL | README links to Chaterm Skills with Qwen Large Models; `src/main/services/knowledgebase/search/embedding-qwen.ts` implements a Qwen embedding provider; renderer state still has commented Qwen API key fields, so Qwen appears stronger for knowledge-base embedding than as a first-class chat provider. |
| Windows local run feasibility | BLOCKED | Electron-builder Windows packaging exists, but runtime/build could not be attempted because `node`, `npm`, and `pnpm` are missing. Native dependencies (`node-pty`, `better-sqlite3`) add extra Windows setup risk once Node is installed. |
| Fork complexity | HIGH | Large Electron/Vue/TypeScript app with main/preload/renderer IPC, local DB, SSH, SFTP, Agent, MCP, Skills, database workspace, K8s, provider adapters, and GPL-3.0 licensing. Good product reference, but direct fork carries high merge, license, and safety-review cost. |

## Search Coverage

Static inspection used repository search for:

```powershell
Get-ChildItem -Recurse -File | Select-String -Pattern "MCP|Skill|Agent|ssh|terminal|litellm|OpenAI|DeepSeek|Qwen" | Select-Object -First 120
rg -n "MCP|ModelContext|@modelcontextprotocol|mcp" src package.json README.md AGENTS.md CLAUDE.md
rg -n "Skill|skills|Agent Skill|agent skill" README.md AGENTS.md CLAUDE.md src resources package.json
rg -n "ssh|SSH|terminal|Terminal|node-pty|xterm|SFTP|sftp|zmodem" README.md src package.json
rg -n "Qwen|qwen" README.md src package.json AGENTS.md CLAUDE.md
```

## Notes

- What should be reused: product ideas and source patterns for SSH/SFTP IPC, xterm-backed terminal UX, Agent command approval UI, MCP server settings, Skills management, and provider abstraction.
- What should be referenced only: direct source reuse is risky unless GPL-3.0 is acceptable for the target fork; Chaterm is better as a product/architecture reference than an immediate base under the current licensing and missing-runtime constraints.
- Risks: runtime not verified; GPL-3.0 copyleft may be incompatible with intended downstream distribution; native Electron dependencies need Windows build validation; powerful Agent/SSH/MCP execution surfaces require a separate safety and audit pass before reuse.
