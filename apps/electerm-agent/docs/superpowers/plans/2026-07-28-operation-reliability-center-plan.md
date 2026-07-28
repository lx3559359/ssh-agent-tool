# ShellPilot 0.4.18 Operation Reliability Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 SFTP、SSH 隧道、AI 多文件修改和安全中心增加可观察、可暂停、可恢复、可审查、可回滚的统一可靠性能力，同时保持普通 SSH 终端启动和输入链路不受影响。

**Architecture:** 新增一个仅保存可序列化元数据的轻量任务层，SFTP、隧道和 AI 修改分别通过适配器写入该层，安全中心只聚合视图与动作路由，不持有运行时连接。SFTP 使用同目录临时文件、稳定断点和源/目标指纹实现跨重启续传；隧道采用被动事件与有限重连；AI 多文件修改先形成变更集，再由统一差异审查和安全事务执行。

**Tech Stack:** Electron 41、React 19、Ant Design 6、Node.js、`@electerm/ssh2` SFTP、NeDB、本项目 safety-transactions、Node test runner、Playwright。

---

## 约束与文件职责

- `src/client/common/operation-tasks/models.js`：统一任务类型、状态、合法状态转换和可序列化边界。
- `src/client/common/operation-tasks/task-store.js`：通过项目数据库适配器持久化任务，串行化更新并限制历史数量。
- `src/client/components/file-transfer/transfer-resume.js`：SFTP 断点、源/目标指纹和恢复判定的纯函数。
- `src/app/server/transfer.js`：真正执行带偏移量的传输、确认暂停、保留临时文件、原子提交。
- `src/client/components/file-transfer/transfer.jsx`：把现有传输生命周期映射到统一任务，并控制暂停、继续和恢复。
- `src/client/components/sidebar/transfer-list-control.jsx`：传输进度、速度、剩余时间、暂停/继续按钮。
- `src/app/server/ssh-tunnel-health.js`：隧道状态机、事件历史和有限重连策略。
- `src/app/server/ssh-tunnel-runtime.js`：连接控制器生命周期与健康状态集成。
- `src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx`：健康状态、断线原因和历史展示。
- `src/client/components/ai/ai-file-change-set.js`：多文件变更集、选择状态、指纹和执行摘要。
- `src/client/components/ai/ai-file-change-review-modal.jsx`：左侧文件列表、右侧差异、选择和执行确认。
- `src/client/components/ai/agent-tools.js`：把多次文件修改收集为一个变更集，再交给安全事务执行。
- `src/client/components/main/safety-operation-center-model.js`：聚合现代事务、旧回滚、SFTP、隧道、AI 变更和手动备份。
- `src/client/components/main/safety-operation-center-modal.jsx`：按“进行中、可恢复、历史、旧记录”展示统一记录。
- 所有持久化记录禁止包含密码、API Key、私钥、文件正文、SSH/SFTP 实例、流、Buffer、函数或 Electron 对象。
- 普通 SSH 建连、终端输入、快捷键和渲染链路不得依赖 operation-tasks 初始化成功。

### Task 1: 统一任务模型与持久化存储

**Files:**
- Create: `src/client/common/operation-tasks/models.js`
- Create: `src/client/common/operation-tasks/task-store.js`
- Test: `test/unit-ci/operation-task-store.spec.js`

- [ ] **Step 1: 写任务模型失败测试**

```js
test('operation task model normalizes safe serializable records', () => {
  const task = normalizeOperationTask({
    id: 'transfer-1',
    kind: operationTaskKinds.sftpTransfer,
    status: operationTaskStatuses.running,
    title: 'upload app.log',
    endpoint: { host: 'example.test', port: 22, username: 'root' },
    progress: { transferred: 128, total: 1024 },
    runtime: { stream: Buffer.from('secret') },
    password: 'must-not-survive'
  }, () => new Date('2026-07-28T00:00:00.000Z'))

  assert.equal(task.schemaVersion, 1)
  assert.equal(task.progress.percent, 12)
  assert.equal(task.endpoint.username, 'root')
  assert.equal('password' in task, false)
  assert.equal('runtime' in task, false)
  assert.doesNotThrow(() => structuredClone(task))
})

test('operation task model rejects invalid transitions', () => {
  assert.throws(
    () => assertOperationTaskTransition('completed', 'running'),
    /OPERATION_TASK_TRANSITION_INVALID/
  )
})
```

- [ ] **Step 2: 运行模型测试并确认红灯**

Run: `node --test test/unit-ci/operation-task-store.spec.js`

Expected: FAIL，提示找不到 `operation-tasks/models.js`。

- [ ] **Step 3: 实现最小任务模型**

