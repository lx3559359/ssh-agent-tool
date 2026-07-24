# ShellPilot 运维工具阶段一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有“快捷命令”升级为按需加载的“运维工具”工作区，交付独立 SSH exec 任务框架、自动能力识别、24 个只读诊断脚本、任务取消与历史，同时保持 SSH/SFTP/AI 核心行为不变。

**Architecture:** 保留现有快捷命令 ID、store、安全事务和终端实现。新增运维工具领域目录；脚本通过当前 SSH 会话的 `runCmd` 建立独立 SSH2 exec 通道，并通过受控远端任务目录轮询增量日志，实现不污染交互终端的后台执行。界面使用现有 `openQuickCommandBar` 兼容开关，旧快捷命令以嵌入模式出现在“快捷操作”，诊断脚本使用新目录和任务面板。

**Tech Stack:** Electron 41、React 19、Manate、Ant Design 6、Stylus、`@electerm/ssh2`、Node.js test runner、Playwright。

**Design reference:** `docs/superpowers/specs/2026-07-24-operations-toolkit-design.md`

---

## Scope Boundary

本计划只实施设计规格中的阶段一：

- 运维工具入口、五页签框架和只读工具目录。
- 当前服务器能力识别与兼容等级。
- SSH exec 后台任务、进度、增量输出、取消、超时和历史。
- 24 个只读诊断脚本。
- 旧快捷命令兼容映射。
- AI 结果交接、帮助和界面回归。

本计划不实施维护脚本的修改、备份和回滚逻辑，不发布在线更新。安全维护阶段另写独立计划。

## File Map

### New domain files

- `src/client/components/operations-toolkit/shared/definition.js`：工具定义、风险类型和目录校验。
- `src/client/components/operations-toolkit/shared/validation.js`：只读工具参数校验和安全 Shell 参数引用。
- `src/client/components/operations-toolkit/shared/capability-discovery.js`：能力探测命令和结果解析。
- `src/client/components/operations-toolkit/shared/compatibility.js`：发行版族和 A/B/C 兼容等级。
- `src/client/components/operations-toolkit/catalog/index.js`：目录聚合、唯一性检查和工具查询。
- `src/client/components/operations-toolkit/catalog/migrations.js`：旧快捷命令 ID 到新工具 ID 的兼容映射。
- `src/client/components/operations-toolkit/catalog/diagnostics/system-storage.js`：8 个系统和磁盘诊断。
- `src/client/components/operations-toolkit/catalog/diagnostics/network-security.js`：7 个网络和安全诊断。
- `src/client/components/operations-toolkit/catalog/diagnostics/udp-check.js`：UDP 综合检测。
- `src/client/components/operations-toolkit/catalog/diagnostics/services-platform.js`：8 个服务、日志、Web 和容器诊断。
- `src/client/components/operations-toolkit/runtime/task-model.js`：任务状态和状态迁移。
- `src/client/components/operations-toolkit/runtime/task-record-store.js`：有界、脱敏的本地任务历史。
- `src/client/components/operations-toolkit/runtime/output-buffer.js`：5000 行虚拟输出缓冲和截断标记。
- `src/client/components/operations-toolkit/runtime/remote-task-envelope.js`：远端任务目录、启动、增量读取、取消和清理命令。
- `src/client/components/operations-toolkit/runtime/ssh-task-channel.js`：`runCmd/cancelRunCmd` 适配和轮询。
- `src/client/components/operations-toolkit/runtime/task-runner.js`：能力发现、并发、步骤和终态收口。
- `src/client/components/operations-toolkit/workspace/operations-workspace.jsx`：工作区入口和页签。
- `src/client/components/operations-toolkit/workspace/tool-catalog.jsx`：搜索、分类和工具列表。
- `src/client/components/operations-toolkit/workspace/parameter-form.jsx`：定义驱动的参数表单。
- `src/client/components/operations-toolkit/workspace/task-panel.jsx`：步骤、状态和动作栏。
- `src/client/components/operations-toolkit/workspace/virtual-log.jsx`：长输出虚拟滚动。
- `src/client/components/operations-toolkit/workspace/result-viewer.jsx`：结构化结果和 AI 交接。
- `src/client/components/operations-toolkit/workspace/operations-workspace.styl`：响应式、日夜主题样式。
- `src/client/components/operations-toolkit/entry.jsx`：按需加载边界和模块错误恢复。
- `src/client/store/operations-toolkit.js`：工作区、任务和历史的 store 扩展。

### Existing files to modify

- `src/client/store/store.js`：注册 `operationsToolkitExtend`。
- `src/client/store/init-state.js`：加入运维工具最小 UI 状态。
- `src/client/components/main/aigshell-topbar.jsx`：显示“运维工具”，继续使用兼容开关。
- `src/client/components/layout/layout.jsx`：将底部快捷命令面板替换为懒加载运维工作区。
- `src/client/components/quick-commands/quick-commands-box.jsx`：增加 `embedded` 模式，不改变原执行逻辑。
- `src/client/components/quick-commands/qm.styl`：嵌入模式取消 fixed 定位。
- `src/client/common/shellpilot-i18n-overrides.js`：运维工具中文文案。
- `src/client/components/main/help-center-modal.jsx`：增加运维工具说明。

### New tests

