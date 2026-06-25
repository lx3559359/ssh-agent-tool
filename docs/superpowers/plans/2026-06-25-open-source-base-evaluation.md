# Open Source Base Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate WinkTerm, Chaterm, and supporting SSH/MCP projects, then select the best open-source base for SSH + Agent secondary development.

**Architecture:** This milestone does not modify upstream source code. It creates a repeatable evaluation workspace, runs each candidate locally where feasible, records build/runtime results, scores capabilities, and produces a decision document for the fork base.

**Tech Stack:** Git, PowerShell, Node.js, Python, Docker Desktop, Markdown documentation, local Windows workspace.

---

## File Structure

Create and maintain these files:

- `docs/evaluations/open-source-base/environment-check.md`: local toolchain versions and missing prerequisites.
- `docs/evaluations/open-source-base/candidate-matrix.md`: side-by-side scoring of candidate projects.
- `docs/evaluations/open-source-base/winkterm-runbook.md`: exact WinkTerm clone/build/run notes.
- `docs/evaluations/open-source-base/chaterm-runbook.md`: exact Chaterm clone/build/run notes.
- `docs/evaluations/open-source-base/mcp-ssh-notes.md`: notes on mcp-ssh-manager and mcp-ssh-orchestrator reuse.
- `docs/evaluations/open-source-base/decision.md`: final recommendation and next engineering step.
- `external/`: local clone directory for evaluated upstream repositories. Do not commit cloned upstream repositories.

Add `.gitignore` entries so cloned upstream projects and local secrets are not committed.

---

### Task 1: Prepare Evaluation Workspace

**Files:**
- Create: `.gitignore`
- Create: `docs/evaluations/open-source-base/environment-check.md`

- [ ] **Step 1: Add evaluation git ignores**

Create `.gitignore` with:

```gitignore
# Local upstream clones used during evaluation
external/

# Local environment and secrets
.env
.env.*
!.env.example
*.local

# Dependency/build outputs
node_modules/
.venv/
venv/
dist/
build/
out/
.next/
coverage/

# Logs
*.log
logs/
```

- [ ] **Step 2: Create the environment check template**

Create `docs/evaluations/open-source-base/environment-check.md` with:

```markdown
# Environment Check

Date: 2026-06-25
Machine: Windows workspace at `F:\SSH工具开发`

## Required Tools

| Tool | Command | Required For | Installed Version | Status | Notes |
|---|---|---|---|---|---|
| Git | `git --version` | cloning repositories | Record exact output | Record PASS or MISSING | Record install action if missing |
| Node.js | `node --version` | web/desktop builds | Record exact output | Record PASS or MISSING | Record install action if missing |
| npm | `npm --version` | Node dependencies | Record exact output | Record PASS or MISSING | Record install action if missing |
| pnpm | `pnpm --version` | Chaterm/WinkTerm if required | Record exact output | Record PASS or MISSING | Record install action if missing |
| Python | `python --version` | WinkTerm backend if Python-based | Record exact output | Record PASS or MISSING | Record install action if missing |
| Docker | `docker --version` | Docker-based quickstart | Record exact output | Record PASS or MISSING | Record Docker Desktop state |
| Docker Compose | `docker compose version` | Docker-based quickstart | Record exact output | Record PASS or MISSING | Record Docker Desktop state |
| Rust | `rustc --version` | Tauri/Rust candidates | Record exact output | Record PASS or MISSING | Record install action if missing |
| Go | `go version` | Go MCP candidates | Record exact output | Record PASS or MISSING | Record install action if missing |

## Summary

- Missing blockers: replace this line with concrete missing tools, or write `None`.
- Workarounds: replace this line with concrete workaround commands, or write `None`.
- Candidate projects that can be evaluated on this machine: list candidate names after the tool checks.
```

- [ ] **Step 3: Run environment commands**

Run:

```powershell
git --version
node --version
npm --version
pnpm --version
python --version
docker --version
docker compose version
rustc --version
go version
```

Expected:

- Installed tools print versions.
- Missing tools print command-not-found errors.
- Record both successes and failures in `environment-check.md`.