```js
export const operationTaskKinds = Object.freeze({
  sftpTransfer: 'sftp-transfer',
  sshTunnel: 'ssh-tunnel',
  aiFileChange: 'ai-file-change',
  manualBackup: 'manual-backup'
})

export const operationTaskStatuses = Object.freeze({
  queued: 'queued',
  running: 'running',
  pausing: 'pausing',
  paused: 'paused',
  interrupted: 'interrupted',
  resuming: 'resuming',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled'
})

const finalStatuses = new Set(['completed', 'failed', 'cancelled'])
const allowedTransitions = Object.freeze({
  queued: new Set(['running', 'cancelled']),
  running: new Set(['pausing', 'interrupted', 'completed', 'failed', 'cancelled']),
  pausing: new Set(['paused', 'interrupted', 'failed', 'cancelled']),
  paused: new Set(['resuming', 'cancelled']),
  interrupted: new Set(['resuming', 'cancelled']),
  resuming: new Set(['running', 'interrupted', 'failed', 'cancelled'])
})

export function assertOperationTaskTransition (from, to) {
  if (from === to) return
  if (finalStatuses.has(from) || !allowedTransitions[from]?.has(to)) {
    const error = new Error(`OPERATION_TASK_TRANSITION_INVALID:${from}:${to}`)
    error.code = 'OPERATION_TASK_TRANSITION_INVALID'
    throw error
  }
}

export function normalizeOperationTask (input = {}, clock = () => new Date()) {
  const now = clock().toISOString()
  const transferred = Math.max(0, Number(input.progress?.transferred) || 0)
  const total = Math.max(0, Number(input.progress?.total) || 0)
  return {
    schemaVersion: 1,
    id: String(input.id || ''),
    kind: String(input.kind || ''),
    status: String(input.status || operationTaskStatuses.queued),
    title: String(input.title || ''),
    endpoint: input.endpoint ? {
      host: String(input.endpoint.host || ''),
      port: Number(input.endpoint.port) || 22,
      username: String(input.endpoint.username || '')
    } : null,
    progress: {
      transferred,
      total,
      percent: total ? Math.min(100, Math.floor(transferred * 100 / total)) : 0,
      speed: Math.max(0, Number(input.progress?.speed) || 0),
      etaSeconds: Math.max(0, Number(input.progress?.etaSeconds) || 0)
    },
    metadata: input.metadata && typeof input.metadata === 'object'
      ? JSON.parse(JSON.stringify(input.metadata))
      : {},
    createdAt: input.createdAt || now,
    updatedAt: now
  }
}
```

- [ ] **Step 4: 增加持久化、串行更新和启动中断测试**

```js
test('task store serializes patches and marks unfinished work interrupted', async () => {
  const rows = new Map()
  const adapter = memoryAdapter(rows)
  await saveOperationTask(taskFixture({ id: 'one', status: 'running' }), { adapter })
  await Promise.all([
    patchOperationTask('one', { progress: { transferred: 10, total: 100 } }, { adapter }),
    patchOperationTask('one', { progress: { transferred: 20, total: 100 } }, { adapter })
  ])
  await markUnfinishedOperationTasksInterrupted({ adapter })
  const saved = await findOperationTask('one', { adapter })
  assert.equal(saved.status, 'interrupted')
  assert.equal(saved.progress.transferred, 20)
})
```

- [ ] **Step 5: 实现任务存储**

```js
const taskTable = 'operationTasks'
const patchQueues = new WeakMap()

export async function saveOperationTask (task, { adapter = defaultAdapter, clock } = {}) {
  const normalized = normalizeOperationTask(task, clock)
  await adapter.update(taskTable, { id: normalized.id }, normalized, { upsert: true })
  return normalized
}

export function patchOperationTask (id, patch, { adapter = defaultAdapter, clock } = {}) {
  const previous = patchQueues.get(adapter) || Promise.resolve()
  const next = previous.then(async () => {
    const current = await adapter.findOne(taskTable, { id })
    if (!current) throw new Error(`OPERATION_TASK_NOT_FOUND:${id}`)
    if (patch.status) assertOperationTaskTransition(current.status, patch.status)
    return saveOperationTask({
      ...current,
      ...patch,
      progress: { ...current.progress, ...patch.progress },
      metadata: { ...current.metadata, ...patch.metadata }
    }, { adapter, clock })
  })
  patchQueues.set(adapter, next.catch(() => {}))
  return next
}

export async function markUnfinishedOperationTasksInterrupted ({ adapter = defaultAdapter } = {}) {
  const records = await adapter.find(taskTable, {})
  const unfinished = records.filter(item => !['completed', 'failed', 'cancelled'].includes(item.status))
  return Promise.all(unfinished.map(item => patchOperationTask(
    item.id,
    { status: 'interrupted', metadata: { interruptionReason: 'client-restarted' } },
    { adapter }
  )))
}
```

- [ ] **Step 6: 运行测试与 lint**

Run: `node --test test/unit-ci/operation-task-store.spec.js`

Expected: PASS。

Run: `npx standard src/client/common/operation-tasks/models.js src/client/common/operation-tasks/task-store.js test/unit-ci/operation-task-store.spec.js`

Expected: exit code 0。

- [ ] **Step 7: 提交统一任务基础**

```powershell
git add src/client/common/operation-tasks test/unit-ci/operation-task-store.spec.js
git commit -m "feat: add persistent operation task model"
```

### Task 2: SFTP 服务端稳定断点与原子续传

**Files:**
- Create: `src/client/components/file-transfer/transfer-resume.js`
- Modify: `src/app/server/transfer.js`
- Modify: `src/app/server/session-sftp.js`
- Test: `test/unit-ci/transfer-resume.spec.js`
- Test: `test/unit-ci/transfer-progress.spec.js`

- [ ] **Step 1: 写恢复判定失败测试**

```js
test('resume validator accepts matching source and partial target', () => {
  const result = validateTransferResume({
    checkpoint: {
      offset: 4096,
      source: { size: 8192, mtimeMs: 1000, firstSha256: 'a', lastSha256: 'b' },
      target: { size: 4096, boundarySha256: 'c' }
    },
    source: { size: 8192, mtimeMs: 1000, firstSha256: 'a', lastSha256: 'b' },
    target: { size: 4096, boundarySha256: 'c' }
  })
  assert.deepEqual(result, { ok: true, offset: 4096 })
})

test('resume validator rejects changed source', () => {
  const result = validateTransferResume({
    checkpoint: {
      offset: 4096,
      source: { size: 8192, mtimeMs: 1000, firstSha256: 'a', lastSha256: 'b' },
      target: { size: 4096, boundarySha256: 'c' }
    },
    source: { size: 8193, mtimeMs: 1000, firstSha256: 'a', lastSha256: 'b' },
    target: { size: 4096, boundarySha256: 'c' }
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'TRANSFER_SOURCE_CHANGED')
})
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node --test test/unit-ci/transfer-resume.spec.js`

