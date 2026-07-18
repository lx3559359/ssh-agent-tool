# ShellPilot Quality, Observability and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ShellPilot 增加统一操作链路编号、低开销性能指标、保守的崩溃恢复，以及 SSH、SFTP、AI、更新和回滚的双层端到端自动测试，并在完整自检后发布 0.4.4 更新。

**Architecture:** 复用现有 `electron-log`、IPC、`safetyOperations`、`agentTasks`、标签 Store 和 Playwright 隔离配置能力。新增的质量模块只监听生命周期事件，不进入终端字符流和 SFTP 数据流热路径；恢复快照只保存非敏感状态，异常重启后恢复标签外壳并提示中断任务，不自动执行任何远程操作。

**Tech Stack:** Electron、React、MobX、Node.js、Playwright Electron、`node:test`、`electron-log`、现有 SQLite/NeDB 数据层、GitHub Release、ModelScope 更新源。

---

## 文件结构

### 新增文件

- `src/app/lib/quality/trace-context.js`：主进程链路编号生成、规范化和日志字段提取。
- `src/app/lib/quality/quality-log.js`：主进程结构化链路日志入口，统一脱敏和失败降级。
- `src/app/lib/quality/performance-metrics.js`：启动、AI、终端与内存指标的有界记录器。
- `src/app/lib/quality/recovery-snapshot.js`：恢复快照校验、原子写入、正常退出标记和损坏隔离。
- `src/client/common/quality/trace-context.js`：渲染进程链路上下文生成和子上下文合并。
- `src/client/common/quality/quality-events.js`：渲染进程发送链路事件和性能事件的稳定 API。
- `src/client/common/recovery/client-recovery-state.js`：标签快照序列化、敏感字段剔除和恢复计划生成。
- `src/client/components/main/crash-recovery-notice.jsx`：异常恢复后的中文汇总提示与安全入口。
- `src/client/components/main/crash-recovery-notice.styl`：恢复提示的现有主题样式。
- `test/unit-ci/quality-trace-context.spec.js`：链路编号、传播和脱敏测试。
- `test/unit-ci/performance-metrics.spec.js`：指标定义、限额、采样和基线测试。
- `test/unit-ci/recovery-snapshot.spec.js`：快照安全、原子写入、损坏和退出状态测试。
- `test/unit-ci/client-recovery-state.spec.js`：标签最小快照和恢复计划测试。
- `test/e2e/common/local-sftp-fixture.js`：本地 SSH/SFTP 临时根目录与测试文件工具。
- `test/e2e/common/quality-e2e-app.js`：隔离配置、强制结束、重启和产物清理工具。
- `test/e2e/027.quality-core-flows.spec.js`：本地 SSH、SFTP、AI、更新和回滚主流程。
- `test/e2e/028.crash-recovery.spec.js`：异常结束、标签恢复和未完成任务提示。
- `test/e2e/029.performance-baseline.spec.js`：启动、首终端、AI 首字和内存指标验证。
- `test/e2e/030.real-server-regression.spec.js`：环境变量驱动的真实服务器回归。

### 修改文件

- `src/app/common/log.js`：安装结构化字段格式并保持现有脱敏。
- `src/app/lib/create-app.js`：记录主进程启动、初始化恢复快照和退出生命周期。
- `src/app/lib/create-window.js`：记录窗口完成加载和渲染进程异常状态。
- `src/app/lib/process-error-logging.js`：在崩溃日志中加入链路编号并标记恢复原因。
- `src/app/lib/ipc.js`：注册质量事件、指标和恢复快照 IPC。
- `src/app/lib/ai.js`：记录 AI 请求开始、首字、完成、取消和失败。
- `src/app/lib/native-updater.js`：记录检查、下载、安装和源回退链路。
- `src/app/lib/on-close.js`：正常退出前完成 `cleanExit` 标记。
- `src/client/store/load-data.js`：读取恢复计划、记录主界面可交互时间并触发恢复提示。
- `src/client/store/tab.js`：在标签变更后防抖保存最小恢复快照。
- `src/client/components/terminal/terminal.jsx`：首次终端成功并可聚焦时记录一次 `first_terminal_ready_ms`。
- `src/client/components/ai/ai-chat-history-item.jsx`：为聊天请求创建链路并记录首字结果。
- `src/client/components/ai/agent.js`：为 Agent 工具调用传播链路编号。
- `src/client/components/main/main.jsx`：挂载恢复提示并提供安全中心/更新中心入口。
- `src/client/common/safety-transactions/transaction-store.js`：把 `traceId` 保存在事务和任务 metadata 中。
- `src/client/common/safety-transactions/command-entrypoint.js`：命令事务沿用调用方链路编号。
- `src/client/components/file-transfer/file-transfer-safety.js`：SFTP 传输和回滚沿用链路编号。
- `src/client/components/main/upgrade.jsx`：更新检查、下载和安装使用同一个链路编号。
- `test/e2e/common/local-ssh-server.js`：增加 SFTP 子系统、文件哈希和可控断线能力。
- `test/e2e/common/ai-api.js`：增加流式首字延迟、超时、取消和失败场景。
- `package.json`：增加质量 E2E、真实服务器 E2E 和性能基线脚本，发布时升级到 0.4.4。