- `test/unit-ci/helpers/import-esm.js`
- `test/unit-ci/operations-toolkit-definition.spec.js`
- `test/unit-ci/operations-toolkit-discovery.spec.js`
- `test/unit-ci/operations-toolkit-task-model.spec.js`
- `test/unit-ci/operations-toolkit-ssh-channel.spec.js`
- `test/unit-ci/operations-toolkit-runner.spec.js`
- `test/unit-ci/operations-toolkit-system-storage.spec.js`
- `test/unit-ci/operations-toolkit-network-security.spec.js`
- `test/unit-ci/operations-toolkit-udp.spec.js`
- `test/unit-ci/operations-toolkit-services-platform.spec.js`
- `test/unit-ci/operations-toolkit-migrations.spec.js`
- `test/e2e/032.operations-toolkit.spec.js`
- `test/e2e/033.operations-toolkit-runtime.spec.js`

---

### Task 1: 建立运维工具定义与目录校验

**Files:**
- Create: `test/unit-ci/helpers/import-esm.js`
- Create: `src/client/components/operations-toolkit/shared/definition.js`
- Create: `src/client/components/operations-toolkit/catalog/index.js`
- Test: `test/unit-ci/operations-toolkit-definition.spec.js`

- [ ] **Step 1: 写失败测试，固定工具定义公共契约**

先创建测试辅助文件：

```js
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function importModule (relativePath) {
  const root = path.resolve(__dirname, '../../..')
  return import(pathToFileURL(path.join(root, relativePath)).href)
}

module.exports = { importModule }
```

再创建定义测试：

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

test('readonly operations tool requires stable id and at least one step', async () => {
  const { defineOperationsTool } = await importModule(
    'src/client/components/operations-toolkit/shared/definition.js'
  )
  assert.throws(() => defineOperationsTool({
    id: 'bad id',
    title: '错误工具',
    type: 'diagnostic',
    risk: 'read-only',
    steps: []
  }), /工具标识无效/)
})