Expected: FAIL，提示找不到 `transfer-resume.js`。

- [ ] **Step 3: 实现恢复判定和指纹比较**

```js
export function validateTransferResume ({ checkpoint, source, target }) {
  if (!checkpoint || checkpoint.offset <= 0) {
    return { ok: false, code: 'TRANSFER_CHECKPOINT_INVALID' }
  }
  const sourceKeys = ['size', 'mtimeMs', 'firstSha256', 'lastSha256']
  if (sourceKeys.some(key => checkpoint.source?.[key] !== source?.[key])) {
    return { ok: false, code: 'TRANSFER_SOURCE_CHANGED' }
  }
  if (target?.size !== checkpoint.offset ||
    target?.boundarySha256 !== checkpoint.target?.boundarySha256) {
    return { ok: false, code: 'TRANSFER_PARTIAL_CHANGED' }
  }
  return { ok: true, offset: checkpoint.offset }
}
```

- [ ] **Step 4: 写服务端暂停确认、保留临时文件和偏移续传测试**

```js
test('paused atomic upload keeps its partial file and resumes at checkpoint', async () => {
  const source = Buffer.alloc(256 * 1024, 7)
  const fixture = createPausedUploadFixture(source)
  const first = new Transfer({
    ...fixture.options,
    id: 'resume-upload',
    options: { atomicUpload: true, keepPartial: true, chunkSize: 32 * 1024 }
  })
  const checkpoint = await fixture.pauseAfter(first, 64 * 1024)
  assert.equal(checkpoint.offset, 64 * 1024)
  assert.equal(fs.existsSync(checkpoint.partialPath), true)

  const resumed = await fixture.resume({
    id: 'resume-upload-2',
    startOffset: checkpoint.offset,
    partialPath: checkpoint.partialPath
  })
  assert.deepEqual(fs.readFileSync(fixture.remotePath), source)
  assert.equal(resumed.finalized, true)
})
```

- [ ] **Step 5: 修改传输服务端协议**

在 `Transfer` 构造函数内保存以下字段，并确保它们只来自经过校验的传输参数：

```js
this.startOffset = Math.max(0, Number(options.startOffset) || 0)
this.keepPartial = options.keepPartial === true
this.atomicTempPath = options.partialPath || this.atomicTempPath
this.transferred = this.startOffset
this.pauseAcknowledged = false
```

在传输读写入口使用偏移量，并在暂停真正生效时返回稳定断点：

```js
acknowledgePause = async () => {
  if (this.pauseAcknowledged) return
  this.pauseAcknowledged = true
  const checkpoint = await this.buildCheckpoint()
  this.ws.s({
    id: `transfer:paused:${this.id}`,
    data: checkpoint
  })
}
```

错误与销毁时仅在明确取消或不可恢复错误时清理临时文件：

```js
shouldKeepPartial () {
  return this.keepPartial && ['paused', 'interrupted', 'connection-lost'].includes(this.stopReason)
}

async cleanupAfterStop () {
  if (!this.shouldKeepPartial()) await this.cleanupAtomicUpload()
}
```

成功完成时保持现有原子重命名语义，最终目标在校验完成前不可见。

- [ ] **Step 6: 在 SFTP 会话中增加受限 stat/read/delete 接口**

```js
async describeResumeEntry (filePath, boundarySize = 64 * 1024) {
  const stat = await this.stat(filePath)
  return {
    size: stat.size,
    mtimeMs: Number(stat.mtime) * 1000,
    boundarySha256: await this.hashFileBoundary(filePath, boundarySize)
  }
}
```

`boundarySize` 上限固定为 64 KiB；接口仅返回大小、时间和 SHA-256，不返回文件正文。

- [ ] **Step 7: 运行传输测试**

Run: `node --test test/unit-ci/transfer-resume.spec.js test/unit-ci/transfer-progress.spec.js test/unit-ci/sftp-transfer-safety.spec.js`

Expected: PASS，原有“失败原子上传清理临时文件”测试仍通过；只有标记为可恢复的暂停/中断保留临时文件。

- [ ] **Step 8: 提交服务端续传**

```powershell
git add src/app/server/transfer.js src/app/server/session-sftp.js src/client/components/file-transfer/transfer-resume.js test/unit-ci/transfer-resume.spec.js test/unit-ci/transfer-progress.spec.js
git commit -m "feat: support resumable atomic SFTP transfers"
```

### Task 3: SFTP 进度、暂停确认与跨重启恢复 UI

**Files:**
- Create: `src/client/components/file-transfer/transfer-task-adapter.js`
- Modify: `src/client/components/file-transfer/transfer.jsx`
- Modify: `src/client/components/sidebar/transfer-list-control.jsx`
- Modify: `src/client/components/sidebar/transport-ui.jsx`
- Modify: `src/client/components/sidebar/transfer.styl`
- Modify: `src/client/store/transfer-list.js`
- Test: `test/unit-ci/transfer-task-adapter.spec.js`
- Test: `test/unit-ci/transfer-progress-ui.spec.js`
- Test: `test/e2e/018.file-transfer.spec.js`

- [ ] **Step 1: 写进度节流与恢复动作失败测试**