---

### Task 1: 统一链路上下文与结构化日志

**Files:**
- Create: `src/app/lib/quality/trace-context.js`
- Create: `src/app/lib/quality/quality-log.js`
- Create: `src/client/common/quality/trace-context.js`
- Create: `src/client/common/quality/quality-events.js`
- Modify: `src/app/common/log.js`
- Modify: `src/app/lib/ipc.js`
- Test: `test/unit-ci/quality-trace-context.spec.js`

- [ ] **Step 1: 编写链路编号失败测试**

测试必须断言：新编号符合 `sp-<13 位时间戳>-<8 位小写十六进制>`；子上下文保留 `traceId`；非法外部字段被丢弃；序列化结果不包含 `password`、`apiKey`、`Authorization`、用户目录和终端正文。

```js
const context = createTraceContext({ module: 'ssh', action: 'connect' }, {
  now: () => 1784304000000,
  randomBytes: () => Buffer.from('12345678', 'hex')
})
assert.equal(context.traceId, 'sp-1784304000000-12345678')
assert.equal(childTraceContext(context, { requestId: 'req-1' }).traceId, context.traceId)
assert.doesNotMatch(JSON.stringify(toLogFields({ ...context, password: 'secret' })), /secret|password/i)
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node --test test/unit-ci/quality-trace-context.spec.js`
Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现最小链路 API**

主进程和渲染进程均暴露以下稳定接口，渲染端使用浏览器 `crypto.getRandomValues`，主进程使用 `crypto.randomBytes`：

```js
createTraceContext(seed = {}, adapters = {})
childTraceContext(parent, patch = {})
normalizeTraceContext(value = {})
toLogFields(context = {})
```

`quality-events.js` 提供：

```js
export function recordQualityEvent (context, event) {
  return window.pre.runGlobalAsync('recordQualityEvent', normalizeTraceContext(context), event)
}
```

`quality-log.js` 只允许固定事件字段，调用现有 `electron-log`；写入失败时回退到脱敏文本日志，且不得抛回业务调用方。

- [ ] **Step 4: 在 IPC 注册质量日志入口**

`recordQualityEvent(context, event)` 校验 `module`、`action`、`phase`、`result`、`durationMs`，不接受任意嵌套对象和用户正文。

- [ ] **Step 5: 运行链路测试与日志脱敏测试**

Run: `node --test test/unit-ci/quality-trace-context.spec.js test/unit-ci/log-redaction.spec.js`
Expected: PASS，0 failures。

### Task 2: 在 SSH、SFTP、Agent、更新和回滚入口传播链路编号

**Files:**
- Modify: `src/client/common/safety-transactions/transaction-store.js`
- Modify: `src/client/common/safety-transactions/command-entrypoint.js`
- Modify: `src/client/components/file-transfer/file-transfer-safety.js`
- Modify: `src/client/components/ai/agent.js`
- Modify: `src/client/components/ai/ai-chat-history-item.jsx`
- Modify: `src/client/components/main/upgrade.jsx`
- Modify: `src/app/lib/ai.js`
- Modify: `src/app/lib/native-updater.js`
- Test: `test/unit-ci/quality-trace-context.spec.js`
- Test: `test/unit-ci/safety-transaction-store.spec.js`

- [ ] **Step 1: 添加跨模块传播失败测试**

测试构造一个父链路，分别创建命令事务、SFTP 事务、Agent 请求和更新请求，断言所有记录拥有同一 `traceId`，但 `operationId`、`taskId` 和 `requestId` 保持各自编号。

