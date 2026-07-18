# ShellPilot AI Takeover and User Skills Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变客户端三段式主布局的前提下，交付每个 SSH 会话独立开启的 AI 接管模式、受控 Agent 执行闭环，以及默认空白、由用户创建的本地 Skill 体系。

**Architecture:** 以现有安全事务域作为唯一写操作底座，在其前方增加会话接管门禁和统一工具网关；复用 ShellPilot v0.4.3 的 Agent 取消、会话上下文、限长输出和任务注册能力。Skill 只提供本地工作流资料与受约束脚本，不能成为权限来源；所有阶段按依赖顺序交付，每一阶段都可独立测试、回滚和评审。

**Tech Stack:** Electron 41、React 19、Manate、Ant Design 6、Node.js test runner、Playwright、现有 SSH/SFTP 与 safety-transactions 模块。

---

## 交付物索引

1. [阶段 01：每会话接管门禁](./2026-07-15-shellpilot-ai-takeover-01-session-gate.md)
2. [阶段 02：受控 Agent 运行时与风险事务](./2026-07-15-shellpilot-ai-takeover-02-controlled-runtime.md)
3. [阶段 03：本地用户 Skill 运行时](./2026-07-15-shellpilot-ai-takeover-03-user-skill-runtime.md)
4. [阶段 04：对话创建 Skill 与发布验收](./2026-07-15-shellpilot-ai-takeover-04-skill-creator-release.md)

设计基线为 [ShellPilot AI 接管模式与用户自建 Skill 设计](../specs/2026-07-15-shellpilot-ai-takeover-and-user-skills-design.md)。发生实现争议时，以设计基线中的安全边界和验收标准为准；若实现需要改变边界，先修改并重新评审设计文档。

## 阶段依赖

```text
codex/fleet-operations-release 合入主线
  -> 阶段 01：会话身份、开关、门禁、生命周期
  -> 阶段 02：工具策略、风险事务、取消、输出背压
  -> 阶段 03：Skill 仓库、导入、编辑、匹配、运行约束
  -> 阶段 04：对话生成草稿、完整 UI/E2E/Smoke/发布门禁
```

阶段 02 直接使用主线已有的 `file-range.js`、归档读取和长日志测试。`git cherry master codex/long-log-archive-reader` 已证明旧分支的三个补丁等价进入主线，不再重复合并或复制实现。

## Task 1: 合入并核对 ShellPilot v0.4.3 基线

**Files:**
- Inspect: `apps/electerm-agent/src/client/components/main/main.jsx`
- Inspect: `apps/electerm-agent/src/client/components/side-panel-r/side-panel-r.jsx`
- Inspect: `apps/electerm-agent/src/app/server/session-process.js`
- Inspect: `apps/electerm-agent/src/app/server/dispatch-center.js`

- [ ] **Step 1: 确认最终 Fleet release 工作树干净并对应远程分支**

Run from repository root:

```powershell
git worktree list --porcelain
git -C 'F:/SSH工具开发/.worktrees/fleet-operations-resume' status --short
git branch -vv --list codex/fleet-operations-release
```

Expected: 工作树状态为空；分支跟踪 `origin/codex/fleet-operations-release`。旧的 `codex/fleet-operations` 工作树不是交付基线，其未提交内容不得合入。

- [ ] **Step 2: 确认 Fleet 提交已进入目标基线**

```powershell
git merge --no-ff codex/fleet-operations-release
git merge-base --is-ancestor codex/fleet-operations-release master
if ($LASTEXITCODE -ne 0) { throw 'Fleet release is not in master' }
```

Expected: merge succeeds without textual conflicts；ancestor check exit code 0。

- [ ] **Step 3: 确认长日志读取依赖状态**

```powershell
$pending = git cherry master codex/long-log-archive-reader | Where-Object { $_ -like '+ *' }
if ($pending) { throw "Long-log patches missing from master: $pending" }
node --test apps/electerm-agent/test/unit-ci/file-range.spec.js apps/electerm-agent/test/unit-ci/archive-reader.spec.js
```

Expected: no `+` patch remains；file-range and archive-reader tests pass。

## Task 2: 创建隔离工作树并建立基线

**Files:**
- Create worktree only: `.worktrees/ai-takeover-user-skills`

- [ ] **Step 1: 按 worktree 技能创建隔离分支**

Use `superpowers:using-git-worktrees`, then run from repository root:

```powershell
git worktree add .worktrees/ai-takeover-user-skills -b codex/ai-takeover-user-skills master
```

Expected: 新工作树位于仓库内已忽略的 `.worktrees/`，当前主工作树不切分支。

- [ ] **Step 2: 验证隔离**

```powershell
git -C .worktrees/ai-takeover-user-skills branch --show-current
git -C .worktrees/ai-takeover-user-skills status --short
git status --short
```

Expected: 功能工作树分支为 `codex/ai-takeover-user-skills` 且干净；主工作树原有的 `?? .superpowers/` 和 `?? release-verification/` 保持不变，不得暂存。

- [ ] **Step 3: 安装依赖并运行产品基线**

```powershell
Set-Location .worktrees/ai-takeover-user-skills/apps/electerm-agent
npm ci
npm run test-unit-ci
npm run lint
```

Expected: all unit tests pass；lint exit code 0。若基线失败，保存完整命令和失败用例，在修改产品代码前解决基线归属。