```js
test('transfer adapter persists at most every two seconds or four MiB', async () => {
  const patches = []
  const adapter = createTransferTaskAdapter({
    patchTask: async (id, patch) => patches.push({ id, patch }),
    clock: sequenceClock([0, 100, 200, 2100])
  })
  await adapter.onProgress('one', { transferred: 1, total: 100 })
  await adapter.onProgress('one', { transferred: 2, total: 100 })
  await adapter.onProgress('one', { transferred: 4 * 1024 * 1024 + 2, total: 10 * 1024 * 1024 })
  await adapter.onProgress('one', { transferred: 4 * 1024 * 1024 + 3, total: 10 * 1024 * 1024 })
  assert.equal(patches.length, 3)
})

test('interrupted task requires explicit resume', () => {
  assert.equal(getTransferPrimaryAction({ status: 'interrupted' }), 'resume')
  assert.equal(getTransferPrimaryAction({ status: 'running' }), 'pause')
})
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node --test test/unit-ci/transfer-task-adapter.spec.js test/unit-ci/transfer-progress-ui.spec.js`

Expected: FAIL，缺少新模块。

- [ ] **Step 3: 实现传输任务适配器**

```js
export function createTransferTaskAdapter ({
  patchTask,
  clock = () => Date.now(),
  persistIntervalMs = 2000,
  persistBytes = 4 * 1024 * 1024
}) {
  const last = new Map()
  return {
    async onProgress (id, progress) {
      const current = last.get(id) || { at: Number.NEGATIVE_INFINITY, bytes: Number.NEGATIVE_INFINITY }
      const now = clock()
      if (now - current.at < persistIntervalMs &&
        progress.transferred - current.bytes < persistBytes) return false
      last.set(id, { at: now, bytes: progress.transferred })
      await patchTask(id, { progress })
      return true
    },
    async onPaused (id, checkpoint) {
      await patchTask(id, {
        status: 'paused',
        metadata: { checkpoint }
      })
    }
  }
}
```

- [ ] **Step 4: 把传输生命周期接入统一任务**

在 `transfer.jsx`：

```js
onPauseAcknowledged = async checkpoint => {
  this.update({
    pausing: false,
    paused: true,
    checkpoint
  })
  await this.transferTaskAdapter.onPaused(this.props.transfer.id, checkpoint)
}

resumeInterrupted = async () => {
  const plan = await this.buildResumePlan()
  if (!plan.ok) {
    this.update({ resumeError: plan.code })
    return
  }
  await patchOperationTask(this.props.transfer.id, { status: 'resuming' })
  this.startTransfer({
    startOffset: plan.offset,
    partialPath: plan.partialPath,
    keepPartial: true
  })
}
```

启动时调用 `markUnfinishedOperationTasksInterrupted()`，只恢复任务列表，不自动重连或自动传输。

- [ ] **Step 5: 重写批量暂停/继续动作语义**

在 `transfer-list.js` 中将 UI 标记改为请求态：

```js
Store.prototype.pauseAll = function () {
  window.store.pauseAllTransfer = true
  for (const transfer of window.store.fileTransfers) {
    if (transfer.status === 'running') {
      transfer.pausing = true
      refsStatic.get(`transfer-${transfer.id}`)?.pause()
    }
  }
}
```

只有收到 `transfer:paused:<id>` 后才显示“已暂停”。

- [ ] **Step 6: 增加进度行和文件夹汇总**

每个任务行显示：

```jsx
<Progress
  percent={transfer.percent}
  size='small'
  status={transfer.error ? 'exception' : 'active'}
/>
<div className='transfer-progress-meta'>
  <span>{formatBytes(transfer.transferred)} / {formatBytes(transfer.total)}</span>
  <span>{formatSpeed(transfer.speed)}</span>
  <span>{formatEta(transfer.etaSeconds)}</span>
</div>
```

按钮固定为熟悉图标并带中文 tooltip：暂停、继续、取消、重新开始、另存为。

- [ ] **Step 7: 运行单元和 E2E 测试**

Run: `node --test test/unit-ci/transfer-task-adapter.spec.js test/unit-ci/transfer-progress-ui.spec.js test/unit-ci/transfer-operation-queue.spec.js`

Expected: PASS。

Run: `npx playwright test test/e2e/018.file-transfer.spec.js --workers=1`

Expected: PASS，并验证上传、下载、暂停确认、继续、取消和文件夹汇总。

- [ ] **Step 8: 提交 SFTP 客户端体验**

```powershell
git add src/client/components/file-transfer src/client/components/sidebar src/client/store/transfer-list.js test/unit-ci/transfer-task-adapter.spec.js test/unit-ci/transfer-progress-ui.spec.js test/e2e/018.file-transfer.spec.js
git commit -m "feat: add visible resumable SFTP transfer tasks"
```

### Task 4: SSH 隧道健康状态与断线历史

**Files:**
- Create: `src/app/server/ssh-tunnel-health.js`
- Modify: `src/app/server/ssh-tunnel-runtime.js`
- Modify: `src/app/server/ssh-tunnel.js`
- Modify: `src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx`
- Modify: `src/client/components/ssh-tunnel/ssh-tunnel-modal.styl`
- Test: `test/unit-ci/ssh-tunnel-health.spec.js`
- Test: `test/unit-ci/ssh-tunnel-runtime.spec.js`
- Test: `test/unit-ci/ssh-tunnel-ui.spec.js`
- Test: `test/e2e/033.ssh-tunnel-manager.spec.js`

- [ ] **Step 1: 写隧道状态机失败测试**

```js
test('tunnel health keeps a bounded event history', () => {
  let health = createTunnelHealth('one', 1000)
  for (let index = 0; index < 60; index++) {
    health = appendTunnelEvent(health, {
      type: 'connection-lost',
      at: 1001 + index,
      code: 'ECONNRESET'
    })
  }
  assert.equal(health.events.length, 50)
  assert.equal(health.events[0].at, 1011)
  assert.equal(health.state, tunnelHealthStates.sessionLost)
})

test('reconnect policy stops after three bounded attempts', () => {
  assert.deepEqual([0, 1, 2, 3].map(getReconnectDelayMs), [1000, 3000, 10000, null])
})
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node --test test/unit-ci/ssh-tunnel-health.spec.js`