```js
assert.equal(savedOperation.metadata.traceId, trace.traceId)
assert.equal(savedTask.metadata.traceId, trace.traceId)
assert.notEqual(savedOperation.id, savedTask.id)
```

- [ ] **Step 2: 运行目标测试并确认缺少 `traceId` 而失败**

Run: `node --test test/unit-ci/quality-trace-context.spec.js test/unit-ci/safety-transaction-store.spec.js`
Expected: FAIL，断言显示 metadata 中没有 `traceId`。

- [ ] **Step 3: 接入五类业务入口**

每个用户动作只创建一次父链路。事务存储只保存 `metadata.traceId`，不得把整个上下文写入数据库。AI 和更新 IPC 在现有参数末尾增加可选上下文，旧调用不传时仍正常工作。

- [ ] **Step 4: 增加失败、取消和完成事件**

每类操作至少记录 `started` 和一个终态：`completed`、`failed`、`cancelled` 或 `interrupted`。终端字符收发、SFTP 文件块和 AI 每个 token 不逐条写日志。

- [ ] **Step 5: 运行安全事务和 AI/更新目标测试**

Run: `node --test test/unit-ci/quality-trace-context.spec.js test/unit-ci/safety-transaction-store.spec.js test/unit-ci/ai-conversation-backend.spec.js test/unit-ci/native-updater.spec.js`
Expected: PASS，0 failures。

### Task 3: 性能指标记录与本地基线

**Files:**
- Create: `src/app/lib/quality/performance-metrics.js`
- Modify: `src/app/lib/create-app.js`
- Modify: `src/app/lib/create-window.js`
- Modify: `src/app/lib/ipc.js`
- Modify: `src/client/store/load-data.js`
- Modify: `src/client/components/terminal/terminal.jsx`
- Modify: `src/client/components/ai/ai-chat-history-item.jsx`
- Test: `test/unit-ci/performance-metrics.spec.js`

- [ ] **Step 1: 编写指标记录器失败测试**

覆盖一次性启动指标、AI 首字只记录一次、60 秒内存采样间隔、1000 条/30 天清理、非法和敏感维度拒绝、基线相对变化计算。

```js
metrics.mark('app_start', 1000)
metrics.mark('first_window_interactive', 1450)
assert.equal(metrics.duration('app_start', 'first_window_interactive'), 450)
assert.equal(metrics.recordFirst('ai_first_token_ms', 320), true)
assert.equal(metrics.recordFirst('ai_first_token_ms', 410), false)
```

- [ ] **Step 2: 运行测试并确认模块缺失失败**

