# SSH Agent Tool Secondary Development Design

Date: 2026-06-25
Status: Draft approved for planning

## 1. Goal

Build an SSH operations tool with integrated Agent capability by reusing mature open-source SSH/terminal projects instead of starting from scratch.

The first product goal is a usable troubleshooting loop:

1. User connects to a server through SSH.
2. User asks a natural-language operations question.
3. Agent reads terminal/server context and selects a troubleshooting skill.
4. Agent generates an execution plan.
5. User approves safe diagnostic commands.
6. Tool runs read-only checks over SSH.
7. Agent summarizes evidence, likely cause, and repair suggestions.
8. Any risky repair command requires explicit confirmation.

The architecture must support later updates, new skills, new MCP tools, new model providers, CLI automation, and a desktop UI without rewriting core logic.

## 2. Recommended Open-Source Base

### Primary base: WinkTerm

Use WinkTerm as the preferred first fork candidate.

Reasons:

- Existing SSH and terminal PTY experience.
- AI works inside the same terminal context.
- Provides HTTP Agent API concepts.
- Has an installable skill mechanism.
- Supports OpenAI, Anthropic, Ollama, and OpenAI-compatible endpoints.
- MIT license, suitable for secondary development with attribution.
- Smaller and easier to reshape than a larger all-in-one SRE product.

Expected reuse:

- Web terminal UI.
- PTY/session management.
- SSH connection handling.
- Agent API pattern.
- Skill delivery concept.
- Model provider configuration pattern.

### Product reference: Chaterm

Use Chaterm as a product and workflow reference, not necessarily as the first fork.

Reasons:

- Product direction is close to AI-native SSH/SRE tooling.
- Includes Agent mode, Skills, and MCP configuration.
- Useful reference for infrastructure troubleshooting UX.

Before direct fork, evaluate license, dependency complexity, mobile/desktop coupling, and how invasive product changes would be.

### Supporting components

Use these projects as implementation references or optional embedded dependencies:

- `mcp-ssh-manager`: reference for MCP tools covering SSH execution, file transfer, health checks, backup, database operations.
- `mcp-ssh-orchestrator`: reference for policy, dry-run, audit, allowlist, timeout, cancellation, and structured denial responses.
- `Wave Terminal`: reference for terminal UX, remote file editing, durable SSH sessions, and cross-platform desktop polish.
- `term-cli`: reference for CLI-friendly interactive terminal control and Agent skills.

## 3. Architecture

The system should be split into three layers:

```text
Forked SSH Terminal Base
  - SSH
  - PTY
  - SFTP
  - terminal UI
  - session WebSocket/streaming

Agent Operations Layer
  - Agent Orchestrator
  - Skill Runtime
  - MCP Gateway
  - Policy Engine
  - Audit Logger
  - Secret Redactor
  - Model Providers

Product Access Layer
  - CLI
  - Desktop UI
  - Local HTTP API
  - MCP Server API
  - Reports
```

The forked base should remain as close to upstream as practical. New product logic should live in separate packages or modules so upstream updates can still be merged.

## 4. Repository Structure

Recommended long-term layout:

```text
apps/
  web/                  # reused and customized terminal web UI
  desktop/              # later Tauri/Electron desktop shell
  cli/                  # ssh-ai CLI

packages/
  ssh-core/             # SSH, SFTP, PTY abstractions
  agent-core/           # agent planning and execution loop
  skill-runtime/        # SKILL.md loading, versioning, execution
  mcp-gateway/          # MCP client and MCP server
  policy-engine/        # command risk classification and approvals
  audit-log/            # session/action records
  secret-redactor/      # redact tokens, keys, passwords, env secrets
  model-providers/      # OpenAI, DeepSeek, Qwen, Ollama, Anthropic, compatible APIs
  report-renderer/      # markdown/html/json report generation

skills/
  linux-basic-health/
  nginx-502/
  docker-service-failed/
  mysql-health/
  redis-health/

docs/
  architecture/
  skills/
  mcp/
  security/
```

