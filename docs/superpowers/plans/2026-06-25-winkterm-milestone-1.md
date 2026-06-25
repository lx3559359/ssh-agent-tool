# WinkTerm Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate WinkTerm as the runnable SSH + Agent base and build the smallest safe diagnosis loop around it.

**Architecture:** Milestone 1 is gate-driven. First install and verify the missing Windows prerequisites, then run WinkTerm unchanged, then create a minimal fork layer that adds a built-in `linux-basic-health` diagnosis flow, plan-first approval, Markdown reporting, and a CLI entry that calls the same Agent API. If WinkTerm fails runtime validation in a way that invalidates the fork premise, stop before product modifications.

**Tech Stack:** Windows PowerShell, Git, Node.js 20+, npm, Python 3.12+, Docker Desktop, WinkTerm Python/FastAPI backend, WinkTerm Next.js frontend, Paramiko SSH, xterm.js, Markdown documentation.

---

## File Structure

Milestone 1 creates or modifies these project-owned files:

- `docs/setup/windows-prerequisites.md`: commands and measured results for installing Node.js, Python, Docker Desktop, Git, and optional VS Build Tools.
- `docs/evaluations/winkterm-runtime-validation.md`: runtime validation report for WinkTerm backend, frontend, Docker Compose, and one local-safe Agent API smoke test.
- `docs/architecture/milestone-1-fork-map.md`: mapping from WinkTerm upstream modules to product modifications.
- `docs/skills/linux-basic-health.md`: built-in diagnosis skill contract and command inventory.
- `docs/security/command-policy-milestone-1.md`: plan-first command approval and denylist policy for the first diagnosis loop.
- `docs/cli/ssh-ai-diagnose.md`: CLI command contract for `ssh-ai diagnose <host> --profile linux-basic`.
- `docs/evaluations/milestone-1-readiness.md`: final go/no-go assessment for moving from validation into implementation.
- `apps/winkterm/`: product fork workspace created only after runtime validation passes.

Temporary or external files:

- `external/winkterm-runtime/`: ignored runtime validation clone.
- `.env.local` files: local-only secrets and model keys; never committed.

Milestone 1 intentionally does not import Chaterm source code.

---

## Task 1: Install and Verify Windows Prerequisites

**Files:**
- Create: `docs/setup/windows-prerequisites.md`
- Modify: `.gitignore`

- [ ] **Step 1: Expand local ignore rules for runtime validation**

Update `.gitignore` so it includes:

```gitignore
# Local upstream clones used during evaluation and runtime validation
/external/

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

Run:

```powershell
git check-ignore -q external
git check-ignore -q .env.local
git check-ignore -q node_modules
git check-ignore -q logs
```

Expected: each command exits with code `0`.

- [ ] **Step 2: Create prerequisite guide**

Create `docs/setup/windows-prerequisites.md`:

```markdown
# Windows Prerequisites

Date: 2026-06-25

## Required Versions

| Tool | Minimum | Purpose |
|---|---:|---|
| Git | 2.40 | clone and branch management |
| Node.js | 20 | WinkTerm frontend and npm CLI |
| npm | bundled with Node.js 20 | WinkTerm frontend dependencies |
| Python | 3.12 | WinkTerm FastAPI backend |
| Docker Desktop | current stable | WinkTerm Docker Compose validation |
| Docker Compose | v2 | Compose validation |
| Visual Studio Build Tools | current stable | native Node/Python packages if required |

## Install Commands

Prefer official installers when `winget` is unavailable. Run PowerShell as a normal user unless an installer asks for elevation.

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id Docker.DockerDesktop -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools"
```

Restart PowerShell after installation so PATH updates are visible.

## Verification Commands

```powershell
git --version
node --version
npm --version
python --version
docker --version
docker compose version
```

## Measured Results

The executor must paste the command output under this section during Task 1 execution.

## Blockers

If a tool cannot be installed, write the failing command, exit code, and whether the rest of Milestone 1 can proceed.
```

- [ ] **Step 3: Verify current tool state**

Run:

```powershell
git --version
node --version
npm --version
python --version
docker --version
docker compose version
```

Expected after installation:

- `git --version` prints a version.
- `node --version` prints `v20.x` or newer.
- `npm --version` prints a version.
- `python --version` prints `Python 3.12.x` or newer.
- `docker --version` prints a version.
- `docker compose version` prints v2 output.

If any required command is missing, update `docs/setup/windows-prerequisites.md` with the blocker and stop Milestone 1 before Task 2.

- [ ] **Step 4: Commit prerequisite documentation**

Run:

```powershell
git add .gitignore docs/setup/windows-prerequisites.md
git commit -m "docs: add Windows prerequisites for WinkTerm validation"
```

Expected: commit succeeds.

---

## Task 2: Runtime Validate WinkTerm Unchanged

**Files:**
- Create: `docs/evaluations/winkterm-runtime-validation.md`
- External only: `external/winkterm-runtime/`

- [ ] **Step 1: Clone WinkTerm runtime validation copy**

Run:

```powershell
New-Item -ItemType Directory -Force -Path external | Out-Null
git clone https://github.com/Cznorth/winkterm.git external/winkterm-runtime
Set-Location external/winkterm-runtime
git rev-parse --short HEAD
git log -1 --format="%ci %s"
```

Expected:

- Clone succeeds.
- Commit should match or intentionally supersede the evaluated commit `2471cd5`.

- [ ] **Step 2: Create runtime validation report**

Create `docs/evaluations/winkterm-runtime-validation.md`:

```markdown
# WinkTerm Runtime Validation

Date: 2026-06-25
Repository: https://github.com/Cznorth/winkterm

## Runtime Clone

- Path: `external/winkterm-runtime`
- Commit: write the output of `git rev-parse --short HEAD`
- Latest commit: write the output of `git log -1 --format="%ci %s"`

## Docker Compose Validation

- Command: `docker compose config`
- Result: write PASS or FAIL with the relevant command output.
- Command: `docker compose up -d`
- Result: write PASS or FAIL with exposed URLs and container status.

## Backend Validation

- Command: Python virtual environment creation and dependency install.
- Result: write PASS or FAIL with key command output.
- Command: `python -m uvicorn backend.main:app --reload --port 8000`
- Result: write PASS or FAIL with the backend URL.

## Frontend Validation

- Command: `npm install`
- Result: write PASS or FAIL with key command output.
- Command: `npm run dev`
- Result: write PASS or FAIL with the frontend URL.

## Agent API Smoke Test

- Command: health/API request used.
- Result: write PASS or FAIL with HTTP status and short response summary.

## Decision

Write one of:

- `PROCEED`: WinkTerm runtime validation supports creating the product fork.
- `STOP`: runtime validation failed in a way that invalidates WinkTerm as the first fork base.
- `RETRY AFTER FIX`: validation failed due local environment or dependency setup; fix prerequisites and rerun this task.
```

- [ ] **Step 3: Validate Docker Compose configuration**

Run:

```powershell
Set-Location external/winkterm-runtime
docker compose config
```

Expected:

- Command exits with code `0`.
- If it fails because Docker Desktop is not running, start Docker Desktop and rerun once.

- [ ] **Step 4: Start Docker Compose**

Run:

```powershell
Set-Location external/winkterm-runtime
docker compose up -d
docker compose ps
```

Expected:

- WinkTerm service is running.
- Document mapped ports from Compose output.

- [ ] **Step 5: Validate backend locally without Docker**

Run:

```powershell
Set-Location external/winkterm-runtime
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

Expected:

- Dependency install succeeds.
- Uvicorn starts on `http://127.0.0.1:8000`.
- Keep the backend running only long enough for smoke testing, then stop it with `Ctrl+C`.

- [ ] **Step 6: Validate frontend locally**

Open a second terminal and run:

```powershell
Set-Location external/winkterm-runtime\frontend
npm install
npm run dev
```

Expected:

- Next.js starts.
- Local frontend URL is printed, usually `http://localhost:3000`.
- Keep it running only long enough for smoke testing, then stop it with `Ctrl+C`.

- [ ] **Step 7: Smoke test Agent API**