Expected: FAIL，缺少 `ssh-tunnel-health.js`。

- [ ] **Step 3: 实现纯状态机**

```js
const reconnectDelays = [1000, 3000, 10000]

exports.tunnelHealthStates = Object.freeze({
  starting: 'starting',
  healthy: 'healthy',
  reconnecting: 'reconnecting',
  portConflict: 'port-conflict',
  sessionLost: 'session-lost',
  stopped: 'stopped',
  failed: 'failed'
})

exports.getReconnectDelayMs = attempt => reconnectDelays[attempt] ?? null

exports.appendTunnelEvent = (health, event) => {
  const events = [...(health.events || []), {
    type: String(event.type || 'unknown'),
    at: Number(event.at) || Date.now(),
    code: String(event.code || ''),
    message: String(event.message || '').slice(0, 240)
  }].slice(-50)
  return {
    ...health,
    state: event.type === 'connection-lost' ? 'session-lost' : health.state,
    events,
    updatedAt: events.at(-1).at
  }
}
```

- [ ] **Step 4: 集成运行时被动事件和有限重连**

运行时入口只监听控制器/SSH 会话的 `error`、`close`、`listening` 等事件，不主动访问业务端口：

```js
function scheduleReconnect (entry) {
  const delay = getReconnectDelayMs(entry.reconnectAttempt)
  if (delay === null) {
    entry.health.state = 'failed'
    return
  }
  entry.health.state = 'reconnecting'
  entry.reconnectTimer = setTimeout(() => reconnect(entry), delay)
  entry.reconnectAttempt += 1
}
```

端口占用错误映射为 `port-conflict`；SSH 会话关闭映射为 `session-lost`；用户主动停止不得触发重连。

- [ ] **Step 5: 展示健康状态和事件历史**

```jsx
<Tag color={tunnelHealthPresentation[tunnel.state].color}>
  {tunnelHealthPresentation[tunnel.state].label}
</Tag>
<Button onClick={() => setHistoryTunnelId(tunnel.id)}>断线记录</Button>
```

历史行显示时间、事件、错误编号和有限的中文说明；不显示本地堆栈、凭据或完整连接对象。

- [ ] **Step 6: 运行隧道测试**

Run: `node --test test/unit-ci/ssh-tunnel-health.spec.js test/unit-ci/ssh-tunnel-runtime.spec.js test/unit-ci/ssh-tunnel-ui.spec.js`

Expected: PASS。

Run: `npx playwright test test/e2e/033.ssh-tunnel-manager.spec.js --workers=1`

Expected: PASS，覆盖启动、健康、端口冲突、SSH 断开、三次重连和手动停止。

- [ ] **Step 7: 提交隧道健康能力**

```powershell
git add src/app/server/ssh-tunnel-health.js src/app/server/ssh-tunnel-runtime.js src/app/server/ssh-tunnel.js src/client/components/ssh-tunnel test/unit-ci/ssh-tunnel-health.spec.js test/unit-ci/ssh-tunnel-runtime.spec.js test/unit-ci/ssh-tunnel-ui.spec.js test/e2e/033.ssh-tunnel-manager.spec.js
git commit -m "feat: track SSH tunnel health and disconnects"
```

### Task 5: AI 多文件统一差异审查

**Files:**
- Create: `src/client/components/ai/ai-file-change-set.js`
- Create: `src/client/components/ai/ai-file-change-review-modal.jsx`
- Create: `src/client/components/ai/ai-file-change-review-modal.styl`
- Modify: `src/client/components/ai/agent-tools.js`
- Modify: `src/client/components/sftp/sftp-transaction-adapter.js`
- Test: `test/unit-ci/ai-file-change-set.spec.js`
- Test: `test/unit-ci/ai-sftp-review-regressions.spec.js`
- Test: `test/unit-ci/ai-sftp-file-preview-safety.spec.js`

- [ ] **Step 1: 写变更集归一化和选择测试**

```js
test('file change set keeps bounded previews and per-file selection', () => {
  const changeSet = createAiFileChangeSet({
    id: 'set-1',
    files: [
      fileChange('/etc/nginx/nginx.conf', 'old', 'new'),
      fileChange('/etc/app/config.yml', 'a', 'b')
    ]
  })
  assert.equal(changeSet.files.length, 2)
  assert.equal(changeSet.files.every(file => file.selected), true)
  const toggled = setAiFileChangeSelected(changeSet, '/etc/app/config.yml', false)
  assert.equal(toggled.files[1].selected, false)
  assert.doesNotThrow(() => structuredClone(toggled))
})

test('file change set rejects stale remote fingerprint', () => {
  const result = validateAiFileChangeFingerprint(
    { size: 4, mtimeMs: 100, sha256: 'old' },
    { size: 4, mtimeMs: 101, sha256: 'new' }
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, 'AI_FILE_CHANGED_SINCE_REVIEW')
})
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node --test test/unit-ci/ai-file-change-set.spec.js`

Expected: FAIL，缺少新模块。

- [ ] **Step 3: 实现变更集模型**

```js
const maxPreviewChars = 200000

export function createAiFileChangeSet ({ id, files = [], createdAt = new Date().toISOString() }) {
  return {
    schemaVersion: 1,
    id: String(id || ''),
    status: 'reviewing',
    createdAt,
    files: files.map(file => ({
      path: String(file.path || ''),
      selected: file.selected !== false,
      originalFingerprint: { ...file.originalFingerprint },
      proposedFingerprint: { ...file.proposedFingerprint },
      diffPreview: String(file.diffPreview || '').slice(0, maxPreviewChars),
      truncated: String(file.diffPreview || '').length > maxPreviewChars,
      status: 'pending'
    }))
  }
}
```