- [ ] **Step 4: Commit workspace preparation**

Run:

```powershell
git add .gitignore docs/evaluations/open-source-base/environment-check.md
git commit -m "chore: prepare open-source base evaluation workspace"
```

Expected: commit succeeds.

---

### Task 2: Evaluate WinkTerm Build and Runtime

**Files:**
- Create: `docs/evaluations/open-source-base/winkterm-runbook.md`
- Modify: `docs/evaluations/open-source-base/candidate-matrix.md`

- [ ] **Step 1: Create WinkTerm runbook**

Create `docs/evaluations/open-source-base/winkterm-runbook.md` with:

```markdown
# WinkTerm Evaluation Runbook

Repository: https://github.com/Cznorth/winkterm
Evaluation date: 2026-06-25

## Clone

```powershell
New-Item -ItemType Directory -Force -Path external | Out-Null
git clone https://github.com/Cznorth/winkterm.git external/winkterm
```

## Repository Snapshot

| Item | Value |
|---|---|
| Default branch | Record `git branch --show-current` |
| Latest commit | Record `git rev-parse --short HEAD` and latest commit subject |
| License | Record license file or README badge |
| Main languages | Record from repository file layout or GitHub metadata |
| Backend stack | Record detected backend framework/runtime |
| Frontend stack | Record detected frontend framework/runtime |
| Desktop packaging | Record Docker, PyInstaller, Tauri, Electron, or none |

## Build Attempts

### Docker Compose

Command:

```powershell
Set-Location external/winkterm
docker compose config
docker compose up -d
```

Result:

- Status: replace with PASS, PARTIAL, or FAIL.
- Error output: paste the exact blocking error, or write `None`.
- Workaround: write the exact workaround command, or write `None`.

### Backend

Command:

```powershell
Set-Location external/winkterm/backend
python --version
```

Result:

- Status: replace with PASS, PARTIAL, or FAIL.
- Backend start command: write the exact command found in README or source.
- Error output: paste the exact blocking error, or write `None`.

### Frontend

Command:

```powershell
Set-Location external/winkterm/frontend
npm install
npm run dev
```

Result:

- Status: replace with PASS, PARTIAL, or FAIL.
- URL: write the local URL if the frontend starts, or write `Not started`.
- Error output: paste the exact blocking error, or write `None`.

## Feature Checks

| Capability | Result | Evidence |
|---|---|---|
| SSH connection management | Record YES, PARTIAL, or NO | Record README line, source path, or runtime observation |
| PTY terminal | Record YES, PARTIAL, or NO | Record README line, source path, or runtime observation |
| SFTP/file transfer | Record YES, PARTIAL, or NO | Record README line, source path, or runtime observation |
| Agent API | Record YES, PARTIAL, or NO | Record README line, source path, or runtime observation |
| Skill support | Record YES, PARTIAL, or NO | Record README line, source path, or runtime observation |
| OpenAI-compatible model provider | Record YES, PARTIAL, or NO | Record env var, config key, or provider source path |
| Windows local run feasibility | Record GOOD, RISKY, or BLOCKED | Record build/runtime evidence |
| Fork complexity | Record LOW, MEDIUM, or HIGH | Record coupling and package layout evidence |

## Notes

- What should be reused: list concrete modules or APIs after inspection.
- What should be replaced: list concrete modules or APIs after inspection.
- Risks: list concrete technical, license, or maintenance risks after inspection.
```

- [ ] **Step 2: Clone WinkTerm**

Run:

```powershell
New-Item -ItemType Directory -Force -Path external | Out-Null
git clone https://github.com/Cznorth/winkterm.git external/winkterm
```

Expected:

- `external/winkterm` exists.
- The clone is not tracked by git because `external/` is ignored.

- [ ] **Step 3: Record repository snapshot**

Run:

```powershell
Set-Location external/winkterm
git branch --show-current
git rev-parse --short HEAD
git log -1 --format="%ci %s"
Get-ChildItem -Force | Select-Object Name
```

Expected:

- Branch, commit, and top-level files are visible.
- Record values in the runbook.

- [ ] **Step 4: Check Docker configuration**

