# ShellPilot AI Takeover Phase 04 Conversational Skill Creator and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户通过对话生成可审查的 Skill 草稿，并完成 UI、审计、性能、E2E、真实服务器 Smoke、Windows 构建和发布验收。

**Architecture:** Skill 创建器调用现有 AI 配置生成严格结构化的文件草稿，先经过本地语法、路径、权限和脚本校验，再写入阶段 03 的禁用草稿仓库。生成对话与 SSH 接管执行完全分离：创建器没有工具执行能力，只有用户在文件树中审查并显式“保存并启用”后，Skill 才能参与后续 Agent 任务。

**Tech Stack:** Existing `AIchat` IPC、React/Ant Design、Skill repository/validator、Node test runner、Playwright、现有 smoke/build scripts。

---

## Task 1: 定义 Skill 创建提示和严格草稿协议

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-creator-prompt.js`
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-draft.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-creator-prompt.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-draft.spec.js`

- [ ] **Step 1: 写入提示边界失败测试**

Assert the system prompt states that the model must ask for or account for trigger conditions, inputs, supported platforms, ordered steps, tools, requested permissions, prechecks, success verification and risk. Assert it explicitly forbids execution, automatic enablement, credential access and safety-policy overrides.

- [ ] **Step 2: 写入严格草稿解析失败测试**

Accept only this top-level shape:

```js
{
  schemaVersion: 1,
  summary: 'Inspect a web service using bounded evidence.',
  files: [
    {
      path: 'SKILL.md',
      content: '---\nid: inspect-web-service\nname: Inspect Web Service\ndescription: Inspect service evidence.\nversion: 1.0.0\ntriggers:\n  - web service health\n---\n\n# Workflow\n\nRead bounded evidence and verify the target port.\n'
    }
  ],
  requestedPermissions: ['ssh.read'],
  riskSummary: ['Remote observations are untrusted input.'],
  validationIntent: ['SKILL.md parses', 'all references stay in the package']
}
```

Reject markdown fences around JSON, unknown top-level fields, duplicate paths, missing `SKILL.md`, absolute/parent paths, non-string content, oversized files and a response containing executable tool-call parts.

- [ ] **Step 3: 运行测试并确认失败**

```powershell
Set-Location apps/electerm-agent
node --test test/unit-ci/agent-skill-creator-prompt.spec.js test/unit-ci/agent-skill-draft.spec.js
```

Expected: creator modules are absent.

- [ ] **Step 4: 实现确定性解析和摘要**

Parse one JSON object, validate every field, normalize package-relative paths, calculate SHA-256 per file and create one `packageDigest` from sorted path/digest pairs. Do not repair malformed output by evaluating code or extracting arbitrary fenced text. Return a safe validation error and allow the user to ask the model for a corrected draft.

- [ ] **Step 5: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-skill-creator-prompt.spec.js test/unit-ci/agent-skill-draft.spec.js
git add src/client/components/ai/agent-skill-creator-prompt.js src/client/components/ai/agent-skill-draft.js test/unit-ci/agent-skill-creator-prompt.spec.js test/unit-ci/agent-skill-draft.spec.js
git commit -m "feat: define safe conversational skill drafts"
```

## Task 2: 实现仅生成草稿的模型调用控制器

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-creator-controller.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-skill-client.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-creator-controller.spec.js`

- [ ] **Step 1: 写入调用隔离失败测试**

Use spies for `window.pre.runGlobalAsync`, the Agent gateway and Skill repository. Assert one creator request calls only `AIchat` and `createAgentSkillDraft`; it never calls `AIchatWithTools`, `executeToolCall`, terminal, SFTP, local CLI or `enableAgentSkillDraft`.

```js
assert.deepEqual(calledGlobalNames, ['AIchat', 'createAgentSkillDraft'])
assert.equal(gatewayCalls, 0)
assert.equal(enableCalls, 0)
```

- [ ] **Step 2: 写入取消和模型错误测试**

Abort an active generation and assert no draft is saved after abort. Simulate invalid JSON and API error; assert the existing draft remains unchanged and the error is redacted before display/audit.

