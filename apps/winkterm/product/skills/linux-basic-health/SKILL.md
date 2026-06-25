---
name: linux-basic-health
description: Diagnose common Linux server health issues using read-only SSH commands.
risk: safe-readonly
version: 0.1.0
---

# Linux Basic Health

Use this skill when the user asks why a Linux server is slow, unhealthy, full, overloaded, failing services, or behaving abnormally.

Run only the checks listed in `checks.yaml`. Summarize command output with evidence. Do not run repair commands. If a repair appears useful, propose it as a plan that requires explicit user approval.

Apply the timeout for each check from `checks.yaml`. If a command times out or is unavailable, record that result and continue with the remaining checks. `journalctl` and `systemctl` are systemd-specific; on non-systemd hosts, treat them as unavailable rather than failing the whole skill.