Run:

```powershell
Set-Location external/winkterm
docker compose config
```

Expected:

- PASS if compose file renders successfully.
- FAIL if Docker is missing or compose config errors.
- Record the result and error output in the runbook.

- [ ] **Step 5: Attempt local runtime**

Run the least invasive runtime path that the README recommends first:

```powershell
Set-Location external/winkterm
docker compose up -d
```

Expected:

- PASS if services start and expose the documented URL.
- If model API keys are required, record that the app starts but Agent calls require configuration.
- FAIL is acceptable for this evaluation if the cause is documented.

- [ ] **Step 6: Inspect API and skill surfaces**

Run:

```powershell
Set-Location external/winkterm
Get-ChildItem -Recurse -File | Select-String -Pattern "/api/agent|skill.md|ssh_run|terminal_exec|OpenAI|ANTHROPIC_API_KEY" | Select-Object -First 80
```

Expected:

- Find source files or docs that expose Agent API, skills, SSH execution, and provider configuration.
- Record promising file paths and notes in the runbook.

- [ ] **Step 7: Create or update candidate matrix with WinkTerm row**

Create `docs/evaluations/open-source-base/candidate-matrix.md` if it does not exist:

```markdown
# Candidate Matrix

Scoring: 1 = poor, 3 = usable, 5 = strong.

| Candidate | License | Local Build | SSH/PTTY | Agent API | Skills | MCP | Extensibility | Windows Fit | Fork Risk | Total | Recommendation |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| WinkTerm | MIT | Score after WinkTerm runbook | Score after WinkTerm runbook | Score after WinkTerm runbook | Score after WinkTerm runbook | Score after WinkTerm runbook | Score after WinkTerm runbook | Score after WinkTerm runbook | Score after WinkTerm runbook | Sum after scoring | Primary candidate unless evidence disproves |
| Chaterm | Verify in Chaterm runbook | Score after Chaterm runbook | Score after Chaterm runbook | Score after Chaterm runbook | Score after Chaterm runbook | Score after Chaterm runbook | Score after Chaterm runbook | Score after Chaterm runbook | Score after Chaterm runbook | Sum after scoring | Product reference unless build and fork risk are strong |
| mcp-ssh-manager | MIT | Score after MCP notes | Score after MCP notes | Score after MCP notes | Score after MCP notes | Score after MCP notes | Score after MCP notes | Score after MCP notes | Score after MCP notes | Sum after scoring | Supporting component |
| mcp-ssh-orchestrator | Verify in MCP notes | Score after MCP notes | Score after MCP notes | Score after MCP notes | Score after MCP notes | Score after MCP notes | Score after MCP notes | Score after MCP notes | Score after MCP notes | Sum after scoring | Supporting component |
```

Fill the WinkTerm row based on runbook evidence.

- [ ] **Step 8: Commit WinkTerm evaluation**

Run:

```powershell
git add docs/evaluations/open-source-base/winkterm-runbook.md docs/evaluations/open-source-base/candidate-matrix.md
git commit -m "docs: evaluate WinkTerm as SSH agent base"
```

Expected: commit succeeds.

---

### Task 3: Evaluate Chaterm Build and Runtime

**Files:**
- Create: `docs/evaluations/open-source-base/chaterm-runbook.md`
- Modify: `docs/evaluations/open-source-base/candidate-matrix.md`

- [ ] **Step 1: Create Chaterm runbook**

Create `docs/evaluations/open-source-base/chaterm-runbook.md` with:

```markdown
# Chaterm Evaluation Runbook

Repository: https://github.com/chaterm/chaterm
Evaluation date: 2026-06-25

## Clone

```powershell
New-Item -ItemType Directory -Force -Path external | Out-Null
git clone https://github.com/chaterm/chaterm.git external/chaterm
```

## Repository Snapshot

| Item | Value |
|---|---|
| Default branch | Record `git branch --show-current` |
| Latest commit | Record `git rev-parse --short HEAD` and latest commit subject |
| License | Record license file or README badge |
| Main languages | Record from repository file layout or GitHub metadata |
| Backend stack | Record detected backend framework/runtime |
| Frontend stack | Record detected frontend framework/runtime |
| Desktop packaging | Record Tauri, Electron, mobile packaging, or none |

## Build Attempts

### README Path

Command:

```powershell
Set-Location external/chaterm
```

Result:

- README setup command: record the exact command before running it.
- Status: replace with PASS, PARTIAL, or FAIL.
- Error output: paste the exact blocking error, or write `None`.
- Workaround: write the exact workaround command, or write `None`.

## Feature Checks

| Capability | Result | Evidence |
|---|---|---|
| SSH connection management | Record YES, PARTIAL, or NO | Record README line, source path, or runtime observation |
| PTY terminal | Record YES, PARTIAL, or NO | Record README line, source path, or runtime observation |
| SFTP/file transfer | Record YES, PARTIAL, or NO | Record README line, source path, or runtime observation |
| Agent mode | Record YES, PARTIAL, or NO | Record README line, source path, or runtime observation |
| Skills | Record YES, PARTIAL, or NO | Record docs path, source path, or runtime observation |
| MCP settings | Record YES, PARTIAL, or NO | Record docs path, source path, or runtime observation |
| OpenAI-compatible model provider | Record YES, PARTIAL, or NO | Record env var, config key, or provider source path |
| Windows local run feasibility | Record GOOD, RISKY, or BLOCKED | Record build/runtime evidence |
| Fork complexity | Record LOW, MEDIUM, or HIGH | Record coupling and package layout evidence |

## Notes

- What should be reused: list concrete modules or APIs after inspection.
- What should be referenced only: list concrete product ideas or flows after inspection.
- Risks: list concrete technical, license, or maintenance risks after inspection.
```

- [ ] **Step 2: Clone Chaterm**

Run:

```powershell
New-Item -ItemType Directory -Force -Path external | Out-Null
git clone https://github.com/chaterm/chaterm.git external/chaterm
```

Expected:

- `external/chaterm` exists.
- The clone is not tracked by git because `external/` is ignored.

- [ ] **Step 3: Record repository snapshot**

Run:

```powershell
Set-Location external/chaterm
git branch --show-current
git rev-parse --short HEAD
git log -1 --format="%ci %s"
Get-ChildItem -Force | Select-Object Name
```

Expected:

- Branch, commit, and top-level files are visible.
- Record values in the runbook.

- [ ] **Step 4: Identify official build path**

Run:

```powershell
Set-Location external/chaterm
Get-Content README.md -TotalCount 220
Get-ChildItem -Recurse -File -Filter package.json | Select-Object FullName
Get-ChildItem -Recurse -File -Filter pnpm-lock.yaml | Select-Object FullName
Get-ChildItem -Recurse -File -Filter yarn.lock | Select-Object FullName
```

Expected:

- README setup section and package manager are identified.
- Record exact setup commands in the runbook before running them.

- [ ] **Step 5: Attempt official local build or dev startup**

Run the commands documented by Chaterm README. If README specifies Electron install then package installation, record the exact commands before execution.

Expected:

- PASS if dev app starts.
- PARTIAL if dependencies install but runtime needs external account/API.
- FAIL if setup fails, with exact error recorded.

- [ ] **Step 6: Inspect Agent, Skills, and MCP surfaces**

Run:

```powershell
Set-Location external/chaterm
Get-ChildItem -Recurse -File | Select-String -Pattern "MCP|Skill|Agent|ssh|terminal|litellm|OpenAI|DeepSeek|Qwen" | Select-Object -First 120
```

Expected:

- Find feature-related files or docs.
- Record file paths and product implications in the runbook.

- [ ] **Step 7: Update candidate matrix with Chaterm row**

Update `docs/evaluations/open-source-base/candidate-matrix.md`.

Expected:

- Chaterm row includes score and fork-risk notes.

- [ ] **Step 8: Commit Chaterm evaluation**

Run:

```powershell
git add docs/evaluations/open-source-base/chaterm-runbook.md docs/evaluations/open-source-base/candidate-matrix.md
git commit -m "docs: evaluate Chaterm as SSH agent base"
```