Run: `node --test test/unit-ci/performance-metrics.spec.js`
Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 或 `MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现有界指标记录器**

公开接口固定为：

```js
createPerformanceMetrics(options)
mark(name, at, dimensions)
recordDuration(name, durationMs, dimensions)
recordMemory(snapshot)
getSummary()
flush()
```

持久化采用 JSONL 或现有 data 表中的有界数组；写入失败只停用本次落盘并记录一次警告。

- [ ] **Step 4: 接入四类打点**

主进程启动时记录起点；窗口 `did-finish-load` 记录窗口完成；`store.configLoaded` 后记录可交互；终端首次 `statusMap.success` 且 `term.focus()` 可用时记录首终端；AI 流首次非空文本记录首字；AI 终态记录总耗时。内存只在启动稳定后及最多每 60 秒采集。

- [ ] **Step 5: 运行性能单测**

Run: `node --test test/unit-ci/performance-metrics.spec.js test/unit-ci/shellpilot-client-ux-performance.spec.js`
Expected: PASS，0 failures。

### Task 4: 崩溃快照与保守恢复模型

**Files:**
- Create: `src/app/lib/quality/recovery-snapshot.js`
- Create: `src/client/common/recovery/client-recovery-state.js`
- Modify: `src/app/lib/create-app.js`
- Modify: `src/app/lib/on-close.js`
- Modify: `src/app/lib/process-error-logging.js`
- Modify: `src/app/lib/ipc.js`
- Modify: `src/client/store/tab.js`
- Modify: `src/client/store/load-data.js`
- Test: `test/unit-ci/recovery-snapshot.spec.js`
- Test: `test/unit-ci/client-recovery-state.spec.js`

- [ ] **Step 1: 编写安全快照失败测试**

测试必须覆盖：只保留标签类型、书签 ID、标题、布局和非敏感主机字段；删除密码、私钥、口令、终端缓冲、命令和附件；临时文件原子替换；损坏 JSON 隔离；正常退出不恢复；异常退出生成“待重连”计划。

```js
const snapshot = serializeRecoveryState(store)
assert.equal(snapshot.tabs[0].connectionState, 'disconnected')
assert.doesNotMatch(JSON.stringify(snapshot), /password|privateKey|apiKey|terminalOutput/i)
```

- [ ] **Step 2: 运行测试并确认模块缺失失败**

Run: `node --test test/unit-ci/recovery-snapshot.spec.js test/unit-ci/client-recovery-state.spec.js`
Expected: FAIL，错误包含模块不存在。

- [ ] **Step 3: 实现主进程快照管理器**

使用 `snapshot.json.tmp` 写完、`fsync`、再替换 `snapshot.json`。启动读取上次 `cleanExit` 后立即写入本次 `cleanExit: false`；正常退出通过 IPC 获取最新渲染快照后写入 `cleanExit: true`。损坏文件改名为 `.corrupt-<timestamp>`，返回空恢复计划。

- [ ] **Step 4: 实现渲染进程最小快照**

标签变化后 500ms 防抖调用 `saveRecoverySnapshot`。`pendingTasks` 只保存任务/事务编号、类型、状态、时间和脱敏标题；不保存可执行命令和远程输出。

- [ ] **Step 5: 接入现有孤儿任务恢复**

启动时先运行现有 `recoverOrphanedCommandOperations` 与 `recoverOrphanedAgentTasks`，再把结果合并成提示摘要。任何恢复异常都不能阻断 `store.confirmLoad()`。

- [ ] **Step 6: 运行恢复单测和现有任务恢复测试**

Run: `node --test test/unit-ci/recovery-snapshot.spec.js test/unit-ci/client-recovery-state.spec.js test/unit-ci/background-command-registry.spec.js test/unit-ci/agent-task-runner.spec.js`
Expected: PASS，0 failures。

### Task 5: 恢复提示与安全入口

**Files:**
- Create: `src/client/components/main/crash-recovery-notice.jsx`
- Create: `src/client/components/main/crash-recovery-notice.styl`
- Modify: `src/client/components/main/main.jsx`
- Modify: `src/client/store/load-data.js`
- Test: `test/unit-ci/crash-recovery-ui.spec.js`

- [ ] **Step 1: 编写恢复 UI 契约失败测试**

测试源代码和模型函数必须包含“上次运行异常结束”“恢复标签”“待重连”“查看安全中心”“查看更新中心”“忽略”，并明确断言不存在自动调用 `ipcOpenTab` 连接、发送命令、安装更新或执行回滚的代码路径。

- [ ] **Step 2: 运行测试并确认组件不存在失败**

Run: `node --test test/unit-ci/crash-recovery-ui.spec.js`
Expected: FAIL，组件文件不存在。

- [ ] **Step 3: 实现轻量中文恢复提示**

复用现有通知/弹窗和主题变量。提示显示恢复标签数量、SSH/SFTP 待重连数量、AI/安全事务/更新中断数量；按钮只导航或关闭提示，不直接执行业务动作。

- [ ] **Step 4: 恢复标签外壳**

书签标签通过书签 ID 重建配置但强制 `status` 为未连接；临时连接恢复为新建表单并预填非敏感字段；本地终端只创建新的本地终端标签，不恢复旧进程和屏幕。

- [ ] **Step 5: 运行 UI 契约与响应式检查**

Run: `node --test test/unit-ci/crash-recovery-ui.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js`
Expected: PASS，0 failures。

### Task 6: 本地 SSH/SFTP/AI/更新/回滚 E2E

**Files:**
- Modify: `test/e2e/common/local-ssh-server.js`
- Modify: `test/e2e/common/ai-api.js`
- Create: `test/e2e/common/local-sftp-fixture.js`
- Create: `test/e2e/common/quality-e2e-app.js`
- Create: `test/e2e/027.quality-core-flows.spec.js`
- Modify: `package.json`
- Test: `test/unit-ci/quality-e2e-hygiene.spec.js`

- [ ] **Step 1: 编写 E2E 安全契约失败测试**

断言测试仅绑定 `127.0.0.1`、配置目录位于系统临时目录、测试文件位于唯一临时根目录、测试日志不打印密码、所有清理使用已验证绝对路径。

- [ ] **Step 2: 运行安全契约并确认缺少新测试失败**

Run: `node --test test/unit-ci/quality-e2e-hygiene.spec.js`
Expected: FAIL，新 E2E 文件或清理守卫不存在。

- [ ] **Step 3: 扩展本地 SSH/SFTP 服务**

支持密码认证、交互 Shell、`Ctrl+C`、SFTP `readdir/open/read/write/stat/rename/remove/mkdir/rmdir`，所有路径限制在临时根目录；增加服务器主动断开方法。

- [ ] **Step 4: 实现五类主流程**

单个隔离应用依次验证：SSH 连接与中断；SFTP 上传/下载/哈希/重命名；AI 流式首字与取消；更新无更新/有更新/源回退但不安装；临时文件修改、事务记录和快捷回滚。

- [ ] **Step 5: 校验链路日志**

每个流程从客户端读取诊断日志，断言同一操作的前端和后端事件共享一个 `traceId`，日志中没有本地测试密码、API Key 和测试文件正文。

- [ ] **Step 6: 运行本地质量 E2E**

Run: `npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1`
Expected: PASS，所有本地服务和隔离目录清理成功。

### Task 7: 崩溃恢复与性能 E2E

**Files:**
- Create: `test/e2e/028.crash-recovery.spec.js`
- Create: `test/e2e/029.performance-baseline.spec.js`
- Modify: `test/e2e/common/quality-e2e-app.js`
- Modify: `package.json`

- [ ] **Step 1: 编写崩溃恢复 E2E**

使用同一个隔离用户目录启动客户端，创建本地标签、一个未连接 SSH 标签和一个执行中任务摘要，强制结束 Electron 进程，再次启动并断言出现恢复提示、标签为待重连、任务为中断，SSH 测试服务器没有新增认证和命令计数。

- [ ] **Step 2: 运行崩溃测试并确认恢复功能缺失时失败**

Run: `npx playwright test test/e2e/028.crash-recovery.spec.js --workers=1`
Expected: FAIL，恢复提示或恢复标签不存在。

- [ ] **Step 3: 修正恢复集成直到测试通过**

只允许修正快照、启动顺序和提示，不得通过测试专用开关自动跳过安全规则。

- [ ] **Step 4: 编写性能 E2E**

启动隔离应用并读取性能摘要，断言 `app_start_ms`、`first_window_interactive_ms`、`first_terminal_ready_ms`、`memory_main_mb`、`memory_renderer_mb` 为正数；调用本地 AI 流后断言 `ai_first_token_ms` 和 `ai_total_ms` 存在且首字不大于总耗时。

- [ ] **Step 5: 运行恢复与性能 E2E**

Run: `npx playwright test test/e2e/028.crash-recovery.spec.js test/e2e/029.performance-baseline.spec.js --workers=1`
Expected: PASS，0 failures。

### Task 8: 真实服务器发布前回归

**Files:**
- Create: `test/e2e/030.real-server-regression.spec.js`
- Modify: `package.json`
- Test: `test/unit-ci/real-server-e2e-hygiene.spec.js`

- [ ] **Step 1: 编写凭据与目录隔离失败测试**

断言真实服务器测试只读取 `SHELLPILOT_E2E_*` 环境变量；没有硬编码公网 IP、账号、密码和 API Key；远程路径必须以 `SHELLPILOT_E2E_REMOTE_ROOT` 加随机运行编号开头。

- [ ] **Step 2: 运行安全测试并确认新文件缺失失败**

Run: `node --test test/unit-ci/real-server-e2e-hygiene.spec.js`
Expected: FAIL，真实服务器测试尚不存在。

- [ ] **Step 3: 实现真实回归测试**

环境变量不全时明确 `skip`；齐全时执行只读 SSH 命令、`Ctrl+C`、测试目录内 SFTP 上传/下载/哈希/重命名、文件修改与回滚，并在 `finally` 清理随机测试目录。不得修改服务、防火墙、网络、用户或系统目录。

- [ ] **Step 4: 运行真实服务器回归**

Run: `npm run test-e2e-real`
Expected: 凭据存在时 PASS；未配置时显示明确 SKIP，不显示凭据。

### Task 9: 完整自检、版本 0.4.4 与发布

**Files:**
- Modify: `package.json`
- Modify: `build/web-app/package.json`
- Modify: `README_cn.md`
- Modify: `README.md`
- Create: `docs/releases/0.4.4.md`
- Update: 本轮所有测试和实现文件

- [ ] **Step 1: 对照设计逐项审查**

检查统一链路、日志脱敏、四类性能指标、内存指标、异常标签恢复、未完成任务提示、禁止自动执行、五类本地 E2E 和真实回归均有实现与测试。

- [ ] **Step 2: 运行完整单元测试**

Run: `npm run test-unit-ci`
Expected: 0 failures；记录通过、跳过和总数。

- [ ] **Step 3: 运行质量 E2E 和既有关键 E2E**

Run: `npx playwright test test/e2e/005.basic-ssh.spec.js test/e2e/006.ai-chat.spec.js test/e2e/009.3.upgrade.check.spec.js test/e2e/009.4.upgrade.check.spec.js test/e2e/027.quality-core-flows.spec.js test/e2e/028.crash-recovery.spec.js test/e2e/029.performance-baseline.spec.js --workers=1`
Expected: 0 failures。

- [ ] **Step 4: 运行真实服务器回归**

Run: `npm run test-e2e-real`
Expected: PASS；测试目录已清理，日志未出现凭据。

- [ ] **Step 5: 运行静态、构建和打包检查**

Run: `npm run lint && npm run compile && npm run test-package-smoke`
Expected: 所有命令退出码 0。

- [ ] **Step 6: 执行 Windows 视觉回归**

在 1366×768 与 1920×1080、100%/125%/150%、日间/夜间下检查恢复提示、主终端、AI 和安全中心；对比现有截图基线，确认没有文字裁切、遮挡和布局漂移。

- [ ] **Step 7: 升级版本并生成更新说明**

版本统一改为 `0.4.4`。更新说明必须包含：

```text
[新增]
- SSH、SFTP、AI、更新和回滚端到端自动测试
- 操作链路编号、性能指标和异常退出恢复