- [ ] **Step 4: 把 Agent 文件写入改为收集变更集**

`agent-tools.js` 中的多文件写入不再逐文件立即执行：

```js
const changeSet = createAiFileChangeSet({
  id: generate(),
  files: preparedChanges.map(change => ({
    path: change.path,
    originalFingerprint: change.beforeFingerprint,
    proposedFingerprint: change.afterFingerprint,
    diffPreview: change.diff
  }))
})
return {
  type: 'ai-file-change-review',
  changeSet
}
```

只读文件读取仍走无确认快路径；新增、修改、删除必须进入统一审查。

- [ ] **Step 5: 实现左文件列表、右差异审查**

```jsx
<div className='ai-file-review-layout'>
  <aside>
    {changeSet.files.map(file => (
      <Checkbox
        key={file.path}
        checked={file.selected}
        onChange={event => onToggle(file.path, event.target.checked)}
      >
        {file.path}
      </Checkbox>
    ))}
  </aside>
  <main>
    <SftpTextChangePreview change={activeFile} />
  </main>
</div>
```

底部显示“将修改 N 个文件”“取消”“创建恢复点并执行”；窄窗口改为上下布局，不嵌套卡片。

- [ ] **Step 6: 用一个安全事务执行所选文件**

`sftp-transaction-adapter.js` 新增批量资源：

```js
const resources = selectedFiles.map(file => ({
  type: 'remote-file',
  path: file.path,
  fingerprint: file.originalFingerprint
}))
```

执行前逐个重新校验指纹；任一指纹变化则停止整个事务。每个成功文件保存独立恢复点；部分失败时任务状态为 `partially-completed`，仅允许回滚已修改文件。

- [ ] **Step 7: 运行 AI 文件审查测试**

Run: `node --test test/unit-ci/ai-file-change-set.spec.js test/unit-ci/ai-sftp-review-regressions.spec.js test/unit-ci/ai-sftp-file-preview-safety.spec.js test/unit-ci/sftp-safety-transaction.spec.js`

Expected: PASS，且大文件预览有明确“已截断”标记。

- [ ] **Step 8: 提交统一差异审查**

```powershell
git add src/client/components/ai src/client/components/sftp/sftp-transaction-adapter.js test/unit-ci/ai-file-change-set.spec.js test/unit-ci/ai-sftp-review-regressions.spec.js test/unit-ci/ai-sftp-file-preview-safety.spec.js
git commit -m "feat: review AI multi-file changes as one transaction"
```

### Task 6: 安全中心统一备份、恢复与任务记录

**Files:**
- Modify: `src/client/components/main/safety-operation-center-model.js`
- Modify: `src/client/components/main/safety-operation-center-modal.jsx`
- Modify: `src/client/components/main/safety-operation-center-actions.js`
- Modify: `src/client/components/main/safety-operation-center.styl`
- Modify: `src/client/common/safety-transactions/models.js`
- Test: `test/unit-ci/safety-operation-center.spec.js`
- Test: `test/unit-ci/safety-operation-center-actions.spec.js`
- Test: `test/unit-ci/safety-operation-center-real-store.spec.js`

- [ ] **Step 1: 写统一分组和动作失败测试**

```js
test('safety center groups transfer, AI, tunnel, backup and legacy records', () => {
  const groups = groupSafetyCenterRecords({
    operations: [rollbackOperation('op-1')],
    agentTasks: [runningAgentTask('agent-1')],
    operationTasks: [
      operationTask('sftp-1', 'sftp-transfer', 'interrupted'),
      operationTask('tunnel-1', 'ssh-tunnel', 'running'),
      operationTask('ai-1', 'ai-file-change', 'completed'),
      operationTask('backup-1', 'manual-backup', 'completed')
    ],
    legacyRecords: [legacyRecord('legacy-1')]
  })
  assert.deepEqual(groups.recoverable.map(item => item.id), ['sftp-1', 'op-1'])
  assert.deepEqual(groups.executing.map(item => item.id), ['tunnel-1', 'agent-1'])
  assert.equal(groups.history.some(item => item.id === 'ai-1'), true)
  assert.equal(groups.legacy[0].id, 'legacy-1')
})
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node --test test/unit-ci/safety-operation-center.spec.js`

Expected: FAIL，现有 `groupSafetyCenterRecords` 不接收 `operationTasks`。

- [ ] **Step 3: 扩展聚合模型**

```js
export function groupSafetyCenterRecords ({
  operations = [],
  agentTasks = [],
  operationTasks = [],
  legacyRecords = []
} = {}) {
  const groups = {
    executing: [],
    recoverable: [],
    history: [],
    legacy: []
  }
  // 现代安全事务沿用完整性校验；SFTP interrupted/paused 进入 recoverable；
  // 隧道 running/reconnecting 进入 executing；终态进入 history；旧记录单列。
  return sortSafetyGroups(groups)
}
```

保持兼容旧函数调用形式，在一版迁移期内把旧参数转换为对象参数。

- [ ] **Step 4: 增加统一动作路由测试**

```js
test('safety action routes resume and rollback without exposing raw commands', async () => {
  const calls = []
  const actions = createSafetyCenterActions({
    resumeTransfer: id => calls.push(['resume-transfer', id]),
    rollbackOperation: id => calls.push(['rollback', id])
  })
  await actions.run({ id: 'sftp-1', action: 'resume-transfer' })
  await actions.run({ id: 'op-1', action: 'rollback-operation' })
  assert.deepEqual(calls, [
    ['resume-transfer', 'sftp-1'],
    ['rollback', 'op-1']
  ])
})
```