During the first fork, keep the upstream project structure working. Introduce this layout incrementally when extraction becomes useful.

## 5. Core Modules

### SSH Core

Responsibilities:

- Import SSH hosts from `~/.ssh/config`.
- Manage password, key, and agent-based authentication.
- Open interactive terminal sessions.
- Execute one-shot commands.
- Stream long-running command output.
- Upload/download files through SFTP.
- Track current working directory and command exit code where possible.

Important APIs:

- `listHosts()`
- `testHost(hostId)`
- `openTerminal(hostId)`
- `exec(hostId, command, options)`
- `upload(hostId, localPath, remotePath)`
- `download(hostId, remotePath, localPath)`

### Agent Orchestrator

Responsibilities:

- Convert user request into a structured troubleshooting plan.
- Select relevant skills and MCP tools.
- Request approval before command execution.
- Execute allowed diagnostic steps through SSH Core or MCP Gateway.
- Observe outputs and iterate.
- Produce evidence-backed diagnosis and repair suggestions.

The first version should not allow fully autonomous repair in production. It should default to read-only diagnostics and plan-first repair.

Execution phases:

1. Understand request.
2. Gather context.
3. Select skill.
4. Produce plan.
5. Run approved checks.
6. Analyze evidence.
7. Recommend fix.
8. Ask for repair approval if needed.

### Skill Runtime

Skill format:

```text
skill-name/
  SKILL.md
  manifest.yaml
  checks.yaml
  scripts/
  examples/
```

`SKILL.md` describes when and how the Agent should use the skill.

`manifest.yaml` declares:

- Name.
- Version.
- Description.
- Required tools.
- Supported OS/software.
- Risk level.
- Minimum app version.

`checks.yaml` contains structured diagnostic commands where possible. This gives the policy engine a stable surface to review.

First built-in skills:

- `linux-basic-health`: CPU, memory, disk, network, system logs.
- `nginx-502`: upstream health, config test, error logs, port checks.
- `docker-service-failed`: container status, logs, restart count, disk pressure.
- `mysql-health`: process status, connections, slow query hints, disk usage.
- `redis-health`: memory, clients, persistence, latency hints.

### MCP Gateway

Two modes are required:

1. MCP Server mode: external agents call this SSH tool.
2. MCP Client mode: this product calls external MCP servers.

Server-side tools:

- `ssh_list_hosts`
- `ssh_describe_host`
- `ssh_exec`
- `ssh_plan`
- `ssh_upload`
- `ssh_download`
- `ssh_tail_log`
- `ssh_run_skill`
- `ssh_get_audit_session`

Client-side integrations for later:

- Prometheus.
- Grafana.
- Kubernetes.
- Docker.
- Git.
- Database tools.
- Filesystem tools.

### Policy Engine

Default modes:

- `readonly`: only diagnostic commands.
- `confirm`: risky commands require approval.
- `restricted`: host/group-specific allowlist.
- `admin`: broader access but still audited.

Risk levels:

- `safe`: read-only checks such as `df`, `free`, `uptime`, `systemctl status`.
- `medium`: service restart, config validation, log truncation.
- `high`: deletion, package install/remove, firewall changes, reboot, data mutation.
- `blocked`: destructive or ambiguous commands such as broad `rm -rf`, raw disk writes, unsafe credential exfiltration.

The policy engine must inspect:

- Raw command.
- Skill source.
- Target host/group.
- Environment tag such as production/staging.
- Current execution mode.
- User approval state.

### Audit Logger

Record every Agent operation:

- Session ID.
- User request.
- Selected skill.
- Proposed plan.
- Commands executed.
- Host target.
- Output summary and raw output reference.
- Approval decisions.
- Policy decisions.
- Model/provider metadata.
- Final diagnosis/report.

