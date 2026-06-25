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