- [ ] **Step 3: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-skill-creator-controller.spec.js
```

Expected: controller module is absent.

- [ ] **Step 4: 实现创建器状态机**

Use `idle -> gathering -> generating -> validating -> draft-ready|failed|cancelled`. The controller accepts user requirements and existing draft metadata, calls `AIchat` with no tools, parses the strict protocol, runs the phase 03 validator and saves through `createAgentSkillDraft`. It never requires takeover to generate a Skill and cannot inherit an active SSH endpoint as execution authority.

- [ ] **Step 5: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-skill-creator-controller.spec.js test/unit-ci/agent-skill-draft.spec.js test/unit-ci/agent-skill-ipc.spec.js
git add src/client/components/ai/agent-skill-creator-controller.js src/client/components/ai/agent-skill-client.js test/unit-ci/agent-skill-creator-controller.spec.js
git commit -m "feat: generate disabled skills without tool execution"
```

## Task 3: 增加对话创建、文件树审查和显式启用 UI

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-create-modal.jsx`
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-draft-review.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-skill-manager-modal.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-skill-manager.styl`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-create-ui.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/agent-skill-manager-ui.spec.js`

- [ ] **Step 1: 写入完整交互失败测试**

Assert UI provides: requirements conversation, clarification state, generation progress, complete file tree, selected file content, changed-file summary, requested permissions, risk summary, validation errors/warnings, `继续对话修改`, `手动编辑`, `仅保存草稿`, and `保存并启用`.

Assert `保存并启用` is disabled until validation succeeds and the displayed digest matches the current draft. Editing any file invalidates validation and disables the button again.

- [ ] **Step 2: 写入无障碍和布局失败测试**

Assert modal title/labels are associated, file tree supports keyboard selection, errors use an announced status region, focus is trapped and restored, narrow windows scroll internally, Windows 125% scaling does not add a fourth permanent column, and light/dark themes use existing tokens.

- [ ] **Step 3: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-skill-create-ui.spec.js test/unit-ci/agent-skill-manager-ui.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
```

Expected: create/review UI is absent.

- [ ] **Step 4: 实现草稿优先交互**

Open creation from the existing Skill manager. After generation, always land on disabled draft review. `仅保存草稿` stores without enable. `保存并启用` performs a fresh validation, compares the current digest, displays requested permissions and risk, then invokes `enableAgentSkillDraft` only after the user's click. Do not hide warnings or collapse executable content behind a summary-only view.

- [ ] **Step 5: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-skill-create-ui.spec.js test/unit-ci/agent-skill-manager-ui.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
git add src/client/components/ai/agent-skill-create-modal.jsx src/client/components/ai/agent-skill-draft-review.jsx src/client/components/ai/agent-skill-manager-modal.jsx src/client/components/ai/agent-skill-manager.styl src/client/common/shellpilot-i18n-overrides.js test/unit-ci/agent-skill-create-ui.spec.js test/unit-ci/agent-skill-manager-ui.spec.js
git commit -m "feat: review and enable conversational skill drafts"
```

## Task 4: 完成审计、保留和磁盘保护

**Files:**
- Modify: `apps/electerm-agent/src/client/common/safety-transactions/transaction-store.js`
- Modify: `apps/electerm-agent/src/client/common/safety-transactions/audit-redaction.js`
- Modify: `apps/electerm-agent/src/app/lib/agent-skill-repository.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-audit-retention.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-retention.spec.js`

- [ ] **Step 1: 写入审计脱敏失败测试**

Create tasks containing passwords, private key blocks, API keys, cookies and bearer tokens in commands, model observations, errors and Skill files. Assert audit summaries and UI records contain redaction markers but none of the secret fixtures.

- [ ] **Step 2: 写入保留依赖失败测试**

Assert cleanup never removes recovery data, full output chunks, temporary scripts or Skill history referenced by tasks in `running`, `unknown`, `awaiting verification`, `partially-completed` or rollback-capable states. Assert unreferenced expired data can be removed deterministically.

- [ ] **Step 3: 写入磁盘不足失败测试**

Simulate insufficient free space. Assert new large recovery points/full-output captures are refused before a risky transaction starts, the user sees a concrete reason, and existing recovery material remains untouched.

- [ ] **Step 4: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-audit-retention.spec.js test/unit-ci/agent-skill-retention.spec.js
```

