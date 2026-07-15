# ShellPilot AI Takeover Phase 03 User Skill Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用默认空白、用户拥有的本地 Skill 包替换现有内置业务 Skill，并提供安全的发现、校验、导入、编辑、启停、版本回退和渐进加载能力。

**Architecture:** Skill 文件系统只由 Electron 主进程中的受限仓库服务访问，渲染进程通过白名单 IPC 获取结构化结果。Skill 内容是工作流资料，不是权限；脚本、检查器和模板在使用前都纳入摘要与统一工具网关，仓库服务本身绝不执行脚本、访问 SSH Socket 或读取凭据。

**Tech Stack:** Electron IPC、Node.js fs/path/crypto、tar/yauzl、React/Ant Design、现有 Agent gateway、Node test runner。

---

## 数据布局和格式

Use `appPath` from `src/app/common/app-props.js` as the configured application data root:

```text
<appPath>/agent-skills/
  enabled/<skill-id>/
  disabled/<skill-id>/
  drafts/<draft-id>/
  history/<skill-id>/<version-digest>/
```

每个包必须有 `SKILL.md`；可选 `skill.json`、`scripts/`、`references/`、`templates/`、`checks/`、`tests/`。没有 `skill.json` 时只作为说明型 Skill，不允许自动运行脚本或检查器。

## Task 1: 移除内置业务 Skill，建立空安装语义

**Files:**
- Modify: `apps/electerm-agent/src/client/components/ai/agent-skills.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent.js`
- Modify: `apps/electerm-agent/test/unit-ci/agent-skills.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/agent-skill-settings.spec.js`

- [ ] **Step 1: 把现有测试改为要求默认空列表**

```js
test('clean install has no business skills', async () => {
  const { getAgentSkills, buildAgentSkillPrompt } = await import('../../src/client/components/ai/agent-skills.js')
  assert.deepEqual(getAgentSkills(), [])
  assert.equal(buildAgentSkillPrompt(), '')
})
```

Assert source contains none of the IDs `linux-health`, `nginx-troubleshooting`, `docker-troubleshooting`, `disk-cleanup`.

- [ ] **Step 2: 运行测试并确认失败**

```powershell
Set-Location apps/electerm-agent
node --test test/unit-ci/agent-skills.spec.js test/unit-ci/agent-skill-settings.spec.js
```

Expected: built-in skill assertions or default list fail.

- [ ] **Step 3: 移除业务内容并保留系统能力边界**

Delete built-in business definitions and stop reading `config.agentSkills` directly in `agent.js`. Keep Agent loop, tool gateway, safety policy, recovery and audit as system features; do not re-label them as Skills.

- [ ] **Step 4: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-skills.spec.js test/unit-ci/agent-skill-settings.spec.js test/unit-ci/ai-agent-tools.spec.js
git add src/client/components/ai/agent-skills.js src/client/components/ai/agent.js test/unit-ci/agent-skills.spec.js test/unit-ci/agent-skill-settings.spec.js
git commit -m "refactor: start agent skills from an empty catalog"
```

## Task 2: 实现受限路径、解析和校验层

**Files:**
- Create: `apps/electerm-agent/src/app/lib/agent-skill-path.js`
- Create: `apps/electerm-agent/src/app/lib/agent-skill-parser.js`
- Create: `apps/electerm-agent/src/app/lib/agent-skill-validator.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-path.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-parser.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-validator.spec.js`

- [ ] **Step 1: 写入路径穿越和符号链接失败测试**

Use a temporary `DATA_PATH` and create normal files plus `../escape`, absolute paths, Windows drive paths, UNC paths and directory symlinks. Assert only descendants of the selected Skill root are accepted.

```js
assert.throws(
  () => resolveSkillEntry(root, '../outside.txt'),
  error => error.code === 'SKILL_PATH_ESCAPE'
)
```

On systems where symlink creation is unavailable, skip only the symlink fixture and retain lexical plus realpath tests.

- [ ] **Step 2: 写入格式和权限声明失败测试**

Require `SKILL.md` with a controlled frontmatter subset containing `id`, `name`, `description`, `version`, `triggers` and optional `permissions`. If `skill.json` exists, require valid JSON and reject unknown executable entry types.

Use this valid fixture:

```md
---
id: inspect-web-service
name: Inspect Web Service
description: Collect bounded service evidence and verify a listening port.
version: 1.0.0
triggers:
  - web service health
permissions:
  - ssh.read
---

# Workflow

