# Milestone 1 Readiness

Date: 2026-06-25

## Gates

| Gate | Result | Evidence |
|---|---|---|
| Windows prerequisites installed | PASS | `docs/setup/windows-prerequisites.md` |
| WinkTerm runtime validated | PASS | `docs/evaluations/winkterm-runtime-validation.md`; Windows desktop runtime gate PASS; Docker Compose deferred for firmware virtualization |
| Fork boundaries mapped | PASS | `docs/architecture/milestone-1-fork-map.md` |
| Upstream imported with attribution | PASS | `apps/winkterm/UPSTREAM.md` |

## Current State

WinkTerm has been imported as the product base. Product-specific changes should start under `apps/winkterm/product/`.

The Windows desktop runtime gate is `PASS/PROCEED`: local backend, frontend, and Agent API validation support continuing with the Windows `.exe` product fork. Docker Compose remains a deferred packaging validation gate, not a blocker for the desktop runtime path.

## Product Contracts Added

| Contract | Result | Evidence |
|---|---|---|
| Linux basic health skill | PASS | `docs/skills/linux-basic-health.md` and `apps/winkterm/product/skills/linux-basic-health/`; hardened read-only inventory uses bounded output, 10-second per-check timeouts, and systemd-unavailable skip behavior |
| Command policy | PASS | `docs/security/command-policy-milestone-1.md` and `apps/winkterm/product/policy/risk_rules.yaml`; policy allows only exact approved read-only commands after plan approval and blocks mutation command families |
| CLI diagnosis contract | PASS | `docs/cli/ssh-ai-diagnose.md`; contract includes JSON output schema and separates per-check failed/timed-out/skipped results from fatal SSH execution failures |

## Next Implementation Slice

The next implementation slice should add code inside `apps/winkterm/product/` to:

1. Load `checks.yaml`.
2. Evaluate `risk_rules.yaml`.
3. Render a diagnosis plan with exact commands, reasons, and per-check timeouts.
4. Execute approved checks through existing WinkTerm SSH APIs.
5. Record per-check completed, failed, timed-out, and skipped states without treating every single-check issue as fatal.
6. Generate a Markdown report.
7. Expose the flow through `ssh-ai diagnose`, including the contracted JSON output mode.

## Deferred Gates

Docker Compose packaging validation remains deferred until BIOS/UEFI virtualization is enabled and Docker Desktop's Linux engine is healthy. Do not mark Docker packaging as passed until `docker compose config`, `docker compose up -d`, and container health/status checks pass in that environment.