With backend running, run:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/agent/skill.md
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/agent/http.md
```

Expected:

- `/health` returns HTTP `200`.
- `/api/agent/skill.md` returns Markdown text.
- `/api/agent/http.md` returns Markdown text.

- [ ] **Step 8: Record decision and commit**

If Docker, backend, frontend, and Agent API smoke checks pass, write `PROCEED` in the report.

If a failure is local environment-specific, write `RETRY AFTER FIX` and stop before Task 3.

If WinkTerm cannot run even after prerequisites and normal fixes, write `STOP` and stop before Task 3.

Run:

```powershell
git add docs/evaluations/winkterm-runtime-validation.md
git commit -m "docs: runtime validate WinkTerm base"
```

Expected: commit succeeds.

---

## Task 3: Create Fork Map and Import Strategy

**Files:**
- Create: `docs/architecture/milestone-1-fork-map.md`

- [ ] **Step 1: Create fork map document**

Create `docs/architecture/milestone-1-fork-map.md`:

```markdown
# Milestone 1 Fork Map

Date: 2026-06-25
Primary base: WinkTerm

## Upstream Modules To Preserve

| Upstream Path | Preserve Because | Product Touch Level |
|---|---|---|
| `backend/api/agent_routes.py` | Agent API for terminal, SSH, async jobs, skill docs, file transfer | wrap and extend |
| `backend/ssh/connection_manager.py` | SSH profile storage and connection metadata | preserve first |
| `backend/ssh/command_exec.py` | command execution over SSH | wrap with policy |
| `backend/ssh/file_transfer.py` | SFTP list/read/write/upload/download | preserve first |
| `backend/terminal/pty_manager.py` | local PTY and Windows `pywinpty` support | preserve first |
| `frontend/` | existing terminal UI and xterm.js integration | preserve first |
| `agent-skill/` | installable Agent skill contract | extend |
| `cli/` | existing CLI patterns | evaluate before replacing |

## Product Modules To Add

| Product Module | Purpose | First Files |
|---|---|---|
| `product/skills/linux-basic-health/` | built-in read-only diagnosis skill | `SKILL.md`, `checks.yaml` |
| `product/policy/` | plan-first command risk checks | `command_policy.py`, `risk_rules.yaml` |
| `product/reports/` | Markdown diagnosis report rendering | `markdown_report.py` |
| `product/cli/` | `ssh-ai diagnose` command | `ssh_ai.py` |
| `product/tests/fixtures/` | canned command outputs for tests | fixture files |

## Import Strategy

1. Keep WinkTerm upstream code under `apps/winkterm/`.
2. Preserve upstream license and attribution files.
3. Put product-specific additions under `apps/winkterm/product/`.
4. Avoid broad formatting changes in upstream files.
5. Wrap existing command execution paths instead of editing every caller.

## Stop Conditions

Stop before product import if runtime validation report does not say `PROCEED`.
```

- [ ] **Step 2: Verify the stop gate**

Run:

```powershell
Select-String -Path docs/evaluations/winkterm-runtime-validation.md -Pattern '^\\- `PROCEED`|^PROCEED|Decision'
```

Expected:

- The validation report clearly says `PROCEED`.
- If it says `STOP` or `RETRY AFTER FIX`, stop this plan and do not create `apps/winkterm/`.

- [ ] **Step 3: Commit fork map**

Run:

```powershell
git add docs/architecture/milestone-1-fork-map.md
git commit -m "docs: map WinkTerm fork boundaries"
```

Expected: commit succeeds.

---

## Task 4: Import WinkTerm Into Product Workspace

**Files:**
- Create: `apps/winkterm/`
- Modify: `docs/evaluations/milestone-1-readiness.md`

- [ ] **Step 1: Import upstream code**

Run:

```powershell
New-Item -ItemType Directory -Force -Path apps | Out-Null
git clone https://github.com/Cznorth/winkterm.git apps/winkterm
Remove-Item -Recurse -Force apps/winkterm/.git
```

Expected:

- `apps/winkterm/backend`, `apps/winkterm/frontend`, `apps/winkterm/agent-skill`, `apps/winkterm/cli`, `apps/winkterm/LICENSE`, and `apps/winkterm/README.md` exist.

- [ ] **Step 2: Preserve attribution**

Create `apps/winkterm/UPSTREAM.md`:

```markdown
# Upstream