Expected: commit succeeds.

---

### Task 4: Evaluate Supporting MCP SSH Components

**Files:**
- Create: `docs/evaluations/open-source-base/mcp-ssh-notes.md`
- Modify: `docs/evaluations/open-source-base/candidate-matrix.md`

- [ ] **Step 1: Create MCP notes file**

Create `docs/evaluations/open-source-base/mcp-ssh-notes.md` with:

```markdown
# MCP SSH Component Notes

Evaluation date: 2026-06-25

## mcp-ssh-manager

Repository: https://github.com/bvisible/mcp-ssh-manager

| Area | Notes |
|---|---|
| License | Record license file or README badge |
| Runtime | Record Node, Python, Go, or other runtime |
| Tool list | Record the main MCP tool names |
| SSH host model | Record how hosts are configured |
| File transfer | Record YES, PARTIAL, or NO with evidence |
| Health checks | Record YES, PARTIAL, or NO with evidence |
| Safety controls | Record allowlist, confirmation, audit, or gaps |
| Reuse recommendation | Record dependency, code reference, or no reuse |

## mcp-ssh-orchestrator

Repository: https://github.com/samerfarida/mcp-ssh-orchestrator

| Area | Notes |
|---|---|
| License | Record license file or README badge |
| Runtime | Record Node, Python, Go, or other runtime |
| Tool list | Record the main MCP tool names |
| Policy model | Record allowlist/denylist/tag model with evidence |
| Dry-run support | Record YES, PARTIAL, or NO with evidence |
| Audit support | Record YES, PARTIAL, or NO with evidence |
| Structured denials | Record YES, PARTIAL, or NO with evidence |
| Reuse recommendation | Record dependency, code reference, or no reuse |

## Recommended Internal MCP Tool Surface

| Tool | Purpose | Source Inspiration |
|---|---|---|
| `ssh_list_hosts` | list configured hosts | Record candidate project/tool name after inspection |
| `ssh_describe_host` | describe connection and tags | Record candidate project/tool name after inspection |
| `ssh_plan` | dry-run command against policy | Record candidate project/tool name after inspection |
| `ssh_exec` | execute approved command | Record candidate project/tool name after inspection |
| `ssh_upload` | upload file | Record candidate project/tool name after inspection |
| `ssh_download` | download file | Record candidate project/tool name after inspection |
| `ssh_run_skill` | run a troubleshooting skill | Record candidate project/tool name after inspection |
| `ssh_get_audit_session` | read session audit trail | Record candidate project/tool name after inspection |
```

- [ ] **Step 2: Clone mcp-ssh-manager**

Run:

```powershell
New-Item -ItemType Directory -Force -Path external | Out-Null
git clone https://github.com/bvisible/mcp-ssh-manager.git external/mcp-ssh-manager
```

Expected:

- Repository clones successfully.

- [ ] **Step 3: Inspect mcp-ssh-manager**

Run:

```powershell
Set-Location external/mcp-ssh-manager
git rev-parse --short HEAD
Get-Content README.md -TotalCount 260
Get-ChildItem -Recurse -File | Select-String -Pattern "ssh_|tool|upload|download|health|backup|policy|audit" | Select-Object -First 120
```

Expected:

- Tool surface and implementation style are visible.
- Record reuse notes.

- [ ] **Step 4: Clone mcp-ssh-orchestrator**

Run:

```powershell
New-Item -ItemType Directory -Force -Path external | Out-Null
git clone https://github.com/samerfarida/mcp-ssh-orchestrator.git external/mcp-ssh-orchestrator
```

Expected:

- Repository clones successfully.

- [ ] **Step 5: Inspect mcp-ssh-orchestrator**

Run:

```powershell
Set-Location external/mcp-ssh-orchestrator
git rev-parse --short HEAD
Get-Content README.md -TotalCount 260
Get-Content CHANGELOG.md -TotalCount 220
Get-ChildItem -Recurse -File | Select-String -Pattern "policy|deny|allow|dry|audit|timeout|ssh_plan|ssh_run" | Select-Object -First 120
```

Expected:

- Policy and safety model are visible.
- Record reuse notes.

- [ ] **Step 6: Update candidate matrix with supporting rows**

Update `docs/evaluations/open-source-base/candidate-matrix.md`.

Expected:

- Supporting projects are marked as components, not primary product bases.

- [ ] **Step 7: Commit MCP SSH evaluation**

Run:

```powershell
git add docs/evaluations/open-source-base/mcp-ssh-notes.md docs/evaluations/open-source-base/candidate-matrix.md
git commit -m "docs: evaluate supporting MCP SSH components"
```

Expected: commit succeeds.

---

### Task 5: Produce Final Base Decision

**Files:**
- Create: `docs/evaluations/open-source-base/decision.md`
- Modify: `docs/evaluations/open-source-base/candidate-matrix.md`

- [ ] **Step 1: Create decision document**

Create `docs/evaluations/open-source-base/decision.md` with:

```markdown
# Open Source Base Decision

Date: 2026-06-25

## Decision

Selected primary base: write exactly one of `WinkTerm`, `Chaterm`, or `No direct fork; build wrapper around MCP SSH components`.

## Why This Base

- SSH/terminal reuse: cite concrete evidence from runbooks.
- Agent reuse: cite concrete evidence from runbooks.
- Skill reuse: cite concrete evidence from runbooks.
- MCP impact: cite concrete evidence from MCP notes.
- Windows development fit: cite concrete environment/build evidence.
- Fork/merge risk: cite concrete repository structure evidence.
- License fit: cite concrete license evidence.

## Alternatives Considered

### WinkTerm

- Strengths: list evidence-backed strengths.
- Weaknesses: list evidence-backed weaknesses.
- Decision: write `select`, `reject`, or `reference only`.

### Chaterm

- Strengths: list evidence-backed strengths.
- Weaknesses: list evidence-backed weaknesses.
- Decision: write `select`, `reject`, or `reference only`.

### Supporting MCP SSH Projects

- mcp-ssh-manager: write `reuse as dependency`, `reuse tool schema`, or `reject`, with reason.
- mcp-ssh-orchestrator: write `reuse as dependency`, `reuse policy design`, or `reject`, with reason.

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

## Immediate Next Plan

Create an implementation plan for Milestone 1 after the selected base is cloned/forked into the working repository.
```

- [ ] **Step 2: Fill decision from evidence**

Use these inputs:

- `docs/evaluations/open-source-base/environment-check.md`
- `docs/evaluations/open-source-base/winkterm-runbook.md`
- `docs/evaluations/open-source-base/chaterm-runbook.md`
- `docs/evaluations/open-source-base/mcp-ssh-notes.md`
- `docs/evaluations/open-source-base/candidate-matrix.md`

Expected:

- Decision names one primary base.
- It also names which supporting components to reuse by concept or dependency.
- It identifies the next implementation plan.

- [ ] **Step 3: Self-review decision**

Run:

```powershell
$patterns = @("T" + "BD", "TO" + "DO", "Unknown until" + " verified", "Score after", "Record exact", "Record YES", "Record license", "write exactly one", "cite concrete", "list evidence-backed")
Select-String -Path docs/evaluations/open-source-base/*.md -Pattern $patterns
```

Expected:

- Any remaining empty placeholders are either filled or explicitly explained as not evaluated due to a concrete blocker.
- Candidate matrix has no blank score cells for evaluated candidates.

- [ ] **Step 4: Commit final decision**

Run:

```powershell
git add docs/evaluations/open-source-base/decision.md docs/evaluations/open-source-base/candidate-matrix.md
git commit -m "docs: choose SSH agent open-source base"
```

Expected: commit succeeds.

---

## Verification Checklist

After all tasks:

- [ ] `git status --short` is clean.
- [ ] `docs/evaluations/open-source-base/decision.md` names one selected primary base.
- [ ] `candidate-matrix.md` includes WinkTerm, Chaterm, mcp-ssh-manager, and mcp-ssh-orchestrator.
- [ ] At least one candidate has been run or has a documented blocker.
- [ ] The next Milestone 1 scope is explicit and small.
