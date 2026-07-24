# 场景脚本中心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在运维工具中提供 10 个可取消、可记录、可交给 AI 分析的多步骤只读场景脚本。

**Architecture:** 为运维工具定义模型增加 `script` 类型，将场景脚本拆分为系统资源、应用服务、网络安全和兼容性四个目录模块。界面复用现有目录、参数表单和任务面板，执行继续走现有只读 SSH 任务运行器。

**Tech Stack:** React 19、Ant Design、现有 SSH 任务通道、Node test、Playwright。

---

### Task 1: 建立脚本安全契约

**Files:**
- Modify: `src/client/components/operations-toolkit/shared/definition.js`
- Create: `src/client/components/operations-toolkit/catalog/scripts/index.js`
- Test: `test/unit-ci/operations-toolkit-runbooks.spec.js`

- [ ] 先编写失败测试，要求脚本类型可被定义且所有内置脚本均为只读、多步骤、稳定 ID。
- [ ] 运行 `node --test test/unit-ci/operations-toolkit-runbooks.spec.js`，确认因脚本目录不存在而失败。
- [ ] 增加 `script` 类型并建立只聚合经过定义校验的脚本目录。
- [ ] 重跑测试并确认通过。

### Task 2: 实现首批场景脚本

**Files:**
- Create: `src/client/components/operations-toolkit/catalog/scripts/system-resources.js`
- Create: `src/client/components/operations-toolkit/catalog/scripts/application-services.js`
- Create: `src/client/components/operations-toolkit/catalog/scripts/network-security.js`
- Create: `src/client/components/operations-toolkit/catalog/scripts/compatibility.js`
- Modify: `src/client/components/operations-toolkit/catalog/index.js`
- Test: `test/unit-ci/operations-toolkit-runbooks.spec.js`

- [ ] 为 10 个脚本编写参数、步骤数量、命令安全转义和兼容性断言。
- [ ] 确认测试因脚本缺失而失败。
- [ ] 实现脚本，每个命令只读取状态；可选工具缺失时输出说明并以成功状态继续。
- [ ] 确认 10 个脚本及现有诊断目录测试通过。

### Task 3: 接入脚本中心界面

**Files:**
- Modify: `src/client/components/operations-toolkit/workspace/operations-workspace.jsx`
- Modify: `src/client/components/operations-toolkit/workspace/tool-catalog.jsx`
- Modify: `src/client/components/operations-toolkit/workspace/operations-workspace.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Test: `test/e2e/032.operations-toolkit.spec.js`

- [ ] 扩展 E2E，要求“脚本中心”显示 10 个脚本、只读提示和多步骤列表。
- [ ] 确认 E2E 因旧占位页而失败。
- [ ] 抽取可复用的脚本详情视图，并让诊断与脚本中心分别使用自己的目录和选择状态。
- [ ] 增加中文和英文文案、窄窗口布局。
- [ ] 重跑 E2E 并确认通过。

### Task 4: 回归任务执行和历史

**Files:**
- Test: `test/unit-ci/operations-toolkit-task-runner.spec.js`
- Test: `test/unit-ci/operations-toolkit-runbooks.spec.js`

- [ ] 验证多步骤脚本逐步执行、失败即停、取消、输出限制和历史持久化。
- [ ] 验证只读脚本不会进入安全维护目录，也不会要求二次确认。
- [ ] 运行相关任务、安全事务和运维工具测试。

### Task 5: 完整自检与本地交付

**Files:**
- Verify only; no release files.

- [ ] 运行 lint、完整单元测试和运维工具 E2E。
- [ ] 使用真实服务器执行只读脚本回归，不修改服务器配置。
- [ ] 运行核心 SSH、SFTP、AI、更新和回滚质量流。
- [ ] 构建 `dist/win-unpacked/ShellPilot.exe` 并执行包体启动冒烟。
- [ ] 仅提交本阶段文件，不发布在线更新。