- [ ] **Step 5: 实现安全动作路由**

```js
const actionHandlers = {
  'resume-transfer': dependencies.resumeTransfer,
  'restart-transfer': dependencies.restartTransfer,
  'rollback-operation': dependencies.rollbackOperation,
  'rollback-ai-files': dependencies.rollbackAiFiles,
  'restore-backup': dependencies.restoreBackup,
  'stop-tunnel': dependencies.stopTunnel
}

async function run (request) {
  const handler = actionHandlers[request.action]
  if (typeof handler !== 'function') throw new Error('SAFETY_ACTION_UNSUPPORTED')
  return handler(request.id)
}
```

- [ ] **Step 6: 更新安全中心 UI**

四个页签固定为：

```js
[
  { key: 'executing', label: '进行中' },
  { key: 'recoverable', label: '可恢复' },
  { key: 'history', label: '历史记录' },
  { key: 'legacy', label: '旧版记录' }
]
```

记录行显示来源、服务器、时间、状态、摘要和可用按钮；恢复按钮必须调用适配器，禁止要求用户复制回滚命令。恢复完整性校验失败时禁用按钮并提供中文原因。

- [ ] **Step 7: 运行安全中心测试**

Run: `node --test test/unit-ci/safety-operation-center.spec.js test/unit-ci/safety-operation-center-actions.spec.js test/unit-ci/safety-operation-center-real-store.spec.js test/unit-ci/safety-transaction-store.spec.js`

Expected: PASS，旧记录仍可读，现代记录完整性检查不被绕过。

- [ ] **Step 8: 提交统一安全中心**

```powershell
git add src/client/components/main/safety-operation-center* src/client/common/safety-transactions/models.js test/unit-ci/safety-operation-center.spec.js test/unit-ci/safety-operation-center-actions.spec.js test/unit-ci/safety-operation-center-real-store.spec.js
git commit -m "feat: unify operation recovery records"
```

### Task 7: 恢复启动、容量限制和模块异常保护

**Files:**
- Modify: `src/client/common/operation-tasks/task-store.js`
- Modify: `src/client/components/main/main.jsx`
- Modify: `src/client/components/file-transfer/transfer.jsx`
- Test: `test/unit-ci/operation-task-retention.spec.js`
- Test: `test/e2e/028.crash-recovery.spec.js`

- [ ] **Step 1: 写容量和恢复提示失败测试**

```js
test('retention keeps active tasks and only the newest 500 final tasks', async () => {
  const adapter = populatedAdapter({
    active: 3,
    final: 700
  })
  await pruneOperationTasks({ adapter, maxFinalRecords: 500 })
  const records = await adapter.find('operationTasks', {})
  assert.equal(records.filter(item => !isFinalOperationTask(item)).length, 3)
  assert.equal(records.filter(isFinalOperationTask).length, 500)
})
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node --test test/unit-ci/operation-task-retention.spec.js`

Expected: FAIL，缺少 `pruneOperationTasks`。

- [ ] **Step 3: 实现容量清理**

```js
export async function pruneOperationTasks ({
  adapter = defaultAdapter,
  maxFinalRecords = 500
} = {}) {
  const records = await adapter.find(taskTable, {})
  const finalRecords = records
    .filter(isFinalOperationTask)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  const removable = finalRecords.slice(maxFinalRecords)
  await Promise.all(removable.map(record => adapter.remove(taskTable, { id: record.id })))
  return removable.length
}
```

- [ ] **Step 4: 在启动恢复中隔离失败**

```js
async function restoreOperationTasks () {
  try {
    await markUnfinishedOperationTasksInterrupted()
    await pruneOperationTasks()
  } catch (error) {
    window.store?.recordQualityEvent?.({
      module: 'operation-tasks',
      action: 'restore-failed',
      code: String(error.code || 'OPERATION_TASK_RESTORE_FAILED')
    })
  }
}
```

该错误只影响任务历史，不得阻塞标签页、SSH 终端或 SFTP 连接。

- [ ] **Step 5: 增加崩溃恢复 E2E**

E2E 场景：

```js
await seedOperationTask(page, interruptedTransferFixture())
await relaunchApp()
await expect(page.getByText('上次传输已中断')).toBeVisible()
await expect(page.getByRole('button', { name: '继续传输' })).toBeVisible()
await expect(page.locator('.terminal')).toBeVisible()
```

- [ ] **Step 6: 运行恢复测试**

Run: `node --test test/unit-ci/operation-task-retention.spec.js`

Expected: PASS。

Run: `npx playwright test test/e2e/028.crash-recovery.spec.js --workers=1`

Expected: PASS，任务存储损坏场景不白屏，SSH 终端仍可打开。

- [ ] **Step 7: 提交恢复保护**

```powershell
git add src/client/common/operation-tasks/task-store.js src/client/components/main/main.jsx src/client/components/file-transfer/transfer.jsx test/unit-ci/operation-task-retention.spec.js test/e2e/028.crash-recovery.spec.js
git commit -m "fix: isolate operation recovery from SSH startup"
```

### Task 8: 真实服务器回归与性能门禁

**Files:**
- Modify: `test/e2e/030.real-server-regression.spec.js`
- Create: `test/e2e/034.operation-reliability.spec.js`
- Modify: `build/bin/smoke-ssh-sftp.js`
- Modify: `docs/testing.md`

- [ ] **Step 1: 增加隔离目录真实服务器测试**

使用现有 VPS 配置读取器，不把凭据写入测试、日志或快照。所有写操作限定在：

```text
/tmp/shellpilot-e2e/<trace-id>/
```

测试必须覆盖：