- [ ] **Step 4: 记录基线提交**

```powershell
git rev-parse HEAD
git status --short
```

Expected: 记录的 HEAD 与创建工作树时的 master 一致，状态为空。

## Task 3: 按阶段实施并设置评审门

**Files:**
- Follow: `docs/superpowers/plans/2026-07-15-shellpilot-ai-takeover-01-session-gate.md`
- Follow: `docs/superpowers/plans/2026-07-15-shellpilot-ai-takeover-02-controlled-runtime.md`
- Follow: `docs/superpowers/plans/2026-07-15-shellpilot-ai-takeover-03-user-skill-runtime.md`
- Follow: `docs/superpowers/plans/2026-07-15-shellpilot-ai-takeover-04-skill-creator-release.md`

- [x] **Step 1: 完成阶段 01 并评审门禁边界**

Exit criteria: 接管默认关闭；不同 SSH 会话授权隔离；身份改变立即失效；接管关闭时所有有远程副作用的 Agent 工具被统一拒绝；相对既有 `aiHealthCoordinator` 基线，空闲接管不新增模型调用、SSH 命令或轮询。

- [ ] **Step 2: 完成阶段 02 并评审风险事务边界**

Exit criteria: 只读允许列表可自动执行；其余操作只能阻止或进入冻结事务；确认绑定 SHA-256；取消信号贯穿调用栈；写操作不自动重试；大输出有分页、背压和脱敏。

- [ ] **Step 3: 完成阶段 03 并评审 Skill 信任边界**

Exit criteria: 干净安装 Skill 列表为空；导入内容先进入禁用草稿；路径穿越、外部符号链接和压缩包逃逸被拒绝；Skill 声明不能降低风险等级或绕过门禁。

- [ ] **Step 4: 完成阶段 04 并执行发布门**

Exit criteria: 对话只生成禁用草稿，不执行草稿脚本；用户审查后才能保存并启用；全量单测、E2E、真实隔离服务器 Smoke、Windows 打包和性能回归均有证据。

## Task 4: 跨阶段最终验证

**Files:**
- Verify: `apps/electerm-agent/test/unit-ci/*.spec.js`
- Verify: `apps/electerm-agent/test/e2e/02*.js`
- Verify: `apps/electerm-agent/package.json`

- [ ] **Step 1: 使用完成前验证技能**

Before any completion claim, use `superpowers:verification-before-completion` and run fresh commands from `apps/electerm-agent`.

- [ ] **Step 2: 运行静态与单元验证**

```powershell
npm run lint
npm run test-unit-ci
```

Expected: exit code 0 and no failed tests.

- [ ] **Step 3: 运行 AI、安全和 E2E 验证**

```powershell
npm run smoke:ai
npm run smoke:safety
npm run test3
```

Expected: all smoke assertions and Playwright tests pass.

- [ ] **Step 4: 运行编译验证**

```powershell
npm run compile
```

Expected: build completes successfully and produces the normal application artifacts.

- [ ] **Step 5: 核对提交范围**

```powershell
git status --short
git diff --check master...HEAD
git diff --name-only master...HEAD
```

Expected: no whitespace errors；变更仅包含四个阶段明确列出的代码、测试和文档；不包含 `.superpowers/`、凭据、测试服务器地址或本地用户数据。

## 设计覆盖矩阵

| 设计要求 | 实施位置 | 主要证据 |
| --- | --- | --- |
| 每 SSH 会话独立开关、默认关闭、身份变化撤权 | 阶段 01 Tasks 1–5 | endpoint/state/registry/lifecycle 单测与双标签手工验收 |
| 接管关闭时统一拒绝远程工具 | 阶段 01 Task 3 | 全工具描述符表驱动测试 |
| 自动只读、资源敏感只读需确认 | 阶段 02 Tasks 1–2 | policy/structured-tools 单测 |
| 风险操作合并确认、内容冻结、SHA-256 绑定 | 阶段 02 Tasks 3–4 | plan-grant/transaction/modal 单测 |
| 恢复、目标验证、取消、写操作不重放 | 阶段 02 Tasks 5–6 | risk-execution/cancellation 单测与 safety smoke |
| 不可信输出、脱敏、分页、背压 | 阶段 02 Task 6；阶段 04 Tasks 4–5 | observation/output/retention/stress 测试 |
| 默认零业务 Skill、用户本地包 | 阶段 03 Tasks 1–4 | clean-install/repository/import/IPC 测试 |
| Skill 渐进加载且声明不是授权 | 阶段 03 Tasks 5–6 | selection/execution/policy 测试 |
| 手动导入、编辑、启停、回退 | 阶段 03 Tasks 4、7 | manager UI 与 repository 测试 |
| 对话创建后先审查草稿再启用 | 阶段 04 Tasks 1–3 | creator/controller/review UI 测试 |
| 不改变三段式布局 | 阶段 01 Task 4；阶段 03 Task 7；阶段 04 Task 3 | layout/responsive/E2E 测试 |
| 空闲零额外远程负载、不收紧正常任务预算 | 阶段 01 Task 5；阶段 04 Task 5 | fake-time idle 与 stress 性能测试 |
| 真实隔离服务器和 Windows 发布门 | 阶段 04 Tasks 6–7 | real smoke、package smoke、portable verify |