Read service status, recent logs, and the expected listening port.
```

Use this optional `skill.json` fixture to pin executable declarations without treating them as authorization:

```json
{
  "schemaVersion": 1,
  "id": "inspect-web-service",
  "version": "1.0.0",
  "implicitMatching": true,
  "requestedPermissions": ["ssh.read"],
  "tools": ["read_service_status", "read_recent_logs", "verify_listening_port"],
  "prechecks": [
    { "type": "tool", "name": "read_service_status" }
  ],
  "scripts": [
    { "id": "collect-evidence", "path": "scripts/collect-evidence.sh", "interpreter": "bash", "target": "remote" }
  ],
  "verification": [
    { "type": "tool", "name": "verify_listening_port" }
  ]
}
```

`id` and `version` must match `SKILL.md`. Allowed targets are `local` and `remote`; allowed entry types are fixed by the validator. Every referenced artifact must exist inside the package and be included in `fileDigests` and `packageDigest`.

- [ ] **Step 3: 写入脚本扫描失败测试**

Reject dynamic download-and-execute, `eval`, encoded command hiding, unresolved command substitution and references outside the package. Mark ordinary shell scripts as risky, never readonly. Assert requested permissions are returned as requirements, not granted capabilities.

- [ ] **Step 4: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-skill-path.spec.js test/unit-ci/agent-skill-parser.spec.js test/unit-ci/agent-skill-validator.spec.js
```

Expected: modules are absent.

- [ ] **Step 5: 实现最小受控 frontmatter 解析器**

Do not add a general YAML dependency. Parse only scalar strings and string lists used by the schema; reject anchors, aliases, tags, nested executable objects and duplicate keys. Normalize Skill IDs with `^[a-z0-9]+(?:-[a-z0-9]+)*$` and cap metadata/document/file sizes before reading into memory.

Return validation as:

```js
{
  valid: true,
  errors: [],
  warnings: [],
  manifest,
  fileDigests,
  packageDigest,
  riskSummary,
  requestedPermissions
}
```

- [ ] **Step 6: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-skill-path.spec.js test/unit-ci/agent-skill-parser.spec.js test/unit-ci/agent-skill-validator.spec.js
git add src/app/lib/agent-skill-path.js src/app/lib/agent-skill-parser.js src/app/lib/agent-skill-validator.js test/unit-ci/agent-skill-path.spec.js test/unit-ci/agent-skill-parser.spec.js test/unit-ci/agent-skill-validator.spec.js
git commit -m "feat: validate local agent skill packages"
```

## Task 3: 建立原子 Skill 仓库和版本历史

**Files:**
- Create: `apps/electerm-agent/src/app/lib/agent-skill-repository.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-repository.spec.js`

- [ ] **Step 1: 写入草稿、发布和回退失败测试**

Use isolated test directories and assert:

```js
const draft = await repository.createDraft(validFiles)
assert.equal(draft.enabled, false)
const release = await repository.enableDraft(draft.id, draft.packageDigest)
assert.equal(release.enabled, true)
await repository.updateFile(release.id, 'SKILL.md', changedMarkdown)
assert.equal((await repository.get(release.id)).enabled, false)
await repository.rollback(release.id, release.packageDigest)
assert.equal((await repository.get(release.id)).packageDigest, release.packageDigest)
```

Assert a digest mismatch refuses enable, failed rename preserves the previous valid version, and concurrent writes serialize per Skill ID.

- [ ] **Step 2: 写入数据最小化测试**

Assert catalog entries contain metadata and paths but not script/document contents. Assert delete does not erase history required by an active or recoverable safety transaction.

- [ ] **Step 3: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-skill-repository.spec.js
```

Expected: repository module is absent.

- [ ] **Step 4: 实现原子保存和历史快照**

Write into a same-volume temporary directory, validate and fsync required files, then rename atomically. Before replacing an enabled version, store the complete validated version under `history/<id>/<digest>`. Editing an enabled Skill creates a disabled draft and invalidates pending transaction grants that bind the old digest; it does not mutate the released files in place.

Expose only `list`, `getMetadata`, `readDocument`, `readFile`, `createDraft`, `updateDraftFile`, `validateDraft`, `enableDraft`, `disable`, `rollback` and `remove`. All methods accept IDs and package-relative paths, never arbitrary absolute paths.

