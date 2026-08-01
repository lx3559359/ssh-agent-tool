# ShellPilot v0.4.24 Requirement Source Inventory

## User objective

- 在当前最新版本下，以真实使用者身份执行三轮详细自检。
- 找出可复现的 BUG、使用问题和不合理行为。
- 在现有功能范围内优化、修复和调整。
- 证明当前版本是否满足此前已经提出并保留的要求。

## Current user-facing contract

| Source | Role |
| --- | --- |
| `apps/electerm-agent/docs/USER_GUIDE_ZH.md` | 当前用户可见功能、入口、操作结果和安全承诺的主合同 |
| `apps/electerm-agent/docs/releases/v0.4.24.md` | 当前版本新增、修复和改动承诺 |
| `apps/electerm-agent/package.json` | 产品名、版本、运行与验证命令 |
| `apps/electerm-agent/README_cn.md` | 对外功能概览、快速开始和安全声明 |

## Root specifications

以下 13 份为当前主线保留的既有产品规格：

1. `docs/superpowers/specs/2026-07-14-shellpilot-secondary-ui-modernization-design.md`
2. `docs/superpowers/specs/2026-07-15-shellpilot-ai-takeover-and-user-skills-design.md`
3. `docs/superpowers/specs/2026-07-15-shellpilot-fleet-operations-design.md`
4. `docs/superpowers/specs/2026-07-18-shellpilot-official-website-design.md`
5. `docs/superpowers/specs/2026-07-24-skill-creator-and-ai-cancellation-design.md`
6. `docs/superpowers/specs/2026-07-28-ssh-tunnel-manager-design.md`
7. `docs/superpowers/specs/2026-07-28-stability-0.4.17-design.md`
8. `docs/superpowers/specs/2026-07-29-shellpilot-bookmark-group-workflow-design.md`
9. `docs/superpowers/specs/2026-07-29-shellpilot-incident-archive-loop-design.md`
10. `docs/superpowers/specs/2026-07-31-ai-assistant-comprehensive-self-audit-design.md`
11. `docs/superpowers/specs/2026-07-31-artifact-incident-content-ingestion-design.md`
12. `docs/superpowers/specs/2026-08-01-shellpilot-aurora-lift-depth-radius-design.md`
13. `docs/superpowers/specs/2026-08-01-shellpilot-aurora-ui-modernization-design.md`

本轮新增的元规格为：

- `docs/superpowers/specs/2026-08-01-shellpilot-v0.4.24-three-round-self-audit-design.md`

它定义审计方法和完成证据，不反向证明任何产品要求已经实现。

## Application specifications

以下 19 份应用内规格均进入需求语料：

1. `apps/electerm-agent/docs/superpowers/specs/2026-07-11-file-context-and-domestic-update-design.md`
2. `apps/electerm-agent/docs/superpowers/specs/2026-07-12-server-status-center-design.md`
3. `apps/electerm-agent/docs/superpowers/specs/2026-07-12-update-source-help-release-design.md`
4. `apps/electerm-agent/docs/superpowers/specs/2026-07-13-ai-ops-safety-transaction-design.md`
5. `apps/electerm-agent/docs/superpowers/specs/2026-07-17-client-ux-performance-design.md`
6. `apps/electerm-agent/docs/superpowers/specs/2026-07-18-agent-readonly-fast-path-design.md`
7. `apps/electerm-agent/docs/superpowers/specs/2026-07-18-quality-observability-recovery-design.md`
8. `apps/electerm-agent/docs/superpowers/specs/2026-07-19-light-depth-ui-font-design.md`
9. `apps/electerm-agent/docs/superpowers/specs/2026-07-19-shellpilot-external-mcp-client-design.md`
10. `apps/electerm-agent/docs/superpowers/specs/2026-07-20-quick-command-balanced-expansion-design.md`
11. `apps/electerm-agent/docs/superpowers/specs/2026-07-24-disconnected-homepage-redesign-design.md`
12. `apps/electerm-agent/docs/superpowers/specs/2026-07-24-operations-toolkit-design.md`
13. `apps/electerm-agent/docs/superpowers/specs/2026-07-24-operations-toolkit-phase-2-safe-maintenance-design.md`
14. `apps/electerm-agent/docs/superpowers/specs/2026-07-24-operations-toolkit-phase-3-runbook-center-design.md`
15. `apps/electerm-agent/docs/superpowers/specs/2026-07-24-startup-and-chat-simplification-design.md`
16. `apps/electerm-agent/docs/superpowers/specs/2026-07-25-release-safety-and-operations-lifecycle-design.md`
17. `apps/electerm-agent/docs/superpowers/specs/2026-07-26-ai-office-artifact-workspace-design.md`
18. `apps/electerm-agent/docs/superpowers/specs/2026-07-28-operation-reliability-center-design.md`
19. `apps/electerm-agent/docs/superpowers/specs/2026-07-30-incident-assisted-capture-design.md`

## Completed implementation plans

历史计划用于定位实现文件、测试命令和已知边界。计划勾选不能替代当前证据。

### Root plans