This directory is based on WinkTerm.

- Repository: https://github.com/Cznorth/winkterm
- License: MIT
- Initial import date: 2026-06-25
- Initial import commit: write the commit from `git -C external/winkterm-runtime rev-parse --short HEAD`

Local product changes are added under `product/` first so upstream files remain easy to compare.
```

- [ ] **Step 3: Create readiness report skeleton**

Create `docs/evaluations/milestone-1-readiness.md`:

```markdown
# Milestone 1 Readiness

Date: 2026-06-25

## Gates

| Gate | Result | Evidence |
|---|---|---|
| Windows prerequisites installed | PASS | `docs/setup/windows-prerequisites.md` |
| WinkTerm runtime validated | PASS | `docs/evaluations/winkterm-runtime-validation.md` |
| Fork boundaries mapped | PASS | `docs/architecture/milestone-1-fork-map.md` |
| Upstream imported with attribution | PASS | `apps/winkterm/UPSTREAM.md` |

## Current State

WinkTerm has been imported as the product base. Product-specific changes should start under `apps/winkterm/product/`.
```

- [ ] **Step 4: Verify import**

Run:

```powershell
Test-Path apps/winkterm/LICENSE
Test-Path apps/winkterm/backend
Test-Path apps/winkterm/frontend
Test-Path apps/winkterm/agent-skill
Test-Path apps/winkterm/UPSTREAM.md
```

Expected: each command prints `True`.

- [ ] **Step 5: Commit import**

Run:

```powershell
git add apps/winkterm docs/evaluations/milestone-1-readiness.md
git commit -m "chore: import WinkTerm product base"
```

Expected: commit succeeds.

---

## Task 5: Specify Linux Basic Health Skill

**Files:**
- Create: `docs/skills/linux-basic-health.md`
- Create: `apps/winkterm/product/skills/linux-basic-health/SKILL.md`
- Create: `apps/winkterm/product/skills/linux-basic-health/checks.yaml`

- [ ] **Step 1: Create skill design document**

Create `docs/skills/linux-basic-health.md`:

```markdown
# Linux Basic Health Skill

Purpose: diagnose common Linux server health issues through read-only commands.

## Inputs

- Host ID or SSH connection ID.
- User question.
- Execution mode: readonly.

## Read-Only Checks

| Check | Command | Reason |
|---|---|---|
| uptime | `uptime` | load average and uptime |
| disk | `df -hT` | disk pressure and filesystem types |
| memory | `free -h` | memory and swap pressure |
| process summary | `ps aux --sort=-%cpu | head -n 15` | top CPU consumers |
| journal errors | `journalctl -p err -n 80 --no-pager` | recent system errors |
| failed services | `systemctl --failed --no-pager` | failed units |
| listening ports | `ss -tulpn` | service exposure |

## Output

The skill returns:

1. Summary.
2. Evidence table.
3. Likely causes.
4. Recommended next checks.
5. Repair suggestions that require approval before execution.
```

- [ ] **Step 2: Create product skill prompt**

Create `apps/winkterm/product/skills/linux-basic-health/SKILL.md`:

```markdown
---
name: linux-basic-health
description: Diagnose common Linux server health issues using read-only SSH commands.
risk: safe-readonly
version: 0.1.0
---

# Linux Basic Health

Use this skill when the user asks why a Linux server is slow, unhealthy, full, overloaded, failing services, or behaving abnormally.

Run only the checks listed in `checks.yaml`. Summarize command output with evidence. Do not run repair commands. If a repair appears useful, propose it as a plan that requires explicit user approval.
```

- [ ] **Step 3: Create structured check inventory**

Create `apps/winkterm/product/skills/linux-basic-health/checks.yaml`:

```yaml
version: 1
name: linux-basic-health
mode: readonly
checks:
  - id: uptime
    command: uptime
    reason: load average and uptime
    risk: safe
  - id: disk
    command: df -hT
    reason: disk pressure and filesystem types
    risk: safe
  - id: memory
    command: free -h
    reason: memory and swap pressure
    risk: safe
  - id: top_cpu
    command: ps aux --sort=-%cpu | head -n 15
    reason: top CPU consumers
    risk: safe
  - id: journal_errors
    command: journalctl -p err -n 80 --no-pager
    reason: recent system errors
    risk: safe
  - id: failed_services
    command: systemctl --failed --no-pager
    reason: failed systemd units
    risk: safe
  - id: listening_ports
    command: ss -tulpn
    reason: listening TCP and UDP services
    risk: safe
