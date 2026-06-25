# Command Policy for Milestone 1

Milestone 1 defaults to read-only diagnosis. The policy contract mirrors the
current `linux-basic-health` skill inventory in
`apps/winkterm/product/skills/linux-basic-health/checks.yaml`.

## Safe Commands

These exact commands may run after the user approves the diagnosis plan:

- `uptime`
- `df -hT`
- `free -h`
- `ps -eo pid,user,pcpu,pmem,stat,comm --sort=-pcpu | head -n 16`
- `journalctl -p err -n 80 --no-pager`
- `systemctl --failed --no-pager`
- `ss -tulpn | head -n 80`

## Blocked Commands

These command families are blocked in Milestone 1:

- deletion: `rm`, `shred`
- disk mutation: `mkfs`, `dd`
- service mutation: `systemctl restart`, `systemctl stop`, `systemctl disable`
- package mutation: `apt install`, `apt remove`, `yum install`, `dnf install`
- reboot/shutdown: `reboot`, `shutdown`, `poweroff`
- firewall mutation: `iptables`, `ufw`, `firewall-cmd`

## Approval Rule

The Agent must show the diagnosis plan before execution. The user must approve
the plan before any SSH command runs. Repair commands are not executed in
Milestone 1.

## Timeout Rule

Each approved read-only command has a 10-second timeout. If a command exceeds
that timeout, the Agent stops waiting for that command, records it as timed out,
and continues the report with the evidence already collected.

## Systemd-Unavailable Skip Behavior

If the target host does not provide systemd, `journalctl`, or `systemctl`, the
Agent skips the affected systemd checks, records them as unsupported for that
host, and does not substitute unapproved commands.
