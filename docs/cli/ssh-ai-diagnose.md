# `ssh-ai diagnose`

Milestone 1 defines a companion Windows CLI command for the WinkTerm-based
desktop application. The CLI may be packaged as `ssh-ai.exe` on Windows and is
used for scriptable diagnosis entry points; it does not replace the Windows
desktop `.exe`, its SSH profile management, terminal UI, or approval surfaces.

Primary command:

```powershell
ssh-ai diagnose <host> --profile linux-basic
```

Windows packaged executable form:

```powershell
ssh-ai.exe diagnose <host> --profile linux-basic
```

This document is a behavior contract only. It does not implement the CLI,
policy engine, SSH execution, or report renderer.

## Inputs

- `<host>` resolves against WinkTerm SSH connection profiles.
- `--profile linux-basic` selects the built-in Linux basic health diagnosis
  profile.
- `--json` optionally requests machine-readable output.

## Contract Sources

Before rendering a plan, the CLI loads:

- `apps/winkterm/product/skills/linux-basic-health/checks.yaml`
- `apps/winkterm/product/policy/risk_rules.yaml`

The check inventory supplies command IDs, exact commands, reasons, risks, and
per-command timeouts. The policy rules define the default readonly mode, safe
exact commands, blocked command prefixes, and the shared command timeout.

## Plan Before Approval

The CLI must render the complete diagnosis plan before asking for approval. The
plan must show every exact command, its reason, and the 10-second timeout:

- `uptime`; timeout 10s; reason: load average and uptime.
- `df -hT`; timeout 10s; reason: disk pressure and filesystem types.
- `free -h`; timeout 10s; reason: memory and swap pressure.
- `ps -eo pid,user,pcpu,pmem,stat,comm --sort=-pcpu | head -n 16`; timeout
  10s; reason: top CPU consumers without full command arguments.
- `journalctl -p err -n 80 --no-pager`; timeout 10s; reason: recent system
  errors.
- `systemctl --failed --no-pager`; timeout 10s; reason: failed systemd units.
- `ss -tulpn | head -n 80`; timeout 10s; reason: bounded listening TCP and UDP
  services.

No SSH command may run until the user approves this displayed plan. Repair
commands are outside Milestone 1 execution and may only be suggested as a later
approval-required plan.

## Behavior

1. Resolve `<host>` against WinkTerm SSH connection profiles.
2. Load the Linux basic health check inventory and command policy contract.
3. Verify every planned command is listed in `safe_exact` and has the expected
   timeout.
4. Render the plan with exact commands, reasons, and timeouts.
5. Ask the user to approve or reject the plan.
6. Execute approved checks through the WinkTerm Agent API or SSH command
   execution wrapper.
7. Record each check result as completed, timed out, skipped, or failed.
8. Write a Markdown report to `reports/<session-id>.md`.
9. Print the report path and final summary.

## Check Result Boundary

A diagnosis session can complete even when one or more approved checks returns
a non-zero exit code. The CLI records each check independently:

- `completed`: the command ran to completion with exit code `0`.
- `failed`: the command ran to completion with a non-zero exit code.
- `timed_out`: the command exceeded its 10-second timeout.
- `skipped`: the command was not run because it is unsupported for the target,
  such as a systemd-specific check on a non-systemd host.

Single-check `failed`, `timed_out`, or `skipped` results are evidence in the
report and JSON output. They are not automatically fatal to the CLI process. If
the SSH connection and execution lifecycle remained usable enough to complete
the diagnosis session and write the report, the CLI can still exit `0`.

Exit code `4` is reserved for fatal SSH execution failure where the CLI cannot
establish or maintain SSH execution sufficiently to complete the diagnosis
session. Examples include host connection failure before checks, authentication
failure, transport failure, or connection loss that prevents continuing. If all
checks fail because the SSH session is unusable, the CLI exits `4`.

## Systemd-Unavailable Hosts

`journalctl` and `systemctl` are systemd-specific checks. If the target host
does not provide systemd, `journalctl`, or `systemctl`, the CLI records the
affected checks as skipped with an unavailable or unsupported reason. These
checks are not reported as failed, and the CLI must not substitute unapproved
commands.

## Reports

Each approved diagnosis writes one Markdown report:

```text
reports/<session-id>.md
```

The report includes the approved plan, command evidence, skipped checks,
timeouts, likely causes, recommended next checks, and any repair suggestions
that still require separate approval.

## Output Modes

Human output is the default:

```powershell
ssh-ai diagnose prod-1 --profile linux-basic
```

JSON output is supported for automation:

```powershell
ssh-ai diagnose prod-1 --profile linux-basic --json
```

In `--json` mode, stdout must contain exactly one JSON object after diagnosis
completion or fatal error. Human prompts may still be interactive before
execution unless a future non-interactive flag such as `--yes` exists. Prompt
text, approval text, progress messages, and human-readable errors go to stderr;
the final JSON object goes to stdout.

Required JSON fields:

- `status`: `completed`, `rejected`, or `error`.
- `exit_code`: integer process exit code.
- `host`: resolved host/profile name from the command input.
- `profile`: diagnosis profile, such as `linux-basic`.
- `session_id`: session identifier used for report naming, or `null` if no
  session could be created.
- `report_path`: `reports/<session-id>.md`, or `null` if no report was written.
- `summary`: final diagnosis summary string, or `null` for fatal errors before
  diagnosis evidence exists.
- `counts`: object with `completed`, `skipped`, `failed`, and `timed_out`
  integer counts.
- `checks`: array of per-check result objects.
- `error`: `null` for completed diagnosis, otherwise an object with `code` and
  `message`.

Each item in `checks` includes:

- `id`: check ID from `checks.yaml`.
- `command`: exact approved command.
- `status`: `completed`, `skipped`, `failed`, or `timed_out`.
- `exit_code`: command exit code, or `null` when skipped or timed out before an
  exit code is available.
- `duration_ms`: command duration in milliseconds, or `null` if not run.
- `reason`: check reason from `checks.yaml`.
- `message`: short result explanation.

## Exit Codes

| Code | Meaning |
|---:|---|
| 0 | diagnosis session completed and report/JSON was produced; individual checks may be completed, skipped, failed, or timed out |
| 1 | user rejected plan |
| 2 | host not found |
| 3 | policy blocked command |
| 4 | fatal SSH execution failure prevented session completion; includes connection failure, authentication failure, transport failure, connection loss that prevents continuing, or all checks failing because the SSH session is unusable |
| 5 | report generation failed |
