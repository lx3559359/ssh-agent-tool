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
| process summary | `ps -eo pid,user,pcpu,pmem,stat,comm --sort=-pcpu | head -n 16` | top CPU consumers without full command arguments |
| journal errors | `journalctl -p err -n 80 --no-pager` | recent system errors |
| failed services | `systemctl --failed --no-pager` | failed units |
| listening ports | `ss -tulpn | head -n 80` | bounded listening TCP and UDP service exposure |

## Execution Expectations

Each command should run with a timeout. The built-in inventory uses `timeout_seconds: 10` for every check so slow or stale targets do not block the whole diagnosis. This is especially important for `df -hT`, which can hang on stale network or FUSE mounts. If a command times out, record the timeout in the evidence table and continue with the remaining checks.

`journalctl` and `systemctl` are systemd-specific. If either command is unavailable on the target host, record the command as unavailable and continue rather than failing the whole skill.

## Output

The skill returns:

1. Summary.
2. Evidence table.
3. Likely causes.
4. Recommended next checks.
5. Repair suggestions that require approval before execution.