- [ ] **Step 5: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-skill-repository.spec.js test/unit-ci/agent-skill-validator.spec.js
git add src/app/lib/agent-skill-repository.js test/unit-ci/agent-skill-repository.spec.js
git commit -m "feat: add atomic user skill repository"
```

## Task 4: 增加安全导入和白名单 IPC

**Files:**
- Create: `apps/electerm-agent/src/app/lib/agent-skill-import.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-client.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-import.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-ipc.spec.js`

- [ ] **Step 1: 写入压缩包逃逸失败测试**

Build fixtures containing `../`, absolute paths, duplicate normalized names, symlinks, excessive entry counts, excessive uncompressed bytes and high compression ratios. Assert import rejects the whole archive and creates no partial draft.

- [ ] **Step 2: 写入 IPC 表面失败测试**

Assert the async whitelist contains only dedicated calls:

```js
[
  'listAgentSkills',
  'getAgentSkillMetadata',
  'readAgentSkillFile',
  'createAgentSkillDraft',
  'updateAgentSkillDraftFile',
  'validateAgentSkillDraft',
  'enableAgentSkillDraft',
  'disableAgentSkill',
  'rollbackAgentSkill',
  'removeAgentSkill',
  'importAgentSkill'
]
```

Assert renderer arguments cannot substitute a repository root or read files outside a package.

- [ ] **Step 3: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-skill-import.spec.js test/unit-ci/agent-skill-ipc.spec.js
```

Expected: importer and IPC methods are absent.

- [ ] **Step 4: 实现流式、有上限的导入**

Support a selected folder, zip or tar archive. Inspect all archive entries before extraction, reject links and unsafe types, enforce entry/count/size/ratio limits while streaming, then extract into a temporary draft area and run the same validator. Every import result is disabled even when valid.

- [ ] **Step 5: 注册受限 IPC 服务**

Construct one repository in the main process with `path.resolve(appPath, 'agent-skills')`. `ipc.js` maps fixed method names to repository calls; do not expose generic fs, unzip, shell or path parameters. Return structured errors with safe messages and no host filesystem paths beyond the Skill-relative path.

- [ ] **Step 6: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-skill-import.spec.js test/unit-ci/agent-skill-ipc.spec.js test/unit-ci/user-data-path.spec.js
git add src/app/lib/agent-skill-import.js src/app/lib/ipc.js src/client/components/ai/agent-skill-client.js test/unit-ci/agent-skill-import.spec.js test/unit-ci/agent-skill-ipc.spec.js
git commit -m "feat: import user skills through confined ipc"
```

## Task 5: 实现渐进加载、显式选择和隐式匹配

**Files:**
- Modify: `apps/electerm-agent/src/client/components/ai/agent-skills.js`
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-selector.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-selection.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/agent-skills.spec.js`

- [ ] **Step 1: 写入渐进加载失败测试**

Spy on IPC and assert initial Agent context requests only enabled metadata. An unrelated user prompt must not read `SKILL.md`, scripts or references. `$inspect-web-service` must read only that Skill; explicit selection must suppress implicit mixing.

- [ ] **Step 2: 写入匹配和失败降级测试**

Assert implicit matching uses enabled metadata and configured triggers, can be disabled per Skill, and reports missing/invalid/disabled Skills. Continuing with the general Agent requires an explicit user choice after an explicitly requested Skill fails.

- [ ] **Step 3: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-skill-selection.spec.js test/unit-ci/agent-skills.spec.js
```

Expected: current implementation embeds all custom prompts or has no repository-backed selector.

- [ ] **Step 4: 实现两级加载**

At task start load `id`, `name`, `description`, `version`, `triggers`, `implicitMatching` and `packageDigest` for enabled Skills. After explicit selection or one deterministic metadata match, load full `SKILL.md`. Load referenced files, scripts and templates only when the workflow reaches them. Include selected Skill IDs, versions and digests in every risky plan grant.

- [ ] **Step 5: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-skill-selection.spec.js test/unit-ci/agent-skills.spec.js test/unit-ci/agent-plan-grant.spec.js
git add src/client/components/ai/agent-skills.js src/client/components/ai/agent-skill-selector.js src/client/components/ai/agent.js test/unit-ci/agent-skill-selection.spec.js test/unit-ci/agent-skills.spec.js
git commit -m "feat: progressively load selected user skills"
```

## Task 6: 约束 Skill 脚本和检查器执行

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-execution.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-tool-policy.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-tool-gateway.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-execution.spec.js`

- [ ] **Step 1: 写入禁止旁路失败测试**

Assert repository and Skill client have no execution method. Assert every script/check request becomes a gateway call containing package digest, file digest, interpreter, arguments, requested permissions and exact endpoint.

Assert a Skill cannot access credential IPC, raw SSH Socket, undeclared tools or arbitrary environment variables.

- [ ] **Step 2: 写入本地/远程执行分类测试**

Remote shell scripts are `risky` unless fully expanded to calls the system independently proves readonly. Local helper scripts also require policy evaluation; use `spawn` with `shell: false`, an allowlisted interpreter, sanitized environment, bounded cwd/output/timeout and no implicit network permission. If declared permissions cannot be enforced, execution is blocked with `SKILL_PERMISSION_UNENFORCEABLE`.

- [ ] **Step 3: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-skill-execution.spec.js test/unit-ci/agent-tool-policy.spec.js
```