test('catalog rejects duplicate tool and legacy ids', async () => {
  const { buildOperationsCatalog } = await importModule(
    'src/client/components/operations-toolkit/catalog/index.js'
  )
  const tool = {
    id: 'system.overview',
    title: '系统运行概览',
    type: 'diagnostic',
    category: 'system',
    risk: 'read-only',
    steps: [{ id: 'collect', command: 'uptime', timeoutMs: 10000 }]
  }
  assert.throws(
    () => buildOperationsCatalog([[tool], [{ ...tool }]]),
    /运维工具 ID 重复/
  )
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-definition.spec.js`
Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现最小定义与目录聚合器**

```js
export const operationsToolTypes = Object.freeze({
  quick: 'quick',
  diagnostic: 'diagnostic',
  maintenance: 'maintenance'
})

export const operationsRiskTypes = Object.freeze({
  readonly: 'read-only',
  reversible: 'reversible-change',
  high: 'high-risk-change',
  blocked: 'non-recoverable'
})

const toolIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/

export function defineOperationsTool (input) {
  const tool = structuredClone(input)
  if (!toolIdPattern.test(tool.id || '')) throw new Error('运维工具标识无效')
  if (!tool.title || !tool.category) throw new Error('运维工具缺少名称或分类')
  if (!Object.values(operationsToolTypes).includes(tool.type)) {
    throw new Error('运维工具类型无效')
  }
  if (!Object.values(operationsRiskTypes).includes(tool.risk)) {
    throw new Error('运维工具风险类型无效')
  }
  if (!Array.isArray(tool.steps) || tool.steps.length === 0) {
    throw new Error('运维工具必须包含至少一个步骤')
  }
  const stepIds = new Set()
  tool.steps = tool.steps.map(step => {
    if (!step.id || stepIds.has(step.id)) throw new Error('运维工具步骤标识无效或重复')
    if (!String(step.command || '').trim()) throw new Error('运维工具步骤命令不能为空')
    stepIds.add(step.id)
    return { timeoutMs: 60000, ...step }
  })
  return Object.freeze(tool)
}
```

`buildOperationsCatalog(groups)` 必须扁平化定义、校验工具 ID 和 `legacyIds` 唯一，并返回冻结数组；`getOperationsTool(id)` 只从聚合目录读取。

- [ ] **Step 4: 运行测试与 lint**

Run: `node --test test/unit-ci/operations-toolkit-definition.spec.js`
Expected: PASS。

Run: `npx standard src/client/components/operations-toolkit/shared/definition.js src/client/components/operations-toolkit/catalog/index.js test/unit-ci/operations-toolkit-definition.spec.js`
Expected: exit 0。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/shared/definition.js src/client/components/operations-toolkit/catalog/index.js test/unit-ci/helpers/import-esm.js test/unit-ci/operations-toolkit-definition.spec.js
git commit -m "feat: define operations toolkit catalog"
```

### Task 2: 能力探测与国产系统兼容映射

**Files:**
- Create: `src/client/components/operations-toolkit/shared/capability-discovery.js`
- Create: `src/client/components/operations-toolkit/shared/compatibility.js`
- Test: `test/unit-ci/operations-toolkit-discovery.spec.js`

- [ ] **Step 1: 写失败测试覆盖 Debian、RHEL、openEuler 和 Kylin**

```js
test('maps domestic distributions to explicit compatibility families', async () => {
  const { getCompatibilityProfile } = await importModule(
    'src/client/components/operations-toolkit/shared/compatibility.js'
  )
  assert.deepEqual(getCompatibilityProfile({ id: 'openEuler', idLike: 'rhel fedora' }), {
    family: 'openeuler',
    level: 'A',
    packageManager: 'dnf'
  })
  assert.equal(
    getCompatibilityProfile({ id: 'kylin', idLike: 'rhel centos' }).family,
    'rhel'
  )
})

test('parses bounded discovery output with services and interfaces', async () => {
  const { parseOperationsDiscoveryOutput } = await importModule(
    'src/client/components/operations-toolkit/shared/capability-discovery.js'
  )
  const result = parseOperationsDiscoveryOutput(fixture, 'nonce123456789012')
  assert.equal(result.os.id, 'anolis')
  assert.deepEqual(result.interfaces.map(item => item.name), ['eth0', 'eth1'])
  assert.equal(result.services.some(item => item.name === 'nginx.service'), true)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-discovery.spec.js`
Expected: FAIL，提示探测模块不存在。

- [ ] **Step 3: 实现带唯一边界标记的能力探测**

`buildOperationsDiscoveryCommand(nonce)` 输出以下字段：

```text
os.id
os.idLike
os.version
kernel
arch
init
tool=<name>
interface=<name>|<state>|<cidr>|<mtu>
route=<interface>|<gateway>
service=<unit>|<load>|<active>|<enabled>
containerRuntime=<docker|podman>
platform=<bt|1panel|compose|java|php|node|python>
```

解析器必须拒绝重复边界、未知字段、超过 500 个服务、超过 64 个网卡和非法服务名。`getCompatibilityProfile` 必须按显式发行版优先、`ID_LIKE` 次之的顺序映射 Debian、RHEL、openEuler、Anolis、UOS、Kylin、Alibaba Cloud Linux、TencentOS 和 EulerOS。

- [ ] **Step 4: 运行测试与现有探测回归**

Run: `node --test test/unit-ci/operations-toolkit-discovery.spec.js test/unit-ci/quick-command-service-discovery.spec.js test/unit-ci/server-status-platforms.spec.js`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/shared/capability-discovery.js src/client/components/operations-toolkit/shared/compatibility.js test/unit-ci/operations-toolkit-discovery.spec.js
git commit -m "feat: discover operations toolkit capabilities"
```

### Task 3: 任务模型、输出缓冲和有界历史

**Files:**
- Create: `src/client/components/operations-toolkit/runtime/task-model.js`
- Create: `src/client/components/operations-toolkit/runtime/output-buffer.js`
- Create: `src/client/components/operations-toolkit/runtime/task-record-store.js`
- Create: `src/client/store/operations-toolkit.js`
- Modify: `src/client/store/store.js`
- Modify: `src/client/store/init-state.js`
- Test: `test/unit-ci/operations-toolkit-task-model.spec.js`

- [ ] **Step 1: 写失败测试固定状态迁移和终态释放**

```js
test('operations task cannot leave a final state', async () => {
  const { createOperationsTask, transitionOperationsTask } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-model.js'
  )
  const task = createOperationsTask({
    id: 'ops-1',
    toolId: 'system.overview',
    endpointKey: 'root@example.com:22'
  })
  const completed = transitionOperationsTask(task, 'completed')
  assert.throws(() => transitionOperationsTask(completed, 'running'), /终态/)
})

test('output buffer keeps 5000 lines and marks truncation', async () => {
  const { createOutputBuffer } = await importModule(
    'src/client/components/operations-toolkit/runtime/output-buffer.js'
  )
  const buffer = createOutputBuffer({ maxLines: 5000 })
  buffer.append(Array.from({ length: 5010 }, (_, index) => `line-${index}`).join('\n'))
  assert.equal(buffer.snapshot().lines.length, 5000)
  assert.equal(buffer.snapshot().truncated, true)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-task-model.spec.js`
Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现状态模型和存储接口**

状态集合固定为：

```js
export const operationsTaskStatuses = Object.freeze({
  created: 'created',
  discovering: 'discovering',
  ready: 'ready',
  running: 'running',
  verifying: 'verifying',
  completed: 'completed',
  cancelling: 'cancelling',
  cancelled: 'cancelled',
  timedOut: 'timed-out',
  failed: 'failed',
  disconnected: 'disconnected',
  partiallyCompleted: 'partially-completed'
})
```

`task-record-store.js` 使用 `safe-local-storage` 保存最多 100 条摘要记录；每步骤最多 256 KB，写入前调用 `redactAuditText`。`operations-toolkit.js` 暴露：

```js
Store.prototype.openOperationsToolkit = function (tab = 'quick') {}
Store.prototype.closeOperationsToolkit = function () {}
Store.prototype.runOperationsTool = async function (toolId, params = {}) {}
Store.prototype.cancelOperationsTask = async function (taskId) {}
Store.prototype.clearOperationsHistory = function () {}
```

继续使用 `openQuickCommandBar` 作为兼容 UI 开关，新增 `operationsToolkitTab`、`operationsTasks`、`activeOperationsTaskId`，不迁移用户数据。

- [ ] **Step 4: 运行单测、store 回归和 lint**

Run: `node --test test/unit-ci/operations-toolkit-task-model.spec.js test/unit-ci/safety-transaction-store.spec.js`
Expected: 全部 PASS。

Run: `npx standard src/client/components/operations-toolkit/runtime/*.js src/client/store/operations-toolkit.js test/unit-ci/operations-toolkit-task-model.spec.js`
Expected: exit 0。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/runtime src/client/store/operations-toolkit.js src/client/store/store.js src/client/store/init-state.js test/unit-ci/operations-toolkit-task-model.spec.js
git commit -m "feat: add operations task state and history"
```

### Task 4: SSH exec 后台通道、增量日志和取消

**Files:**
- Create: `src/client/components/operations-toolkit/runtime/remote-task-envelope.js`
- Create: `src/client/components/operations-toolkit/runtime/ssh-task-channel.js`
- Test: `test/unit-ci/operations-toolkit-ssh-channel.spec.js`

- [ ] **Step 1: 写失败测试覆盖不注入终端、增量输出和取消**

```js
test('ssh task channel uses runCmd and never writes to terminal', async () => {
  const calls = []
  const { createSshTaskChannel } = await importModule(
    'src/client/components/operations-toolkit/runtime/ssh-task-channel.js'
  )
  const channel = createSshTaskChannel({
    runCmd: async (pid, command) => {
      calls.push({ pid, command })
      return responses.shift()
    },
    cancelRunCmd: async () => true,
    sleep: async () => {}
  })
  const chunks = []
  const result = await channel.execute({
    pid: 88,
    taskId: 'ops-100',
    script: 'uptime',
    timeoutMs: 1000,
    onChunk: chunk => chunks.push(chunk)
  })
  assert.equal(result.exitCode, 0)
  assert.match(chunks.join(''), /up/)
  assert.equal(calls.every(call => call.pid === 88), true)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-ssh-channel.spec.js`
Expected: FAIL，提示通道模块不存在。

- [ ] **Step 3: 实现受控远端任务封装**

`remote-task-envelope.js` 只接受 `assertTrustedOperationId` 验证后的任务 ID。远端目录固定为：

```text
~/.shellpilot/tasks/<task-id>/
  run.sh
  output.log
  pid
  exit
```

启动流程使用 base64 传输 UTF-8 脚本、`umask 077`、`mkdir -p`、`chmod 700 run.sh`。`ssh-task-channel.execute()` 使用现有 `runCmd(pid, command, { executionId, timeoutMs, maxOutputBytes })`：

```js
const channel = createSshTaskChannel({
  runCmd,
  cancelRunCmd,
  pollDelay: 300
})

await channel.execute({
  pid,
  taskId,
  script,
  timeoutMs,
  signal,
  onChunk
})
```

轮询先读取 `wc -c output.log`，再从上次字节偏移读取新增内容。取消时关闭当前 `runCmd`，再向远端 PID 或进程组发送 `TERM`，2 秒后仍存活则发送 `KILL`。完成后读取退出码并清理只读任务目录。

- [ ] **Step 4: 运行通道测试及 SSH runCmd 回归**

Run: `node --test test/unit-ci/operations-toolkit-ssh-channel.spec.js test/unit-ci/session-run-cmd-safety.spec.js test/unit-ci/background-command-registry.spec.js`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/runtime/remote-task-envelope.js src/client/components/operations-toolkit/runtime/ssh-task-channel.js test/unit-ci/operations-toolkit-ssh-channel.spec.js
git commit -m "feat: run operations over isolated ssh exec"
```

### Task 5: 任务执行器、并发和终态收口

**Files:**
- Create: `src/client/components/operations-toolkit/runtime/task-runner.js`
- Modify: `src/client/store/operations-toolkit.js`
- Test: `test/unit-ci/operations-toolkit-runner.spec.js`

- [ ] **Step 1: 写失败测试覆盖同服务器两个只读任务和取消释放**

```js
test('runner releases endpoint slot after cancellation', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const runner = createOperationsTaskRunner({
    channel,
    taskStore,
    discover: async () => capabilities,
    maxReadonlyPerEndpoint: 2
  })
  const first = runner.run(request)
  await runner.cancel(first.taskId)
  const next = runner.run(request)
  assert.equal((await next.completion).status, 'completed')
  assert.equal(runner.getActiveCount(request.endpointKey), 0)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-runner.spec.js`
Expected: FAIL，提示执行器不存在。

- [ ] **Step 3: 实现只读任务执行器**

执行器必须：

- 校验当前端点包含 `tabId`、`pid`、`host`、`port` 和 `username`。
- 每端点最多两个只读任务。
- 首次运行或缓存超过 5 分钟时执行能力探测。
- 逐步骤运行、解析输出并写入任务记录。
- 任何终态在 `finally` 中释放并发槽位。
- 将认证丢失、会话变化映射为 `disconnected`。
- 将 Abort 映射为 `cancelled`，超时映射为 `timed-out`。
- 不调用 `runSafetyCommand`，因为阶段一全部为权威只读定义。

公开接口固定为：

```js
runner.run({ tool, params, endpoint })
runner.cancel(taskId)
runner.get(taskId)
runner.list()
runner.getActiveCount(endpointKey)
```

- [ ] **Step 4: 运行执行器和安全分类回归**

Run: `node --test test/unit-ci/operations-toolkit-runner.spec.js test/unit-ci/command-safety-orchestration.spec.js test/unit-ci/server-maintenance-quick-commands.spec.js`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/runtime/task-runner.js src/client/store/operations-toolkit.js test/unit-ci/operations-toolkit-runner.spec.js
git commit -m "feat: orchestrate readonly operations tasks"
```

### Task 6: 系统与磁盘的 8 个诊断脚本

**Files:**
- Create: `src/client/components/operations-toolkit/catalog/diagnostics/system-storage.js`
- Create: `src/client/components/operations-toolkit/shared/validation.js`
- Modify: `src/client/components/operations-toolkit/catalog/index.js`
- Test: `test/unit-ci/operations-toolkit-system-storage.spec.js`

- [ ] **Step 1: 写目录契约测试**

测试必须断言以下稳定 ID、中文名称、只读风险和降级命令：

```js
const expected = [
  'system.overview',
  'system.cpu-pressure',
  'system.memory-oom',
  'system.boot-events',
  'storage.capacity-inode',
  'storage.io-latency',
  'storage.deleted-open-files',
  'storage.large-directory-growth'
]
assert.deepEqual(tools.map(tool => tool.id), expected)
assert.equal(tools.every(tool => tool.risk === 'read-only'), true)
assert.match(byId('storage.io-latency').steps[0].command, /iostat|vmstat/)
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-system-storage.spec.js`
Expected: FAIL，目录为空。

- [ ] **Step 3: 实现定义、参数和结果解析**

每个工具使用固定标记分隔结果区，解析器返回：

```js
{
  summary: '未发现明显异常',
  severity: 'ok',
  metrics: [],
  findings: [],
  missingCapabilities: [],
  rawSections: {}
}
```

大目录工具参数仅允许绝对路径、深度 1 到 5、结果 10 到 200；默认路径 `/var`，不得默认扫描 `/proc`、`/sys`、`/dev`。I/O 工具在无 `iostat` 时降级到 `vmstat` 和 `/proc/diskstats`，不得建议自动安装。

- [ ] **Step 4: 运行目录测试、注入测试和 lint**

Run: `node --test test/unit-ci/operations-toolkit-system-storage.spec.js test/unit-ci/quick-command-validation.spec.js`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/catalog/diagnostics/system-storage.js src/client/components/operations-toolkit/shared/validation.js src/client/components/operations-toolkit/catalog/index.js test/unit-ci/operations-toolkit-system-storage.spec.js
git commit -m "feat: add system and storage diagnostics"
```

### Task 7: 网络与安全的 7 个诊断脚本

**Files:**
- Create: `src/client/components/operations-toolkit/catalog/diagnostics/network-security.js`
- Modify: `src/client/components/operations-toolkit/catalog/index.js`
- Test: `test/unit-ci/operations-toolkit-network-security.spec.js`

- [ ] **Step 1: 写失败测试固定工具清单**

```js
const expected = [
  'network.interface-health',
  'network.tcp-connections',
  'network.dns-chain',
  'network.route-mtu',
  'network.loss-latency',
  'security.firewall-exposure',
  'security.ssh-login'
]
assert.deepEqual(tools.map(tool => tool.id), expected)
```

测试同时覆盖域名、IP、CIDR、端口和网卡注入输入，例如 `example.com;rm -rf /` 必须被拒绝。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-network-security.spec.js`
Expected: FAIL。

- [ ] **Step 3: 实现网络、安全定义和兼容降级**

- 网卡默认使用能力探测得到的活动路由网卡，并允许下拉选择。
- TCP 使用 `ss`，缺失时降级 `netstat`。
- DNS 支持系统 DNS 和用户指定 DNS 的对比，不修改 resolver。
- 丢包检测默认 4 次、最大 20 次，不对多个公网目标长时间压测。
- 防火墙识别 firewalld、ufw、iptables 和 nftables，仅输出规则摘要。
- SSH 登录日志按 Debian/RHEL 路径或 `journalctl` 自动选择。

- [ ] **Step 4: 运行测试与现有网络命令回归**

Run: `node --test test/unit-ci/operations-toolkit-network-security.spec.js test/unit-ci/server-maintenance-quick-commands.spec.js`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/catalog/diagnostics/network-security.js src/client/components/operations-toolkit/catalog/index.js test/unit-ci/operations-toolkit-network-security.spec.js
git commit -m "feat: add network and security diagnostics"
```

### Task 8: UDP 端口综合检测

**Files:**
- Create: `src/client/components/operations-toolkit/catalog/diagnostics/udp-check.js`
- Modify: `src/client/components/operations-toolkit/catalog/index.js`
- Test: `test/unit-ci/operations-toolkit-udp.spec.js`

- [ ] **Step 1: 写失败测试覆盖 UDP 不确定状态**

```js
test('udp silence is inconclusive instead of closed', async () => {
  const { parseUdpCheckResult } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/udp-check.js'
  )
  const result = parseUdpCheckResult({
    listener: 'none',
    firewall: 'unknown',
    probe: 'timeout',
    capture: 'no-packet'
  })
  assert.equal(result.status, 'inconclusive')
  assert.doesNotMatch(result.summary, /关闭/)
})
```

参数测试覆盖端口 1 到 65535、网卡来自探测列表、尝试次数 1 到 10、超时 1 到 30 秒、抓包数量 1 到 1000 和安全保存路径。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-udp.spec.js`
Expected: FAIL。

- [ ] **Step 3: 实现四阶段 UDP 检测**

工具 ID 为 `network.udp-comprehensive-check`，步骤为：

1. `ss -ulnp` 或 `netstat -ulnp` 检查监听。
2. 读取目标端口相关防火墙规则。
3. 使用 `ncat`、`nc` 或无探测工具降级状态。
4. 用户启用时使用 `tcpdump` 验证实际报文。

结果状态只允许：

```js
['reachable', 'blocked', 'received-no-app-response', 'inconclusive', 'unsupported']
```

抓包默认关闭；启用后默认保存到 `~/.shellpilot/captures/`，结果提供远端路径，不自动下载。

- [ ] **Step 4: 运行 UDP 和参数安全测试**

Run: `node --test test/unit-ci/operations-toolkit-udp.spec.js test/unit-ci/quick-command-validation.spec.js`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/catalog/diagnostics/udp-check.js src/client/components/operations-toolkit/catalog/index.js test/unit-ci/operations-toolkit-udp.spec.js
git commit -m "feat: add comprehensive udp diagnostics"
```

### Task 9: 服务、日志、Web 与容器的 8 个诊断脚本

**Files:**
- Create: `src/client/components/operations-toolkit/catalog/diagnostics/services-platform.js`
- Modify: `src/client/components/operations-toolkit/catalog/index.js`
- Test: `test/unit-ci/operations-toolkit-services-platform.spec.js`

- [ ] **Step 1: 写失败测试固定 8 个工具**

```js
const expected = [
  'service.inventory-health',
  'service.failed-related-logs',
  'logs.system-anomaly-summary',
  'web.nginx-apache-diagnostic',
  'web.http-tls-check',
  'container.runtime-health',
  'container.storage-resources',
  'service.scheduled-tasks'
]
assert.deepEqual(tools.map(tool => tool.id), expected)
```

服务清单测试必须验证自动发现结果可多选，服务名不要求用户手输全称；Docker 不存在时返回 `unsupported` 而不是 `failed`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-services-platform.spec.js`
Expected: FAIL。

- [ ] **Step 3: 实现服务与平台脚本**

- 服务清单优先使用 `systemctl list-units` 和 `list-unit-files`，非 systemd 降级到 `service --status-all`。
- 失败服务组合状态、最近 100 行日志、监听端口和进程。
- 日志异常聚合限制时间范围和输出行数。
- Nginx/Apache 只执行配置测试和读取，不 reload。
- HTTP/TLS 默认连接当前服务器或用户填写目标。
- Docker/Podman 使用只读 `ps`、`inspect`、`logs` 和 `system df`。
- Cron/Timer 只读取，不修改。

- [ ] **Step 4: 运行服务、状态中心和容器回归**

Run: `node --test test/unit-ci/operations-toolkit-services-platform.spec.js test/unit-ci/server-status-center.spec.js test/unit-ci/quick-command-service-discovery.spec.js`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/catalog/diagnostics/services-platform.js src/client/components/operations-toolkit/catalog/index.js test/unit-ci/operations-toolkit-services-platform.spec.js
git commit -m "feat: add service and platform diagnostics"
```

### Task 10: 旧快捷命令兼容映射与嵌入模式

**Files:**
- Create: `src/client/components/operations-toolkit/catalog/migrations.js`
- Modify: `src/client/components/quick-commands/quick-commands-box.jsx`
- Modify: `src/client/components/quick-commands/qm.styl`
- Test: `test/unit-ci/operations-toolkit-migrations.spec.js`
- Test: `test/unit-ci/server-maintenance-command-registry.spec.js`

- [ ] **Step 1: 写失败测试保护旧 ID 和单一入口**

```js
test('packet capture migrates without deleting its legacy id', async () => {
  const { resolveLegacyOperationsTool, hiddenQuickActionIds } = await importModule(
    'src/client/components/operations-toolkit/catalog/migrations.js'
  )
  assert.equal(
    resolveLegacyOperationsTool('builtin-server-packet-capture'),
    'network.udp-comprehensive-check'
  )
  assert.equal(hiddenQuickActionIds.has('builtin-server-packet-capture'), true)
})
```

测试还要断言其余现有快捷命令 ID 顺序不变。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-migrations.spec.js test/unit-ci/server-maintenance-command-registry.spec.js`
Expected: 新测试 FAIL，旧注册表测试 PASS。

- [ ] **Step 3: 实现兼容映射和嵌入样式**

`QuickCommandsFooterBox` 增加：

```jsx
<QuickCommandsFooterBox
  embedded
  hiddenCommandIds={hiddenQuickActionIds}
  {...props}
/>
```

`embedded` 只改变容器定位、标题和关闭动作，不修改 `submitValidatedQuickCommand`、参数表单、安全确认、回滚或执行函数。旧快捷命令仍保留在 store、收藏、快捷键和历史中。

- [ ] **Step 4: 运行迁移、快捷命令和 lint 回归**

Run: `node --test test/unit-ci/operations-toolkit-migrations.spec.js test/unit-ci/server-maintenance-command-registry.spec.js test/unit-ci/server-maintenance-quick-commands.spec.js`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/catalog/migrations.js src/client/components/quick-commands/quick-commands-box.jsx src/client/components/quick-commands/qm.styl test/unit-ci/operations-toolkit-migrations.spec.js
git commit -m "feat: preserve quick command compatibility"
```

### Task 11: 按需加载运维工具工作区

**Files:**
- Create: `src/client/components/operations-toolkit/entry.jsx`
- Create: `src/client/components/operations-toolkit/workspace/operations-workspace.jsx`
- Create: `src/client/components/operations-toolkit/workspace/tool-catalog.jsx`
- Create: `src/client/components/operations-toolkit/workspace/operations-workspace.styl`
- Modify: `src/client/components/layout/layout.jsx`
- Modify: `src/client/components/main/aigshell-topbar.jsx`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Test: `test/e2e/032.operations-toolkit.spec.js`

- [ ] **Step 1: 写 E2E 失败测试固定入口和五页签**

```js
await client.getByRole('button', { name: '运维工具' }).click()
await expect(client.locator('.operations-toolkit-workspace')).toBeVisible()
for (const name of ['快捷操作', '诊断脚本', '维护脚本', '我的工具', '执行记录']) {
  await expect(client.getByRole('tab', { name })).toBeVisible()
}
await expect(client.locator('.operations-toolkit-workspace')).not.toHaveCSS('overflow-x', 'scroll')
```

- [ ] **Step 2: 运行 E2E 并确认失败**

Run: `npx playwright test test/e2e/032.operations-toolkit.spec.js --workers=1`
Expected: FAIL，找不到“运维工具”。

- [ ] **Step 3: 实现懒加载边界和工作区外壳**

`entry.jsx` 使用 `React.lazy` 和错误边界。分包加载失败时显示：

```text
运维工具模块加载失败
[重新加载模块]
```

只允许自动刷新一次旧缓存；之后保留错误面板，不导致白屏。`layout.jsx` 不再直接导入 `QuickCommandsFooterBox`，改为导入轻量 `OperationsToolkitEntry`。顶部入口仍设置 `openQuickCommandBar = true`，显示文案改为“运维工具”。

未连接服务器时允许浏览目录和表单，但执行按钮禁用并显示“连接 SSH 服务器后可执行”。

- [ ] **Step 4: 运行 E2E、主工作区回归和构建**

Run: `npx playwright test test/e2e/032.operations-toolkit.spec.js test/e2e/026.primary-workspace-regression.spec.js --workers=1`
Expected: 全部 PASS。

Run: `npm run vite-build`
Expected: 构建成功，并产生独立运维工具 chunk。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/entry.jsx src/client/components/operations-toolkit/workspace src/client/components/layout/layout.jsx src/client/components/main/aigshell-topbar.jsx src/client/common/shellpilot-i18n-overrides.js test/e2e/032.operations-toolkit.spec.js
git commit -m "feat: add operations toolkit workspace"
```

### Task 12: 参数表单、任务面板、虚拟日志和结构化结果

**Files:**
- Create: `src/client/components/operations-toolkit/workspace/parameter-form.jsx`
- Create: `src/client/components/operations-toolkit/workspace/task-panel.jsx`
- Create: `src/client/components/operations-toolkit/workspace/virtual-log.jsx`
- Create: `src/client/components/operations-toolkit/workspace/result-viewer.jsx`
- Modify: `src/client/components/operations-toolkit/workspace/operations-workspace.jsx`
- Modify: `src/client/components/operations-toolkit/workspace/operations-workspace.styl`
- Test: `test/e2e/033.operations-toolkit-runtime.spec.js`

- [ ] **Step 1: 写 E2E 失败测试覆盖运行、进度、取消和下一任务**

```js
await openTool('系统运行概览')
await client.getByRole('button', { name: '开始诊断' }).click()
await expect(client.locator('[data-task-status="running"]')).toBeVisible()
await expect(client.getByRole('button', { name: '取消任务' })).toBeEnabled()
await waitForTaskStatus('completed')
await openTool('磁盘容量与 inode')
await expect(client.getByRole('button', { name: '开始诊断' })).toBeEnabled()
```

另一个用例运行长任务后点击取消，断言状态为“已取消”，并立即能运行下一项。

- [ ] **Step 2: 运行 E2E 并确认失败**

Run: `npx playwright test test/e2e/033.operations-toolkit-runtime.spec.js --workers=1`
Expected: FAIL，缺少任务面板。

- [ ] **Step 3: 实现表单和任务视图**

- 参数表单只支持注册类型：`text`、`number`、`select`、`multi-select`、`switch`、`path`、`host`、`port`、`cidr`。
- 自动发现字段显示“重新检测”并保留用户已选合法值。
- 任务面板左侧显示步骤，右侧显示虚拟日志或结构化结果。
- `VirtualLog` 复用 `virtual-tree-list.jsx` 的固定行高、overscan 和 ResizeObserver 思路，不引入新依赖。
- 动作栏提供“取消任务”“查看实际命令”“复制到终端”“在终端继续”。
- 只读工具点击后直接执行，不显示风险确认。

- [ ] **Step 4: 运行 E2E、1366 布局和主题回归**

Run: `npx playwright test test/e2e/032.operations-toolkit.spec.js test/e2e/033.operations-toolkit-runtime.spec.js test/e2e/026.primary-workspace-regression.spec.js --workers=1`
Expected: 全部 PASS。

Run: `npm run lint`
Expected: exit 0。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/workspace test/e2e/033.operations-toolkit-runtime.spec.js
git commit -m "feat: show operations task progress and results"
```

### Task 13: AI 交接、执行记录、帮助和中文化

**Files:**
- Create: `src/client/components/operations-toolkit/shared/ai-context.js`
- Modify: `src/client/components/operations-toolkit/workspace/result-viewer.jsx`
- Modify: `src/client/components/operations-toolkit/workspace/operations-workspace.jsx`
- Modify: `src/client/components/main/help-center-modal.jsx`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Test: `test/unit-ci/operations-toolkit-ai-context.spec.js`
- Modify: `test/e2e/032.operations-toolkit.spec.js`

- [ ] **Step 1: 写失败测试限制 AI 上下文大小和敏感内容**

```js
test('operations ai context is bounded and redacted', async () => {
  const { buildOperationsAiPrompt } = await importModule(
    'src/client/components/operations-toolkit/shared/ai-context.js'
  )
  const prompt = buildOperationsAiPrompt({
    toolTitle: 'SSH 登录安全检查',
    result: { output: `Authorization: Bearer secret-token\n${'x'.repeat(50000)}` }
  })
  assert.doesNotMatch(prompt, /secret-token/)
  assert.ok(prompt.length <= 12000)
  assert.match(prompt, /内容已截断/)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-ai-context.spec.js`
Expected: FAIL。

- [ ] **Step 3: 实现 AI 交接和执行记录**

“交给 AI 分析”调用现有：

```js
window.store.handleOpenAIPanel()
refsStatic.get('AIChat')?.setPrompt(prompt)
```

不自动发送；用户可以检查后发送。执行记录页显示状态、服务器、工具、开始时间、耗时、截断标记和“查看结果”，不显示认证凭据。帮助中心增加：

- 快捷操作、诊断脚本、维护脚本区别。
- 只读直接执行与维护确认规则。
- 后台执行、取消、超时和任务记录。
- UDP 检测结果解释。
- 国产系统兼容等级。

扫描新目录和新增 UI 文案，禁止出现 `Delay`、`Label`、`Templates`、`Search in text...` 等英文残留。

- [ ] **Step 4: 运行 AI、帮助和中文化回归**

Run: `node --test test/unit-ci/operations-toolkit-ai-context.spec.js test/unit-ci/ai-conversation-safety.spec.js`
Expected: 全部 PASS。

Run: `npx playwright test test/e2e/032.operations-toolkit.spec.js --workers=1`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/client/components/operations-toolkit/shared/ai-context.js src/client/components/operations-toolkit/workspace/result-viewer.jsx src/client/components/operations-toolkit/workspace/operations-workspace.jsx src/client/components/main/help-center-modal.jsx src/client/common/shellpilot-i18n-overrides.js test/unit-ci/operations-toolkit-ai-context.spec.js test/e2e/032.operations-toolkit.spec.js
git commit -m "feat: integrate operations history with ai"
```

### Task 14: 完整回归、性能门禁和本地打包

**Files:**
- Modify: `test/e2e/029.performance-baseline.spec.js`
- Modify: `test/e2e/030.real-server-regression.spec.js`
- Create: `test/unit-ci/operations-toolkit-release-gate.spec.js`
- Modify: `docs/superpowers/plans/2026-07-24-operations-toolkit-phase-1.md` only to check completed boxes during execution

- [ ] **Step 1: 增加发布门禁测试**

门禁必须断言：

```js
const {
  assertPackageVersionConsistency
} = require('../../build/bin/release-version-consistency')
const packageJson = require('../../package.json')
const packageLock = require('../../package-lock.json')

assert.doesNotThrow(() => assertPackageVersionConsistency({
  packageVersion: packageJson.version,
  lockVersion: packageLock.version,
  lockRootVersion: packageLock.packages[''].version
}))
assert.equal(catalog.length, 24)
assert.equal(new Set(catalog.map(tool => tool.id)).size, 24)
assert.equal(catalog.every(tool => tool.risk === 'read-only'), true)
assert.equal(catalog.every(tool => tool.steps.length > 0), true)
```

性能 E2E 增加两个场景：

- 未打开运维工具时不出现能力探测请求，终端首次可用时间回退不超过 100 ms。
- 打开并关闭运维工具后，任务和 ResizeObserver 均清理，不持续增长内存或监听器。

- [ ] **Step 2: 运行全量单元测试**

Run: `npm run test-unit-ci`
Expected: 0 failed；现有 skip 数量不得增加。

- [ ] **Step 3: 运行关键 E2E**

Run:

```bash
npx playwright test test/e2e/005.basic-ssh.spec.js test/e2e/009.1.quick-commands.spec.js test/e2e/025.fleet-service-selector.spec.js test/e2e/026.primary-workspace-regression.spec.js test/e2e/027.quality-core-flows.spec.js test/e2e/029.performance-baseline.spec.js test/e2e/032.operations-toolkit.spec.js test/e2e/033.operations-toolkit-runtime.spec.js --workers=1
```

Expected: 全部 PASS。

- [ ] **Step 4: 使用真实服务器执行只读回归**

从 `F:\SSH工具开发\VPS服务器信息.txt` 读取测试端点，但不得把密码写入测试、日志或提交。运行：

```bash
npx playwright test test/e2e/030.real-server-regression.spec.js --workers=1
```

在真实服务器上只执行阶段一只读工具。UDP 抓包默认关闭；不执行网络、SSH、防火墙、服务停止、文件删除或软件安装。

- [ ] **Step 5: 运行 lint、构建和本地包冒烟**

Run: `npm run lint`
Expected: exit 0。

Run: `npm run compile`
Expected: 构建成功，版本保持与 `package.json` 一致。

Run: `npm run test-package-smoke`
Expected: PASS，生成的 Windows 客户端可启动。

- [ ] **Step 6: 人工视觉验收**

对以下组合保存截图并检查：

- 1366×768，100% 和 125%，日间/夜间。
- 1920×1080，100% 和 150%，日间/夜间。
- 无连接、SSH 已连接、长服务名、长日志、任务运行、任务取消和模块加载失败。

验收要求：无横向依赖、文字挤压、按钮遮挡、聊天框遮挡或终端尺寸跳动。

- [ ] **Step 7: 提交质量门禁**

```bash
git add test/e2e/029.performance-baseline.spec.js test/e2e/030.real-server-regression.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js
git commit -m "test: gate operations toolkit phase one"
```

- [ ] **Step 8: 最终提交检查**

Run: `git status --short`
Expected: 仅保留执行前已经存在的未跟踪文件；本计划相关文件全部已提交。

Run: `git log --oneline --max-count=14`
Expected: 能看到本计划各任务的独立提交。

不要执行 GitHub Release、魔塔同步或客户端在线更新。完成本地验收后由用户决定是否进入阶段二或发布中间版本。
