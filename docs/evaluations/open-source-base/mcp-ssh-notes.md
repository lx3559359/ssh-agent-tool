# MCP SSH Component Notes

Evaluation date: 2026-06-25

Scope note: Evidence below is static-only. Runtime/build validation was blocked by the evaluation environment missing usable Node/npm, Python, Docker, Rust, Go, and pnpm. Repositories were cloned and inspected locally under ignored `external/` paths.

## mcp-ssh-manager

Repository: https://github.com/bvisible/mcp-ssh-manager

Snapshot: `08cb74f` on `main`, latest commit `2026-06-18 13:35:36 +0200 chore: release v3.6.4`.

| Area | Notes |
|---|---|
| License | MIT. Evidence: `LICENSE`; `package.json` has `"license": "MIT"`; README badge links to MIT license. |
| Runtime | Node.js MCP server. Evidence: `package.json` declares `main: src/index.js`, `type: module`, `bin` entries for `mcp-ssh-manager` and `ssh-manager`, `engines.node >=18.0.0`, and dependencies on `@modelcontextprotocol/sdk`, `ssh2`, and `zod`. Runtime not executed because Node/npm are missing in this environment. |
| Tool list | STATIC YES: `src/tool-registry.js` defines 37 tools across `core`, `sessions`, `monitoring`, `backup`, `database`, and `advanced` groups. Core tools: `ssh_list_servers`, `ssh_execute`, `ssh_upload`, `ssh_download`, `ssh_sync`. Other relevant tools include `ssh_session_start`, `ssh_session_send`, `ssh_health_check`, `ssh_connection_status`, `ssh_key_manage`, `ssh_execute_group`, and `ssh_history`. |
| SSH host model | Hosts are configured by env/TOML-style server records. Evidence: `.env.example` uses `SSH_SERVER_<NAME>_HOST`, `USER`, `PASSWORD`, `KEYPATH`, `PORT`, `DEFAULT_DIR`, `DESCRIPTION`, `SUDO_PASSWORD`, and `PLATFORM`; README documents TOML `[ssh_servers.<name>]` blocks and per-server `MODE`, `ALLOW_PATTERNS`, `DENY_PATTERNS`, and `AUDIT_LOG`. |
| File transfer | STATIC YES. Evidence: `src/tool-registry.js` core group includes `ssh_upload`, `ssh_download`, and `ssh_sync`; `src/index.js` registers `ssh_upload` and `ssh_download` with SFTP descriptions and `ssh_sync` with rsync behavior. |
| Health checks | STATIC YES. Evidence: `src/tool-registry.js` monitoring group includes `ssh_health_check`, `ssh_service_status`, `ssh_process_manager`, `ssh_monitor`, `ssh_tail`, and `ssh_alert_setup`; README describes health monitoring for CPU, RAM, disk, network, services, processes, and alerts. |
| Safety controls | STATIC PARTIAL/STRONG. Evidence: `src/policy.js` implements per-server `unrestricted`, `readonly`, and `restricted` modes; `readonly` blocks mutating tools and destructive command regexes; `restricted` requires `ALLOW_PATTERNS` and applies `DENY_PATTERNS` with deny winning. `src/audit.js` writes opt-in per-server JSONL audit with sensitive field redaction. Gap: the default mode is unrestricted unless configured. |
| Reuse recommendation | Reuse tool schema and selected implementation ideas, not as the primary product base. Strong candidates: `ssh_upload`, `ssh_download`, `ssh_sync`, `ssh_connection_status`, `ssh_health_check`, `ssh_key_manage`, tool grouping/activation from `src/tool-registry.js`, and audit redaction from `src/audit.js`. Wrap or redesign policy defaults to be plan-first/deny-by-default for our product. |

## mcp-ssh-orchestrator

Repository: https://github.com/samerfarida/mcp-ssh-orchestrator

Snapshot: `74ed170` on `main`, latest commit `2026-04-27 00:39:47 -0400 chore: prepare security release v1.3.1 (#131)`.