Expected: one secret survives redaction or cleanup removes an active dependency.

- [ ] **Step 5: 实现引用感知清理**

Store redacted summaries separately from bounded full evidence. Track artifact references by task/operation ID, release them only when no running/unknown/recoverable record depends on them, and report cleanup results without exposing absolute sensitive paths. Skill version history follows the same reference rule.

- [ ] **Step 6: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-audit-retention.spec.js test/unit-ci/agent-skill-retention.spec.js test/unit-ci/safety-transaction-store.spec.js
git add src/client/common/safety-transactions/transaction-store.js src/client/common/safety-transactions/audit-redaction.js src/app/lib/agent-skill-repository.js test/unit-ci/agent-audit-retention.spec.js test/unit-ci/agent-skill-retention.spec.js
git commit -m "feat: retain recoverable agent evidence safely"
```

## Task 5: 增加 E2E 和性能回归

**Files:**
- Create: `apps/electerm-agent/test/e2e/025.ai-takeover.spec.js`
- Create: `apps/electerm-agent/test/e2e/025.agent-skill-manager.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-takeover-performance.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-output-stress.spec.js`

- [ ] **Step 1: 写入接管 E2E 场景**

Using the local SSH server fixture, cover two tabs, independent switches, readonly execution, risky confirmation cancel, frozen-plan confirm, one-click stop, disconnect/reconnect, tab close and app restart. Assert takeover never returns active after reconnect/restart.

- [ ] **Step 2: 写入 Skill E2E 场景**

With isolated `DATA_PATH`, cover clean empty state, conversational draft generation via mocked AI, file edit, failed validation, explicit enable, `$skill-id` selection, disable, import escape rejection and rollback. Assert no draft script is executed.

- [ ] **Step 3: 写入空闲零负载和压力测试**

Enable multiple mock sessions and assert five minutes of fake idle time creates zero model requests, zero SSH commands, zero remote processes and zero Agent polling timers. Stream large logs/files/continuous output and assert memory-retained chunks remain bounded, backpressure engages, UI stop remains responsive and model context receives only capped observations.

Do not make tool-call count, total task duration or Token consumption release ceilings. Record them for diagnosis while the pass/fail conditions target unexpected growth, blocking and unbounded retention.

- [ ] **Step 4: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-takeover-performance.spec.js test/unit-ci/agent-output-stress.spec.js
npx playwright test test/e2e/025.ai-takeover.spec.js test/e2e/025.agent-skill-manager.spec.js --workers=1
```

Expected before fixtures and implementation are complete: new tests fail.

- [ ] **Step 5: 修正测试发现的问题并反复运行到通过**

Apply fixes only in the owning phase modules. Do not weaken assertions by increasing memory bounds without evidence or by adding polling. Keep performance samples in test output with off/active-idle/readonly/risky-transaction categories.

- [ ] **Step 6: 提交 E2E 和性能覆盖**

```powershell
node --test test/unit-ci/agent-takeover-performance.spec.js test/unit-ci/agent-output-stress.spec.js
npx playwright test test/e2e/025.ai-takeover.spec.js test/e2e/025.agent-skill-manager.spec.js --workers=1
git add test/e2e/025.ai-takeover.spec.js test/e2e/025.agent-skill-manager.spec.js test/unit-ci/agent-takeover-performance.spec.js test/unit-ci/agent-output-stress.spec.js
git commit -m "test: cover ai takeover and user skill flows"
```

## Task 6: 扩展隔离服务器 Smoke 和帮助文档

**Files:**
- Modify: `apps/electerm-agent/build/bin/smoke-ai.js`
- Create: `apps/electerm-agent/build/bin/smoke-ai-takeover.js`
- Modify: `apps/electerm-agent/package.json`
- Modify: `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/real-server-smoke-script.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/help-center.spec.js`

- [ ] **Step 1: 写入 Smoke 安全协议失败测试**

Assert the real-server script refuses to run without an explicit isolation flag and explicit host fingerprint, limits writes to a caller-provided test directory, uses a dedicated test service for restart, requires an out-of-band recovery acknowledgement for SSH/network tests, and cleans up only its own namespaced artifacts.

