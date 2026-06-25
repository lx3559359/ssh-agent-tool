---
name: linux-basic-health
description: Diagnose common Linux server health issues using read-only SSH commands.
risk: safe-readonly
version: 0.1.0
---

# Linux Basic Health

Use this skill when the user asks why a Linux server is slow, unhealthy, full, overloaded, failing services, or behaving abnormally.

Run only the checks listed in `checks.yaml`. Summarize command output with evidence. Do not run repair commands. If a repair appears useful, propose it as a plan that requires explicit user approval.