| Area | Notes |
|---|---|
| License | Apache-2.0. Evidence: `LICENSE`; README badge says Apache 2.0; `pyproject.toml` has `license = { text = "Apache-2.0" }`. |
| Runtime | Python MCP server, Docker-oriented. Evidence: README badges and quickstart document Python 3.13+ and Docker; `pyproject.toml` requires Python `>=3.11`, provides script `mcp-ssh-orchestrator = "mcp_ssh.mcp_server:main"`, and depends on `mcp`, `PyYAML`, and `paramiko`. Runtime not executed because Python/Docker are missing in this environment. |
| Tool list | STATIC YES: `src/mcp_ssh/mcp_server.py` registers `ssh_ping`, `ssh_list_hosts`, `ssh_describe_host`, `ssh_plan`, `ssh_run`, `ssh_run_on_tag`, `ssh_cancel`, `ssh_reload_config`, `ssh_run_async`, `ssh_get_task_status`, `ssh_get_task_result`, `ssh_get_task_output`, and `ssh_cancel_async_task`. It also exposes safe resources such as `ssh://hosts`, `ssh://host/{alias}`, `ssh://host/{alias}/tags`, and `ssh://host/{alias}/capabilities`. |
| Policy model | STATIC YES/STRONG. Evidence: README describes declarative policy-as-code in `config/servers.yml`, `config/credentials.yml`, and `config/policy.yml`, with deny-by-default controls, IP allowlists, command whitelisting, tags, and host key verification. `examples/example-policy.yml` shows `limits.deny_substrings`, `network.allow_cidrs`, version 2 structured `rules`, alias/tag matching, and overrides. `src/mcp_ssh/policy.py` parses command chains, blocks command substitution/path binaries, applies deny substrings before rules, and only allows matched `allow` rules. |
| Dry-run support | STATIC YES. Evidence: `ssh_plan` in `src/mcp_ssh/mcp_server.py` returns `alias`, `command`, `hash`, `allowed`, execution `limits`, `why`, `denied_command`, and `hint` without opening an SSH connection; README usage says to preview with `ssh_plan` before running upgrades. |
| Audit support | STATIC YES. Evidence: `src/mcp_ssh/policy.py` logs `policy_decision`, execution `audit`, and `progress` JSON to stderr; audit fields include alias, command hash, exit code, duration, byte counts, cancellation, timeout, and target IP. README and `docs/SECURITY.md` describe structured JSON audit logs and progress logs. |
| Structured denials | STATIC YES. Evidence: `_policy_denied_response` returns JSON with `status: denied`, `reason: policy`, `alias`, `hash`, `command`, and `hint`; `_network_denied_response` returns `status: denied`, `reason: network`, `alias`, `hostname`, `detail`, and `hint`. `ssh_run`, `ssh_run_async`, and tag execution use those denial shapes. |
| Reuse recommendation | Reuse policy and UX design, not as the primary product base. Strong candidates: `ssh_plan`, structured denial responses, deny-by-default policy model, command-chain parsing, host/tag inventory model, safe MCP resources, async task status/output/result pattern, and JSON audit/progress logging. Do not rely on it for file transfer or interactive PTY: `docs/wiki/03-Design-Goals.md` explicitly lists no file transfer and no interactive sessions. |

## Recommended Internal MCP Tool Surface

| Tool | Purpose | Source Inspiration |
|---|---|---|
| `ssh_list_hosts` | list configured hosts | `mcp-ssh-orchestrator` `ssh_list_hosts` and `ssh://hosts`; `mcp-ssh-manager` `ssh_list_servers`. |
| `ssh_describe_host` | describe connection and tags | `mcp-ssh-orchestrator` `ssh_describe_host`, `ssh://host/{alias}`, `ssh://host/{alias}/tags`, and `ssh://host/{alias}/capabilities`; `mcp-ssh-manager` server env/TOML host model. |
| `ssh_plan` | dry-run command against policy | `mcp-ssh-orchestrator` `ssh_plan`, structured allow/deny output, command hash, `why`, `denied_command`, and policy hint fields. |
| `ssh_exec` | execute approved command | `mcp-ssh-orchestrator` `ssh_run` for policy/network checks, structured denials, task IDs, audit, and timeout/output caps; `mcp-ssh-manager` `ssh_execute` for practical SSH command execution and cwd handling. |
| `ssh_upload` | upload file | `mcp-ssh-manager` `ssh_upload` SFTP tool and `ssh_sync` transfer-count behavior. `mcp-ssh-orchestrator` intentionally does not support file transfer, so it should inform policy restrictions only. |
| `ssh_download` | download file | `mcp-ssh-manager` `ssh_download` SFTP tool. Add our own audit and policy gate inspired by `mcp-ssh-orchestrator`. |
| `ssh_run_skill` | run a troubleshooting skill | WinkTerm Task 2 evidence for `agent-skill/SKILL.md` and `/api/agent/skill.md`; `mcp-ssh-manager` `ssh_command_alias`/`ssh_profile` can inspire reusable command bundles, but it is not a full Skill system. |
| `ssh_get_audit_session` | read session audit trail | `mcp-ssh-manager` per-server JSONL audit/redaction in `src/audit.js`; `mcp-ssh-orchestrator` `policy_decision`, `audit`, and `progress` JSON records in `src/mcp_ssh/policy.py`. |
