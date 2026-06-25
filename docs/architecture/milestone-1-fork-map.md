# Milestone 1 Fork Map

Date: 2026-06-25
Primary base: WinkTerm
Target path: Windows desktop `.exe`

## Gate Basis

The Windows desktop fork path can proceed from WinkTerm because local backend, frontend, and Agent API validation passed. Docker Compose remains deferred as a packaging/deployment gate until firmware virtualization is enabled and Docker Desktop's Linux engine becomes healthy.

## Upstream Modules To Preserve

| Upstream Path | Preserve Because | Product Touch Level |
|---|---|---|
| `backend/api/agent_routes.py` | Agent API for terminal, SSH, async jobs, skill docs, and file transfer | wrap and extend |
| `backend/ssh/connection_manager.py` | SSH profile storage and connection metadata | preserve first |
| `backend/ssh/command_exec.py` | command execution over SSH | wrap with policy |
| `backend/ssh/file_transfer.py` | SFTP list/read/download/upload behavior | preserve first |
| `backend/terminal/pty_manager.py` | local PTY and Windows `pywinpty` support | preserve first |
| `frontend/` | existing terminal UI and xterm.js integration | preserve first |
| `agent-skill/` | installable Agent skill contract and reference docs | extend |
| `cli/` | existing CLI patterns for Agent API access | evaluate before replacing |

## Product Modules To Add

| Product Module | Purpose | First Files |
|---|---|---|
| `apps/winkterm/product/skills/linux-basic-health/` | built-in read-only Linux diagnosis skill | `SKILL.md`, `checks.yaml` |
| `apps/winkterm/product/policy/` | plan-first command risk checks for SSH execution | `command_policy.py`, `risk_rules.yaml` |
| `apps/winkterm/product/reports/` | Markdown diagnosis report rendering | `markdown_report.py` |
| `apps/winkterm/product/cli/` | `ssh-ai diagnose` command entry | `ssh_ai.py` |
| `apps/winkterm/product/tests/fixtures/` | canned command outputs for diagnosis and policy tests | fixture files |

## Import Strategy

1. Keep WinkTerm upstream code under `apps/winkterm/`.
2. Preserve upstream license and attribution files.
3. Put product-specific additions under `apps/winkterm/product/`.
4. Avoid broad formatting changes in upstream files.
5. Wrap existing SSH command execution paths instead of editing every caller.
6. Keep Docker Compose changes out of the Windows desktop fork until the packaging/deployment gate is reopened.

## Windows Desktop Boundaries

The first product fork should rely on WinkTerm's local FastAPI backend, Next.js frontend, Agent API routes, SSH connection handling, SSH command execution, SFTP support, and Windows PTY behavior. Milestone 1 product work should add a diagnosis layer around those capabilities instead of changing the underlying terminal or connection model.

The fork should not import Chaterm source code, replace the terminal UI, or require Docker for local Windows `.exe` development. Docker Compose remains useful for later packaging validation, but it is not part of the first desktop runtime boundary.

## Stop Conditions

Stop before product import if `docs/evaluations/winkterm-runtime-validation.md` does not contain `Windows Desktop Fork Gate` followed by `PROCEED`, or if a later validation shows backend, frontend, or Agent API failure on the Windows desktop path.