Audit storage should support local SQLite first. Later it can export JSONL, Markdown, HTML, or sync to a team server.

### Secret Redactor

Before sending content to a model, redact:

- API keys.
- SSH private keys.
- Passwords.
- Tokens.
- Database DSNs.
- Cloud credentials.
- `.env` sensitive values.
- Known secret patterns.

The redactor should run on command output, files, environment dumps, and logs.

## 6. CLI Design

The CLI should be a first-class interface, not a wrapper added later.

Binary name:

```bash
ssh-ai
```

Host commands:

```bash
ssh-ai host import ~/.ssh/config
ssh-ai host add prod-1 --host 1.2.3.4 --user root --key ~/.ssh/id_rsa
ssh-ai host list
ssh-ai host test prod-1
```

Execution commands:

```bash
ssh-ai connect prod-1
ssh-ai exec prod-1 "df -h"
ssh-ai exec @prod "uptime && free -h"
ssh-ai upload prod-1 ./app.tar.gz /tmp/app.tar.gz
ssh-ai download prod-1 /var/log/nginx/error.log ./error.log
```

Agent commands:

```bash
ssh-ai ask prod-1 "为什么 nginx 返回 502"
ssh-ai diagnose prod-1 --profile linux-basic
ssh-ai diagnose prod-1 --profile docker --report markdown
ssh-ai fix prod-1 "清理 docker 日志" --plan
ssh-ai fix prod-1 "清理 docker 日志" --apply
```

Skill commands:

```bash
ssh-ai skill list
ssh-ai skill install nginx-502
ssh-ai skill run prod-1 nginx-502
ssh-ai skill create "排查 Redis 内存异常"
```

MCP commands:

```bash
ssh-ai mcp serve
ssh-ai mcp tools
ssh-ai mcp add prometheus
```

Policy and audit commands:

```bash
ssh-ai policy set prod --mode readonly
ssh-ai policy allow prod "systemctl status *"
ssh-ai policy require-approval prod "systemctl restart *"
ssh-ai session list
ssh-ai session show sess_123
ssh-ai session export sess_123 --format markdown
```

## 7. Local API Design

The desktop UI, CLI, and external integrations should use the same local API.

Important endpoints:

```text
GET    /api/hosts
POST   /api/hosts/import
POST   /api/hosts/test

POST   /api/ssh/{hostId}/exec
POST   /api/ssh/{hostId}/terminal
POST   /api/ssh/{hostId}/upload
POST   /api/ssh/{hostId}/download

POST   /api/agent/ask
POST   /api/agent/diagnose
POST   /api/agent/fix-plan
POST   /api/agent/fix-apply

GET    /api/skills
POST   /api/skills/install
POST   /api/skills/{skillId}/run

GET    /api/sessions
GET    /api/sessions/{sessionId}
GET    /api/sessions/{sessionId}/report

GET    /api/policies
PUT    /api/policies/{scope}
```

Long-running operations should use WebSocket or SSE streaming.

## 8. Update and Extension Strategy

The product must support updates through stable extension points:

- Model provider adapters.
- Skills.
- MCP tools.
- Policy rules.
- Report templates.
- UI panels.
- CLI commands.

Versioned contracts:

- Config schema version.
- Skill manifest version.
- MCP tool schema version.
- Plugin API version.
- Local API version.
- Database migration version.

Upgrade rules:

- Never silently delete user configuration.
- Preserve secrets when fields are omitted or masked.
- Run migrations with backup.
- Validate skills before enabling them.
- Keep upstream fork changes isolated to reduce merge conflicts.

## 9. Fork Strategy

1. Fork the selected base project.
2. Keep upstream remote configured.
3. Avoid broad formatting or unrelated refactors.
4. Add product-specific code under clearly named modules.
5. Keep patches small and documented.
6. Add compatibility tests around reused SSH and PTY behavior.
7. Maintain a changelog of divergence from upstream.

Recommended branches:

```text
main                 # stable product branch
upstream-sync         # periodic upstream merge testing
feature/agent-core
feature/cli
feature/policy-engine
feature/skills
```

## 10. Milestones

### Milestone 0: Open-source base evaluation

Deliverables:

- Clone and run WinkTerm locally.
- Clone and run Chaterm locally if feasible.
- Compare build difficulty, license, architecture, SSH implementation, Agent implementation, and extension points.
- Select the actual fork base.

Exit criteria:

- One base project runs locally on Windows.
- SSH connection works.
- AI configuration works with at least one OpenAI-compatible provider.
- Clear decision document exists.

### Milestone 1: SSH + Agent troubleshooting loop

Deliverables:

- Fork selected base.
- Add product branding only where necessary.
- Add or expose local Agent API.
- Add first `linux-basic-health` skill.
- Agent can generate a plan and run read-only diagnostics.
- Produce Markdown diagnosis report.

Exit criteria:

- User can ask: "帮我看看这台服务器有什么异常".
- Tool executes approved read-only commands.
- Tool returns evidence-backed report.

### Milestone 2: CLI integration

Deliverables:

- `ssh-ai host list/test`.
- `ssh-ai exec`.
- `ssh-ai ask`.
- `ssh-ai diagnose`.
- `ssh-ai session show`.

Exit criteria:

- CLI can run the same diagnosis flow as UI.
- CLI output supports human-readable and JSON modes.

### Milestone 3: Skills and MCP

Deliverables:

- Skill loader with manifest validation.
- Built-in skills for Linux, Docker, Nginx.
- `ssh-ai mcp serve`.
- MCP tools for host list, exec, run skill, get session.

Exit criteria:

- External Agent can call this product through MCP.
- Built-in Agent can run skills through the same tool layer.

### Milestone 4: Safety and audit

Deliverables:

- Policy engine.
- Command risk classifier.
- Approval UI/CLI.
- Audit session storage.
- Secret redaction.

Exit criteria:

- Production host can be set to read-only.
- Risky commands are blocked or require approval.
- Audit report shows full decision trail.

### Milestone 5: Productization

Deliverables:

- Desktop packaging.
- Settings import/export.
- Skill marketplace or local skill directory.
- Report export.
- Better host/group UI.

Exit criteria:

- Non-developer user can install, configure model key, connect SSH, and run diagnosis.

## 11. First Development Slice

The first implementation slice should be intentionally small:

1. Evaluate WinkTerm locally.
2. Identify SSH execution API and Agent API boundaries.
3. Add a `linux-basic-health` skill.
4. Add plan-first diagnostic flow.
5. Add Markdown report output.
6. Add a minimal CLI command that calls the same backend:

```bash
ssh-ai diagnose <host> --profile linux-basic
```

This proves the core product without solving every future extension point.

## 12. Risks

### Upstream complexity

Risk: selected base project is difficult to build or heavily coupled.

Mitigation: run a short evaluation milestone before committing to a fork.

### Agent safety

Risk: Agent executes unsafe commands.

Mitigation: default readonly mode, plan-first execution, policy engine, approvals, audit.

### Secret leakage

Risk: logs or environment output sends secrets to the model.

Mitigation: local redaction before model calls, configurable sensitive paths, model call audit.

### Skill quality

Risk: low-quality skills produce unreliable diagnosis.

Mitigation: versioned skill manifests, tests with canned outputs, review gates for high-risk skills.

### Merge conflicts with upstream

Risk: product changes make upstream updates painful.

Mitigation: isolate custom logic, avoid broad edits, sync upstream on a regular branch.

## 13. Decision

Proceed with a fork-first development plan:

1. Evaluate WinkTerm as the primary base.
2. Use Chaterm as a feature and UX reference.
3. Reuse ideas from MCP SSH projects for tool schemas and security.
4. Build proprietary value in Agent troubleshooting workflows, Skills, MCP integration, policy, audit, and CLI.