[修复]
- 异常退出后标签和未完成任务缺少恢复提示

[改动]
- 日志支持跨前端、SSH、Agent 和更新链路关联
- 发布前增加本地与真实服务器双层回归
```

- [ ] **Step 8: 检查差异和敏感信息**

Run: `git diff --check && rg -n "SHELLPILOT_E2E_SSH_PASSWORD=|g4jJ|sk-[A-Za-z0-9]{16,}|23\.94\.104\.203" src test build docs package.json`
Expected: `git diff --check` 无输出；敏感信息扫描无命中。

- [ ] **Step 9: 提交并推送发布提交**

只在全部验证通过后执行：

```powershell
git add --all
git commit -m "feat: add quality observability and crash recovery"
git push origin codex/fleet-operations-release
```

Expected: 提交和推送成功，工作树干净。

- [ ] **Step 10: 生成并验证发布资产**

Run: `npm run release:prepare-assets && npm run release:local:verify`
Expected: 安装包、blockmap、`latest.yml`、更新清单和校验值均为 0.4.4 且验证通过。

- [ ] **Step 11: 发布 GitHub 与 ModelScope 更新源**

Run: `npm run release:github && npm run release:modelscope && npm run release:update-sources:verify`
Expected: GitHub Release 与 ModelScope 资产一致，两个更新源在线验证通过。

- [ ] **Step 12: 客户端在线更新验收**

使用上一正式版本客户端分别选择 GitHub 和国内源检查更新，确认展示 `[新增]/[修复]/[改动]`，下载完成后由用户确认安装，平滑升级至 0.4.4；再次启动后版本号、标签恢复、SSH、SFTP、AI 和检查更新均正常。

---

## 计划自审清单

- [ ] 设计中的链路、指标、恢复、E2E、故障降级和安全边界均映射到具体任务。
- [ ] 没有把终端字符流、SFTP 文件块或 AI token 流变成高频日志。
- [ ] 没有任何自动重连、自动执行命令、自动安装或自动回滚路径。
- [ ] 本地和真实服务器测试均使用隔离目录和清理守卫。
- [ ] 真实凭据只从环境变量读取，测试和发布产物均执行敏感信息扫描。
- [ ] 发布动作位于完整自检之后，任何失败都会阻止版本发布。