1. `docs/superpowers/plans/2026-07-08-aigshell-main-ui-v1.md`
2. `docs/superpowers/plans/2026-07-12-shellpilot-0.3.6-plan-a.md`
3. `docs/superpowers/plans/2026-07-14-shellpilot-secondary-ui-modernization.md`
4. `docs/superpowers/plans/2026-07-15-shellpilot-ai-takeover-01-session-gate.md`
5. `docs/superpowers/plans/2026-07-15-shellpilot-ai-takeover-02-controlled-runtime.md`
6. `docs/superpowers/plans/2026-07-15-shellpilot-ai-takeover-03-user-skill-runtime.md`
7. `docs/superpowers/plans/2026-07-15-shellpilot-ai-takeover-04-skill-creator-release.md`
8. `docs/superpowers/plans/2026-07-15-shellpilot-ai-takeover-roadmap.md`
9. `docs/superpowers/plans/2026-07-15-shellpilot-fleet-operations.md`
10. `docs/superpowers/plans/2026-07-24-skill-creator-and-ai-cancellation.md`
11. `docs/superpowers/plans/2026-07-28-ssh-tunnel-manager.md`
12. `docs/superpowers/plans/2026-07-28-ssh-tunnel-reliability.md`
13. `docs/superpowers/plans/2026-07-29-shellpilot-bookmark-group-workflow.md`
14. `docs/superpowers/plans/2026-07-29-shellpilot-incident-archive-phase-1.md`
15. `docs/superpowers/plans/2026-07-31-artifact-incident-content-ingestion.md`
16. `docs/superpowers/plans/2026-07-31-self-audit-0.4.22-fixes.md`
17. `docs/superpowers/plans/2026-08-01-shellpilot-aurora-lift-depth-radius.md`
18. `docs/superpowers/plans/2026-08-01-shellpilot-aurora-ui-modernization.md`

本轮执行计划 `docs/superpowers/plans/2026-08-01-shellpilot-v0.4.24-three-round-self-audit.md` 只定义当前工作步骤。

### Application plans

1. `apps/electerm-agent/docs/superpowers/plans/2026-07-11-long-log-and-archive-reading.md`
2. `apps/electerm-agent/docs/superpowers/plans/2026-07-12-server-status-center.md`
3. `apps/electerm-agent/docs/superpowers/plans/2026-07-12-update-source-help-release.md`
4. `apps/electerm-agent/docs/superpowers/plans/2026-07-13-ai-ops-safety-transaction.md`
5. `apps/electerm-agent/docs/superpowers/plans/2026-07-17-client-ux-performance-plan.md`
6. `apps/electerm-agent/docs/superpowers/plans/2026-07-18-agent-readonly-fast-path-plan.md`
7. `apps/electerm-agent/docs/superpowers/plans/2026-07-18-quality-observability-recovery-plan.md`
8. `apps/electerm-agent/docs/superpowers/plans/2026-07-19-bilingual-ui-localization-implementation.md`
9. `apps/electerm-agent/docs/superpowers/plans/2026-07-19-light-depth-ui-implementation.md`
10. `apps/electerm-agent/docs/superpowers/plans/2026-07-19-shellpilot-external-mcp-client.md`
11. `apps/electerm-agent/docs/superpowers/plans/2026-07-19-ui-font-presets-implementation.md`
12. `apps/electerm-agent/docs/superpowers/plans/2026-07-20-quick-command-balanced-expansion.md`
13. `apps/electerm-agent/docs/superpowers/plans/2026-07-24-disconnected-homepage-redesign.md`
14. `apps/electerm-agent/docs/superpowers/plans/2026-07-24-operations-toolkit-phase-1.md`
15. `apps/electerm-agent/docs/superpowers/plans/2026-07-24-operations-toolkit-phase-2-safe-maintenance.md`
16. `apps/electerm-agent/docs/superpowers/plans/2026-07-24-operations-toolkit-phase-3-runbook-center.md`
17. `apps/electerm-agent/docs/superpowers/plans/2026-07-24-startup-and-chat-simplification-plan.md`
18. `apps/electerm-agent/docs/superpowers/plans/2026-07-26-ai-office-artifact-workspace.md`
19. `apps/electerm-agent/docs/superpowers/plans/2026-07-28-operation-reliability-center-plan.md`
20. `apps/electerm-agent/docs/superpowers/plans/2026-07-30-incident-assisted-capture.md`

## Executable contracts

- `apps/electerm-agent/test/unit-ci/*.spec.js`: module, security, persistence, rendering, update, package, and source-contract evidence.
- `apps/electerm-agent/test/e2e/*.spec.js`: isolated Electron user-journey evidence.
- `apps/electerm-agent/build/bin/smoke-ai.js`: minimal real-model path.
- `apps/electerm-agent/build/bin/smoke-ssh-sftp.js`: real SSH/SFTP path with cleanup contract.
- `apps/electerm-agent/build/bin/package-smoke-test.js`: packaged runtime contract.
- `apps/electerm-agent/build/bin/verify-online-update-sources.js`: online update metadata and byte verification.
- Real desktop operation through the isolated ShellPilot window: user-visible evidence not represented by source contracts alone.

## Precedence and superseded decisions

1. The user objective and explicit later corrections have highest product priority.
2. The current user guide and v0.4.24 release note define the minimum user-visible behavior for this version.
3. A newer specification overrides an older one only for the behavior it explicitly changes.
4. Aurora UI specifications are UI-only and cannot override SSH, SFTP, terminal, AI, safety, persistence, route, data, or keyboard contracts.
5. The incident-archive specification supersedes older ad hoc incident storage and manual database backup UI assumptions.
6. The unified operation-reliability specification supersedes fragmented task displays where it explicitly defines shared safety-center state.
7. The startup-and-chat simplification specification may hide unused composer entries, but it does not remove backend Skill, MCP, or CLI capability.
8. Historical plan checkboxes, screenshots, test names, and release prose are candidate evidence only; current execution decides status.
9. If documentation and current behavior disagree without an explicit superseding decision, the matrix records `部分满足` or `未满足`; it does not rewrite the requirement after the fact.