```

- [ ] **Step 4: Validate YAML**

Run from `apps/winkterm`:

```powershell
python - <<'PY'
from pathlib import Path
import yaml
path = Path("product/skills/linux-basic-health/checks.yaml")
data = yaml.safe_load(path.read_text(encoding="utf-8"))
assert data["name"] == "linux-basic-health"
assert data["mode"] == "readonly"
assert len(data["checks"]) == 7
assert all(item["risk"] == "safe" for item in data["checks"])
print("linux-basic-health checks.yaml valid")
PY
```

Expected: prints `linux-basic-health checks.yaml valid`.

- [ ] **Step 5: Commit skill spec**

Run:

```powershell
git add docs/skills/linux-basic-health.md apps/winkterm/product/skills/linux-basic-health
git commit -m "feat: add linux basic health skill definition"
```

Expected: commit succeeds.

---

## Task 6: Add First Command Policy Contract

**Files:**
- Create: `docs/security/command-policy-milestone-1.md`
- Create: `apps/winkterm/product/policy/risk_rules.yaml`

- [ ] **Step 1: Create security policy document**

Create `docs/security/command-policy-milestone-1.md`:

```markdown
# Command Policy for Milestone 1

Milestone 1 defaults to read-only diagnosis.

## Safe Commands

These commands may run after the user approves the diagnosis plan:

- `uptime`
- `df -hT`
- `free -h`
- `ps aux --sort=-%cpu | head -n 15`
- `journalctl -p err -n 80 --no-pager`
- `systemctl --failed --no-pager`
- `ss -tulpn`

## Blocked Commands

These command families are blocked in Milestone 1:

- deletion: `rm`, `shred`
- disk mutation: `mkfs`, `dd`
- service mutation: `systemctl restart`, `systemctl stop`, `systemctl disable`
- package mutation: `apt install`, `apt remove`, `yum install`, `dnf install`
- reboot/shutdown: `reboot`, `shutdown`, `poweroff`
- firewall mutation: `iptables`, `ufw`, `firewall-cmd`

## Approval Rule

The Agent must show the diagnosis plan before execution. The user must approve the plan before any SSH command runs. Repair commands are not executed in Milestone 1.
```

- [ ] **Step 2: Create machine-readable risk rules**

Create `apps/winkterm/product/policy/risk_rules.yaml`:

```yaml
version: 1
default_mode: readonly
safe_exact:
  - uptime
  - df -hT
  - free -h
  - ps aux --sort=-%cpu | head -n 15
  - journalctl -p err -n 80 --no-pager
  - systemctl --failed --no-pager
  - ss -tulpn
blocked_prefixes:
  - rm
  - shred
  - mkfs
  - dd
  - systemctl restart
  - systemctl stop
  - systemctl disable
  - apt install
  - apt remove
  - yum install
  - dnf install
  - reboot
  - shutdown
  - poweroff
  - iptables
  - ufw
  - firewall-cmd
```

- [ ] **Step 3: Validate policy YAML**

Run from `apps/winkterm`:

```powershell
python - <<'PY'
from pathlib import Path
import yaml
data = yaml.safe_load(Path("product/policy/risk_rules.yaml").read_text(encoding="utf-8"))
assert data["default_mode"] == "readonly"
assert "uptime" in data["safe_exact"]
assert "rm" in data["blocked_prefixes"]
print("risk_rules.yaml valid")
PY
```

Expected: prints `risk_rules.yaml valid`.

- [ ] **Step 4: Commit policy contract**

Run:

```powershell
git add docs/security/command-policy-milestone-1.md apps/winkterm/product/policy/risk_rules.yaml
git commit -m "feat: add milestone command policy contract"
```

Expected: commit succeeds.

---

## Task 7: Define CLI Diagnosis Contract

**Files:**
- Create: `docs/cli/ssh-ai-diagnose.md`

- [ ] **Step 1: Create CLI contract document**

Create `docs/cli/ssh-ai-diagnose.md`:

```markdown
# `ssh-ai diagnose`