- [ ] **Step 2: 写入帮助内容失败测试**

Require documentation for default-off per-session takeover, readonly versus risky behavior, confirmation contents, one-click stop, disconnect/restart revocation, zero default Skills, conversational/manual Skill creation, draft review, permissions-not-authorization, recovery and performance impact.

- [ ] **Step 3: 运行测试并确认失败**

```powershell
node --test test/unit-ci/real-server-smoke-script.spec.js test/unit-ci/help-center.spec.js
```

Expected: takeover smoke script and help sections are absent.

- [ ] **Step 4: 实现隔离 Smoke**

Add `smoke:ai-takeover` to package scripts. Exercise bounded readonly diagnostics, a write under the dedicated test directory, verified backup/change/rollback, cancellation and disconnect. Never use production paths, root filesystem deletion, the only management channel or an unverified fingerprint.

- [ ] **Step 5: 实现面向用户的帮助内容**

Explain what happens rather than promising unrestricted autonomy. Include resource impact: cloud model inference does not run on the SSH server; idle takeover has no extra remote work; actual commands, recovery points and verification can consume server CPU/memory/disk/network and are disclosed in the risk modal.

- [ ] **Step 6: 运行测试并提交**

```powershell
node --test test/unit-ci/real-server-smoke-script.spec.js test/unit-ci/help-center.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
git add build/bin/smoke-ai.js build/bin/smoke-ai-takeover.js package.json src/client/components/main/help-center-modal.jsx src/client/common/shellpilot-i18n-overrides.js test/unit-ci/real-server-smoke-script.spec.js test/unit-ci/help-center.spec.js
git commit -m "docs: add takeover smoke and user guidance"
```

## Task 7: 最终发布验证

**Files:**
- Verify: all feature files and tests
- Modify if required by release notes: `apps/electerm-agent/CHANGELOG.md`

- [ ] **Step 1: 使用完成前验证技能并运行全量检查**

Use `superpowers:verification-before-completion`, then run fresh commands:

```powershell
npm run lint
npm run test-unit-ci
npm run smoke:ai
npm run smoke:safety
npm run test3
npm run compile
```

Expected: every command exits 0; no failed or skipped feature-critical test is hidden.

- [ ] **Step 2: 在隔离服务器运行真实 Smoke**

```powershell
if (-not $env:SHELLPILOT_AI_TAKEOVER_SMOKE_CONFIG) { throw 'Set SHELLPILOT_AI_TAKEOVER_SMOKE_CONFIG to the approved isolated-server config path.' }
npm run smoke:ai-takeover -- --isolated --config $env:SHELLPILOT_AI_TAKEOVER_SMOKE_CONFIG
```

Expected: fingerprint validation, bounded reads, dedicated-path write, verification, rollback, cancellation and disconnect scenarios pass. The config path is supplied by the authorized tester and is never committed.

- [ ] **Step 3: 验证 Windows 交付物**

Run the project's normal Windows packaging flow, then:

```powershell
npm run test-package-smoke
$portableZip = Get-ChildItem dist -File -Filter '*portable*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $portableZip) { throw 'No portable zip was produced under dist.' }
npm run verify-win-portable -- $portableZip.FullName
```

Expected: packaged app starts, Skill root resolves under packaged app data, clean install has zero Skills, takeover defaults off and no development-only path is required. Artifact paths are supplied from the current build and are not committed.

- [ ] **Step 4: 最终安全审查**

Search the diff for credentials, generic fs IPC, direct Skill process execution, takeover persistence and bypass tool paths:

```powershell
git diff --check master...HEAD
git diff --name-only master...HEAD
rg -n "password|private key|Bearer |api[_-]?key|takeoverGrants|unzipFile|child_process" src test build
```

Expected: matches are either existing safe infrastructure, redaction tests or explicitly reviewed controlled runners; no secret fixture value or generic renderer-controlled path is shipped.

- [ ] **Step 5: 准备评审，不自动合并**

Use `superpowers:requesting-code-review`. Present the four phase commits, verification output, real-server evidence, performance comparison and known boundaries. Merge or publish only after explicit repository-owner approval.
