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

## Exit Codes

| Code | Meaning |
|---:|---|
| 0 | diagnosis completed; skipped unsupported systemd checks are allowed |
| 1 | user rejected plan |
| 2 | host not found |
| 3 | policy blocked command |
| 4 | SSH execution failed |
| 5 | report generation failed |