Milestone 1 CLI command:

```powershell
ssh-ai diagnose <host> --profile linux-basic
```

## Behavior

1. Resolve `<host>` against WinkTerm SSH connection profiles.
2. Load `product/skills/linux-basic-health/checks.yaml`.
3. Render a diagnosis plan showing each read-only command and reason.
4. Ask the user to confirm the plan.
5. Execute approved checks through WinkTerm Agent API or SSH command execution wrapper.
6. Write a Markdown report to `reports/<session-id>.md`.
7. Print the report path and final summary.

## Output Modes

Human output is the default.

```powershell
ssh-ai diagnose prod-1 --profile linux-basic
```

JSON output is supported for automation:

```powershell
ssh-ai diagnose prod-1 --profile linux-basic --json
```

## Exit Codes

| Code | Meaning |
|---:|---|
| 0 | diagnosis completed |
| 1 | user rejected plan |
| 2 | host not found |
| 3 | policy blocked command |
| 4 | SSH execution failed |
| 5 | report generation failed |
```

- [ ] **Step 2: Commit CLI contract**

Run:

```powershell
git add docs/cli/ssh-ai-diagnose.md
git commit -m "docs: define ssh-ai diagnose contract"
```

Expected: commit succeeds.

---

## Task 8: Final Milestone 1 Readiness Review

**Files:**
- Modify: `docs/evaluations/milestone-1-readiness.md`

- [ ] **Step 1: Update readiness report**

Append this section to `docs/evaluations/milestone-1-readiness.md`:

```markdown
## Product Contracts Added

| Contract | Result | Evidence |
|---|---|---|
| Linux basic health skill | PASS | `docs/skills/linux-basic-health.md` and `apps/winkterm/product/skills/linux-basic-health/` |
| Command policy | PASS | `docs/security/command-policy-milestone-1.md` and `apps/winkterm/product/policy/risk_rules.yaml` |
| CLI diagnosis contract | PASS | `docs/cli/ssh-ai-diagnose.md` |

## Next Implementation Slice

The next implementation slice should add code inside `apps/winkterm/product/` to:

1. Load `checks.yaml`.
2. Evaluate `risk_rules.yaml`.
3. Render a diagnosis plan.
4. Execute approved checks through existing WinkTerm SSH APIs.
5. Generate a Markdown report.
6. Expose the flow through `ssh-ai diagnose`.
```

- [ ] **Step 2: Run final verification**

Run:

```powershell
git status --short
Test-Path docs/setup/windows-prerequisites.md
Test-Path docs/evaluations/winkterm-runtime-validation.md
Test-Path docs/architecture/milestone-1-fork-map.md
Test-Path docs/skills/linux-basic-health.md
Test-Path docs/security/command-policy-milestone-1.md
Test-Path docs/cli/ssh-ai-diagnose.md
Test-Path docs/evaluations/milestone-1-readiness.md
Test-Path apps/winkterm/UPSTREAM.md
```

Expected:

- `git status --short` shows only the readiness report modification before commit.
- Every `Test-Path` command prints `True`.

- [ ] **Step 3: Commit readiness report**

Run:

```powershell
git add docs/evaluations/milestone-1-readiness.md
git commit -m "docs: confirm milestone one readiness"
```

Expected: commit succeeds.

---

## Verification Checklist

After all tasks:

- [ ] `docs/evaluations/winkterm-runtime-validation.md` says `PROCEED`.
- [ ] `apps/winkterm/UPSTREAM.md` preserves upstream attribution.
- [ ] `apps/winkterm/product/skills/linux-basic-health/checks.yaml` validates with Python.
- [ ] `apps/winkterm/product/policy/risk_rules.yaml` validates with Python.
- [ ] `docs/evaluations/milestone-1-readiness.md` shows all gates as `PASS`.
- [ ] `git status --short` is clean.