```js
test('real SFTP upload can pause, relaunch, resume, verify SHA256 and clean up', async () => {
  const fixture = await createRemoteTransferFixture({ sizeMiB: 16 })
  await fixture.startUpload()
  await fixture.pauseAfterBytes(4 * 1024 * 1024)
  await fixture.relaunchClient()
  await fixture.resumeUpload()
  await fixture.expectRemoteSha256Match()
  await fixture.cleanup()
})
```

- [ ] **Step 2: 运行真实服务器 SFTP 测试**

Run: `npm run test-real-server-e2e -- --grep "SFTP upload can pause"`

Expected: PASS；远端临时目录被删除，现有业务目录无改动。

- [ ] **Step 3: 增加隧道断线和 AI 审查 E2E**

`034.operation-reliability.spec.js` 使用 mock SSH runtime 验证隧道状态；AI 文件改动使用隔离远端临时文件，先审查后执行，再从安全中心一键回滚并校验 SHA-256。

- [ ] **Step 4: 运行可靠性 E2E**

Run: `npx playwright test test/e2e/034.operation-reliability.spec.js --workers=1`

Expected: PASS。

- [ ] **Step 5: 验证性能不退化**

Run: `npm run test-performance-e2e`

Expected: PASS；未连接首页、首个终端可用时间和内存指标不超过现有基线允许范围。普通 SSH 场景不加载 AI 差异审查和安全中心的重组件。

- [ ] **Step 6: 提交真实回归**

```powershell
git add test/e2e/030.real-server-regression.spec.js test/e2e/034.operation-reliability.spec.js build/bin/smoke-ssh-sftp.js docs/testing.md
git commit -m "test: cover reliable operations end to end"
```

### Task 9: 全量验证、版本一致性和本地候选包

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `build-config.js`
- Modify: `docs/releases/0.4.18.md`

- [ ] **Step 1: 运行完整单元测试**

Run: `npm run test-unit-ci`

Expected: 所有测试 PASS，0 failed。

- [ ] **Step 2: 运行核心 E2E**

Run: `npm run test-quality-e2e`

Expected: PASS。

Run: `npm run test-ssh-tunnel`

Expected: PASS。

Run: `npx playwright test test/e2e/018.file-transfer.spec.js test/e2e/028.crash-recovery.spec.js test/e2e/034.operation-reliability.spec.js --workers=1`

Expected: PASS。

- [ ] **Step 3: 运行安全和 SSH/SFTP smoke**

Run: `npm run smoke:ssh-sftp`

Expected: PASS。

Run: `npm run smoke:safety`

Expected: PASS。

Run: `npm run smoke:ai-takeover`

Expected: PASS。

- [ ] **Step 4: 运行 lint 和构建**

Run: `npm run lint`

Expected: exit code 0。

Run: `npm run build`

Expected: 构建成功，无缺失 chunk、未定义符号或本地绝对路径泄漏。

- [ ] **Step 5: 仅在全部验证通过后升级到 0.4.18**

同步修改 `package.json`、`package-lock.json`、构建资产名和关于页面版本号，随后运行：

Run: `node build/bin/assert-version-consistency.js`

Expected: `Version consistency check passed: 0.4.18`。

- [ ] **Step 6: 编写版本说明**

`docs/releases/0.4.18.md` 使用固定结构：

```markdown
# ShellPilot 0.4.18

## [新增]
- SFTP 上传/下载进度、暂停、继续和跨重启恢复。
- SSH 隧道健康状态、有限重连和断线记录。
- AI 多文件统一差异审查与选择执行。
- 安全中心统一展示备份、恢复和任务记录。

## [修复]
- 修复界面显示暂停但服务端仍可能继续传输的问题。
- 修复跨重启后传输记录丢失和临时文件无法继续的问题。

## [改动]
- 普通 SSH 使用保持轻量，可靠性模块仅在使用对应功能时加载。
```

- [ ] **Step 7: 构建本地候选包**

Run: `npm run b`

Expected: `dist/win-unpacked/ShellPilot.exe` 可启动。

Run: `npm run test-package-smoke`

Expected: PASS。

Run: `npm run verify-win-portable`

Expected: PASS。

- [ ] **Step 8: 验证候选资产，不发布在线更新**

Run: `npm run release:local:verify`

Expected: 本地安装包、blockmap、portable zip、`latest.yml` 和更新 JSON 版本均为 0.4.18，校验值一致。

- [ ] **Step 9: 提交候选版本**

```powershell
git add package.json package-lock.json build-config.js docs/releases/0.4.18.md
git commit -m "chore: prepare ShellPilot 0.4.18 local candidate"
```

## 自检结果

- 规格覆盖：SFTP 进度、暂停、会话继续、跨重启恢复、源/目标指纹、同目录临时文件、原子提交、文件夹汇总均由 Task 2、3、7、8 覆盖。
- 规格覆盖：隧道健康状态、端口冲突、SSH 会话丢失、有限重连和 50 条断线历史由 Task 4 覆盖。
- 规格覆盖：AI 多文件统一审查、逐文件选择、指纹复核、部分完成和选择性回滚由 Task 5、6 覆盖。
- 规格覆盖：安全中心现代事务、旧回滚、SFTP、隧道、AI 和手动备份聚合由 Task 6 覆盖。
- 性能与安全：Task 1、7 限制持久化字段和历史数量；Task 8、9 验证普通 SSH 启动、内存和全量回归。
- 发布约束：Task 9 只生成 0.4.18 本地候选，不执行 GitHub、魔塔或客户端在线发布。
- 占位符扫描：未发现未定义步骤、待补内容或跨任务省略引用。
- 类型一致性：统一使用 `operationTaskKinds`、`operationTaskStatuses`、`operationTasks` 表、`interrupted` 状态和 `resume-transfer` 动作名。