Expected: no controlled Skill execution adapter exists.

- [ ] **Step 4: 实现只生成受控调用的适配器**

`prepareSkillArtifactCall` reads a validated artifact, rechecks its digest and returns a gateway call; it never invokes a process. The existing gateway chooses the permitted executor and applies takeover, endpoint, risk, confirmation, cancellation, output and audit rules. Any content change after validation invalidates the call and any waiting confirmation.

- [ ] **Step 5: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-skill-execution.spec.js test/unit-ci/agent-tool-policy.spec.js test/unit-ci/agent-tool-gateway.spec.js
git add src/client/components/ai/agent-skill-execution.js src/client/components/ai/agent-tool-policy.js src/client/components/ai/agent-tool-gateway.js test/unit-ci/agent-skill-execution.spec.js
git commit -m "feat: route skill artifacts through agent policy"
```

## Task 7: 增加 Skill 管理、导入和编辑界面

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-manager-modal.jsx`
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-editor.jsx`
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-manager.styl`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config-props.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-profiles.js`
- Modify: `apps/electerm-agent/src/app/lib/agent-skill-repository.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-manager-ui.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-skill-migration.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/agent-skill-settings.spec.js`

- [ ] **Step 1: 写入设置迁移和 UI 失败测试**

Assert `Form.List name='agentSkills'` is removed and replaced with `Skill 管理（数量）`. Assert clean state shows `还没有 Skill`, imports show `禁用草稿`, validation errors block enable, and editor shows a file tree plus full content/risk/permissions/validation panels.

- [ ] **Step 2: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-skill-manager-ui.spec.js test/unit-ci/agent-skill-migration.spec.js test/unit-ci/agent-skill-settings.spec.js
```

Expected: old inline Form.List remains and manager UI is absent.

- [ ] **Step 3: 实现局部 modal/drawer 流程**

Keep the three-column main layout unchanged. Provide list, import, edit, validate, enable, disable, rollback and remove actions in a modal or drawer. Destructive actions use existing confirmation patterns. Never enable immediately after import or save; the enable action is distinct and displays current digest plus validation results.

- [ ] **Step 4: 迁移旧 `config.agentSkills` 为禁用草稿**

On first repository initialization, convert each valid legacy item to one `SKILL.md` draft, mark migration complete only after atomic writes succeed, and remove no legacy config until all items are accounted for. Conflicting IDs receive a deterministic suffix and a migration warning. Never auto-enable migrated items.

- [ ] **Step 5: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-skill-manager-ui.spec.js test/unit-ci/agent-skill-migration.spec.js test/unit-ci/agent-skill-settings.spec.js test/unit-ci/agent-skill-repository.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
git add src/client/components/ai/agent-skill-manager-modal.jsx src/client/components/ai/agent-skill-editor.jsx src/client/components/ai/agent-skill-manager.styl src/client/components/ai/ai-config.jsx src/client/components/ai/ai-config-props.js src/client/components/ai/ai-profiles.js src/app/lib/agent-skill-repository.js src/app/lib/ipc.js src/client/common/shellpilot-i18n-overrides.js test/unit-ci/agent-skill-manager-ui.spec.js test/unit-ci/agent-skill-migration.spec.js test/unit-ci/agent-skill-settings.spec.js
git commit -m "feat: manage local user skills in ai settings"
```

## Task 8: 阶段 03 验收

**Files:**
- Verify only: all files changed in phase 03

- [ ] **Step 1: 运行安全和功能回归**

```powershell
npm run test-unit-ci
npm run lint
npm run smoke:safety
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: 使用隔离 DATA_PATH 手工验证**

Start with an empty test data directory. Verify zero Skills, import one valid and one malicious archive, edit the valid draft, validate it, explicitly enable it, select it with `$skill-id`, disable it and roll it back. Verify no script runs during import, edit or validation.

- [ ] **Step 3: 评审门**

Reviewers must confirm the renderer cannot choose a filesystem root, the repository cannot execute artifacts, every executable artifact passes the phase 02 gateway, and Skill permissions never reduce system risk classification.
