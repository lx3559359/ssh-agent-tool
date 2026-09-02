# ShellPilot VPS Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复真实 VPS 上受控 PTY 永久等待与终端残留状态，并让同一 SSH 会话内的 SFTP 重开和刷新获得即时、可信的界面反馈。

**Architecture:** 受控 PTY 改为单一顶层 Shell 命令，并在本地终端 WebSocket 上增加版本握手和不含命令正文的确认状态；客户端只有收到兼容能力和 `accepted` 后才进入任务执行等待。SFTP 使用独立、纯内存、按会话身份隔离的 TTL/LRU 目录缓存和请求合并器，渲染缓存但始终后台读取服务器权威结果。

**Tech Stack:** Electron、React class components、Node.js、`@electerm/ssh2`、WebSocket、xterm.js、Playwright、Node test runner、StandardJS。

**执行前提：** 所有 Run 命令默认从 `F:\SSH工具开发\.worktrees\release-v0.4.48-verify\apps\electerm-agent` 执行。首次实施先运行 `npm ci`，确认 exit 0；不得在主工作树 `F:\SSH工具开发` 中执行依赖安装、修改或提交。

---

## 文件结构与职责

- `apps/electerm-agent/src/client/components/operations-toolkit/runtime/pty-task-protocol.js`：构建单一顶层受控命令，解析可信任务边界。
- `apps/electerm-agent/src/app/server/terminal-control-message.js`：校验终端控制消息，构造能力和状态响应。
- `apps/electerm-agent/src/app/server/managed-terminal-input.js`：分块写入、背压、取消以及写入终态。
- `apps/electerm-agent/src/app/server/managed-terminal-channel.js`：新增；把已校验的控制消息映射到 writer，并发送单调状态。
- `apps/electerm-agent/src/app/server/session-server.js`：把终端 WebSocket 控制消息委托给 managed channel，禁止无效内部消息落入 PTY。
- `apps/electerm-agent/src/client/components/terminal/managed-terminal-transport.js`：新增；客户端能力握手、请求 ID、2 秒确认门禁和状态 Promise。
- `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js`：接收控制响应、绑定回显抑制与受控 transport。
- `apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js`：只在 transport 接受后启动任务计时，并统一清理提交记录。
- `apps/electerm-agent/src/client/components/terminal/terminal.jsx`：把 transport readiness 纳入 PTY 租约获取。
- `apps/electerm-agent/src/client/components/sftp/remote-directory-cache.js`：新增；30 秒 TTL、32 路径 LRU、按键请求合并和诊断计数。
- `apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx`：接入目录缓存、刷新状态和性能采样。
- `apps/electerm-agent/src/client/components/sftp/sftp.styl`：刷新/缓存/失败状态样式。
- `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`：中英文 SFTP 状态文本。
- `apps/electerm-agent/src/client/common/quality/quality-events.js`、`apps/electerm-agent/src/app/lib/quality/performance-metrics.js`：允许并记录新增低频性能指标。
- `apps/electerm-agent/test/e2e/040.real-server-responsiveness.spec.js`：新增；三轮真实 VPS 交互与性能门禁。
- `apps/electerm-agent/docs/releases/v0.4.49.md`、`package.json`、`package-lock.json`：候选版本与发布说明；不在本计划内推送或发布远端 Release。

### Task 1: 让 PTY 包装器只产生一个顶层命令

**Files:**
- Modify: `apps/electerm-agent/src/client/components/operations-toolkit/runtime/pty-task-protocol.js:21-49`
- Test: `apps/electerm-agent/test/unit-ci/operations-toolkit-pty-protocol.spec.js:22-45`

- [ ] **Step 1: 写入会失败的单一命令测试**

在现有 `PTY wrapper probes effective identity...` 测试后加入：

```js
test('PTY wrapper exposes one exact top-level command to shell integration', async () => {
  const { buildPtyTaskCommand } = await importModule(protocolModule)
  const command = buildPtyTaskCommand({
    token: '9'.repeat(48),
    script: "printf 'managed output\\n'; uname -s"
  })

  assert.match(command, /^sh -c '/)
  assert.equal(command.includes('\n'), false)
  assert.equal(command.slice(5).startsWith("'"), true)
  assert.equal(command.endsWith("'"), true)
  assert.match(command, /SHELLPILOT_OPS/)
  assert.doesNotMatch(command, /^__sp_token=/)
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test test/unit-ci/operations-toolkit-pty-protocol.spec.js`

Expected: FAIL，当前命令以 `__sp_token=` 开头。

- [ ] **Step 3: 最小化修改命令构建器**

把当前数组先构造成子 Shell body，再用已有 `shellQuote` 包裹：

```js
export function buildPtyTaskCommand ({ token: providedToken, script }) {
  const token = assertPtyTaskToken(providedToken)
  const encodedScript = encodeUtf8Base64(script)
  const marker = `\\033]${markerOsc};${markerName};%s`
  const body = [
    `__sp_token=${shellQuote(token)};`,
    `__sp_script=${shellQuote(encodedScript)};`,
    '__sp_status=125;',
    'if __sp_uid="$(id -u 2>/dev/null)" && __sp_user="$(id -un 2>/dev/null)" && [ -n "$__sp_uid" ] && [ -n "$__sp_user" ]; then',
    '  __sp_uid64="$(printf %s "$__sp_uid" | base64 | tr -d "\\r\\n")";',
    '  __sp_user64="$(printf %s "$__sp_user" | base64 | tr -d "\\r\\n")";',
    `  printf '${marker};start;%s;%s\\007' "$__sp_token" "$__sp_uid64" "$__sp_user64";`,
    '  printf %s "$__sp_script" | base64 -d | sh;',
    '  __sp_status=$?;',
    `  printf '${marker};end;%s\\007' "$__sp_token" "$__sp_status";`,
    'else',
    '  printf "无法识别当前 Shell 有效身份\\n";',
    'fi;',
    'exit "$__sp_status"'
  ].join(' ')
  return `sh -c ${shellQuote(body)}`
}
```

- [ ] **Step 4: 运行协议和控制器测试**

Run: `node --test test/unit-ci/operations-toolkit-pty-protocol.spec.js test/unit-ci/managed-pty-task-controller.spec.js`

Expected: PASS；若旧断言仍查找 `sh -c "exit`，将其改为断言结尾包含 `exit "$__sp_status"`。

- [ ] **Step 5: 提交**

```bash
git add apps/electerm-agent/src/client/components/operations-toolkit/runtime/pty-task-protocol.js apps/electerm-agent/test/unit-ci/operations-toolkit-pty-protocol.spec.js
git commit -m "fix: expose one tracked PTY command"
```

### Task 2: 定义不会落入终端的受控输入协议

**Files:**
- Modify: `apps/electerm-agent/src/app/server/terminal-control-message.js`
- Test: `apps/electerm-agent/test/unit-ci/terminal-control-message.spec.js`

- [ ] **Step 1: 添加协议版本、状态和无效内部消息测试**

```js
test('marked invalid controls are consumed instead of becoming terminal input', () => {
  const parsed = parseTerminalControlMessage(JSON.stringify({
    __aigshellTerminalControl: true,
    action: 'managed-input',
    requestId: 'invalid',
    command: 'printf forged'
  }))
  assert.deepEqual(parsed, {
    __aigshellTerminalControl: true,
    action: 'invalid-control'
  })
})

test('builds bounded capability and managed input status messages', () => {
  assert.deepEqual(JSON.parse(buildManagedInputCapabilities()), {
    __aigshellTerminalControl: true,
    action: 'managed-input-capabilities',
    protocolVersion: 2
  })
  assert.deepEqual(JSON.parse(buildManagedInputStatus('a'.repeat(32), 'accepted')), {
    __aigshellTerminalControl: true,
    action: 'managed-input-status',
    requestId: 'a'.repeat(32),
    status: 'accepted'
  })
  assert.throws(
    () => buildManagedInputStatus('a'.repeat(32), 'command-body'),
    /status/
  )
})
```

同步扩展测试文件的 require：

```js
const {
  buildManagedInputCapabilities,
  buildManagedInputStatus,
  parseTerminalControlMessage
} = require('../../src/app/server/terminal-control-message')
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test test/unit-ci/terminal-control-message.spec.js`

Expected: FAIL，构造函数不存在，且无效标记消息当前返回 `null`。

- [ ] **Step 3: 实现协议合同**

在 `terminal-control-message.js` 中加入以下常量和构造函数，并让所有带内部 flag 的无效 JSON 返回 `invalid-control`：

```js
const managedInputProtocolVersion = 2
const managedInputStatuses = new Set([
  'accepted',
  'written',
  'rejected',
  'interrupted'
])

function buildTerminalControlMessage (action, fields = {}) {
  return JSON.stringify({
    [terminalControlFlag]: true,
    action,
    ...fields
  })
}

function buildManagedInputCapabilities () {
  return buildTerminalControlMessage('managed-input-capabilities', {
    protocolVersion: managedInputProtocolVersion
  })
}

function buildManagedInputStatus (requestId, status) {
  if (!managedRequestIdPattern.test(String(requestId || ''))) {
    throw new Error('managed input requestId is invalid')
  }
  if (!managedInputStatuses.has(status)) {
    throw new Error('managed input status is invalid')
  }
  return buildTerminalControlMessage('managed-input-status', {
    requestId,
    status
  })
}
```

把 `managed-input-capabilities-request` 加入允许的入站 action；JSON 带 `terminalControlFlag` 但 action/字段不合法时返回：

```js
return {
  [terminalControlFlag]: true,
  action: 'invalid-control'
}
```

导出协议版本和两个 builder。把现有“未知 action 返回 `null`”测试拆成两类：没有内部 flag 的普通 JSON 仍返回 `null`；带内部 flag 的未知或无效 action 必须返回 `invalid-control`，防止内部消息落入远端 PTY。

- [ ] **Step 4: 运行测试和 StandardJS**

Run: `node --test test/unit-ci/terminal-control-message.spec.js && npx standard src/app/server/terminal-control-message.js test/unit-ci/terminal-control-message.spec.js`

Expected: PASS，无 lint 输出。

- [ ] **Step 5: 提交**

```bash
git add apps/electerm-agent/src/app/server/terminal-control-message.js apps/electerm-agent/test/unit-ci/terminal-control-message.spec.js
git commit -m "feat: version managed terminal controls"
```

### Task 3: 让服务器明确确认、拒绝和中断写入

**Files:**
- Modify: `apps/electerm-agent/src/app/server/managed-terminal-input.js`
- Create: `apps/electerm-agent/src/app/server/managed-terminal-channel.js`
- Modify: `apps/electerm-agent/src/app/server/session-server.js:37-43,119-123,292-343`
- Modify: `apps/electerm-agent/test/unit-ci/managed-terminal-input.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/managed-terminal-channel.spec.js`

- [ ] **Step 1: 把 writer 测试改为同步接收 handle**

首个测试应使用：

```js
const submission = writer.submit({
  requestId: 'a'.repeat(32),
  command
})
assert.equal(submission.requestId, 'a'.repeat(32))
assert.equal(typeof submission.completion.then, 'function')
drain.resolve()
assert.deepEqual(await submission.completion, {
  requestId: 'a'.repeat(32),
  status: 'written'
})
```

中断测试应断言：

```js
const submission = writer.submit({
  requestId: 'b'.repeat(32),
  command
})
assert.equal(writer.interrupt(), true)
pacing.resolve()
assert.deepEqual(await submission.completion, {
  requestId: 'b'.repeat(32),
  status: 'interrupted'
})
```

再加入重复请求拒绝测试：

```js
assert.equal(writer.submit({
  requestId: 'c'.repeat(32),
  command: 'second'
}), null)
```

- [ ] **Step 2: 运行 writer 测试并确认 RED**

Run: `node --test test/unit-ci/managed-terminal-input.spec.js`

Expected: FAIL，当前 `submit()` 返回 Promise 而非 handle。

- [ ] **Step 3: 重构 writer 返回值**

把 `submit` 改为非 async 函数，校验失败返回 `null`，接受时立即设置 `active` 并返回冻结 handle：

```js
function submit ({ requestId, command } = {}) {
  if (disposed || active || !managedRequestIdPattern.test(requestId) ||
    typeof command !== 'string' || !command.length ||
    Buffer.byteLength(command) > maxManagedCommandBytes) {
    return null
  }
  const operation = {
    requestId,
    cancelled: false,
    cancellation: createCancellationSignal()
  }
  active = operation
  const completion = (async () => {
    try {
      const chunks = splitUtf8Chunks(command, chunkBytes)
      for (const chunk of chunks) {
        if (operation.cancelled || disposed) break
        const accepted = term.write(chunk)
        if (accepted === false && typeof term.waitForWriteDrain === 'function') {
          await waitUnlessCancelled(term.waitForWriteDrain(), operation)
        }
        if (!operation.cancelled && !disposed) {
          await waitUnlessCancelled(pause(pacingMs), operation)
        }
      }
      if (!operation.cancelled && !disposed) {
        term.write('\r')
        return { requestId, status: 'written' }
      }
      return { requestId, status: 'interrupted' }
    } finally {
      if (active === operation) active = null
    }
  })()
  return Object.freeze({ requestId, completion })
}
```

- [ ] **Step 4: 写 managed channel 失败测试**

新测试构造假 writer 和 `send`，覆盖：能力请求立即返回版本；接受请求依次发送 `accepted/written`；第二个并发请求只发 `rejected`；`invalid-control` 被消费且不会调用 `term.write`。

核心断言：

```js
assert.equal(channel.handle({
  __aigshellTerminalControl: true,
  action: 'managed-input-capabilities-request'
}), true)
assert.equal(channel.handle(validRequest), true)
await submissionGate.promise
assert.deepEqual(sent.map(message => JSON.parse(message).status).filter(Boolean), [
  'accepted',
  'written'
])
assert.equal(terminalWrites.length, 0)
```

- [ ] **Step 5: 实现并接入 managed channel**

`managed-terminal-channel.js` 导出：

```js
function createManagedTerminalChannel ({ writer, send }) {
  const sendStatus = (requestId, status) => {
    send(buildManagedInputStatus(requestId, status))
  }
  return Object.freeze({
    handle (control) {
      if (!control || typeof control !== 'object') return false
      if (control.action === 'invalid-control') return true
      if (control.action === 'managed-input-capabilities-request') {
        send(buildManagedInputCapabilities())
        return true
      }
      if (control.action === 'managed-input') {
        const submission = writer.submit(control)
        if (!submission) {
          sendStatus(control.requestId, 'rejected')
          return true
        }
        sendStatus(submission.requestId, 'accepted')
        submission.completion.then(result => {
          sendStatus(result.requestId, result.status)
        }).catch(() => {
          sendStatus(submission.requestId, 'rejected')
        })
        return true
      }
      if (control.action === 'managed-input-interrupt') {
        writer.interrupt()
        return true
      }
      return false
    },
    dispose: () => writer.dispose()
  })
}
```

文件顶部显式引入 `buildManagedInputCapabilities` 和 `buildManagedInputStatus`；测试直接注入 writer 和 send，不依赖真实 WebSocket。

`session-server.js` 创建 channel 时传入 `send: message => ws.send(message)`；消息处理先调用 `parseTerminalControlMessage(msg)`，只要 channel 返回 `true` 就 `return`，关闭时调用 `channel.dispose()`。不得再让 `invalid-control` 执行 `term.write(msg)`。

- [ ] **Step 6: 运行服务器侧测试**

Run: `node --test test/unit-ci/managed-terminal-input.spec.js test/unit-ci/managed-terminal-channel.spec.js test/unit-ci/terminal-control-message.spec.js`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/electerm-agent/src/app/server/managed-terminal-input.js apps/electerm-agent/src/app/server/managed-terminal-channel.js apps/electerm-agent/src/app/server/session-server.js apps/electerm-agent/test/unit-ci/managed-terminal-input.spec.js apps/electerm-agent/test/unit-ci/managed-terminal-channel.spec.js
git commit -m "feat: acknowledge managed terminal input"
```

### Task 4: 增加客户端握手和 2 秒确认门禁

**Files:**
- Create: `apps/electerm-agent/src/client/components/terminal/managed-terminal-transport.js`
- Create: `apps/electerm-agent/test/unit-ci/managed-terminal-transport.spec.js`
- Modify: `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js:1-75,206-218,512-545,683-707`

- [ ] **Step 1: 写 transport 的失败测试**

测试使用可控 timer 和 `send` 数组，覆盖未握手拒绝、版本 2 就绪、`accepted/written`、`rejected`、2 秒确认超时和 dispose：

```js
const transport = createManagedTerminalTransport({
  send: message => sent.push(message),
  createRequestId: () => 'f'.repeat(32),
  ackTimeoutMs: 20
})
transport.requestCapabilities()
assert.equal(sent[0].action, 'managed-input-capabilities-request')
transport.handleControlMessage({
  action: 'managed-input-capabilities',
  protocolVersion: 2
})
await transport.ready()
const submission = transport.submit('printf managed')
transport.handleControlMessage({
  action: 'managed-input-status',
  requestId: submission.requestId,
  status: 'accepted'
})
await submission.accepted
transport.handleControlMessage({
  action: 'managed-input-status',
  requestId: submission.requestId,
  status: 'written'
})
assert.equal(await submission.written, true)
```

另一个实例不回状态并断言：

```js
await assert.rejects(submission.accepted, error => (
  error.name === 'ManagedInputTransportError' &&
  /确认超时/.test(error.message)
))
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test test/unit-ci/managed-terminal-transport.spec.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现纯 transport 模块**

模块导出 `managedInputProtocolVersion = 2` 和 `createManagedTerminalTransport`。实现要求：

```js
function createRequestId () {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function transportError (message) {
  const error = new Error(message)
  error.name = 'ManagedInputTransportError'
  return error
}
```

内部维护 `protocolVersion`、一个 readiness deferred 和 `pending` Map。`submit(command)` 只在版本为 2 时创建请求；返回冻结对象 `{ requestId, accepted, written }`。`accepted` timer 固定 2000ms；收到 `accepted` 时只解析一次 accepted、清除确认 timer，并以 `now() - sentAt` 调用一次可选 `recordAck`；收到 `rejected` 时两个 Promise 同时拒绝；收到 `interrupted` 时 `accepted` 保持成功、`written` 以 `AbortError` 拒绝；`written`、`rejected`、`interrupted` 都从 pending 删除请求；`dispose()` 拒绝所有 pending 并清 timer。`handleControlMessage` 只消费 protocol version 2 的能力响应以及 requestId/status 均通过本地 allowlist 校验的状态响应。

- [ ] **Step 4: 接入 AttachAddonCustom**

构造器增加 `this.managedPtyTransport = null`。`activate()` 在注册 message listener 后创建 transport 并请求能力：

```js
this.managedPtyTransport = createManagedTerminalTransport({
  send: message => {
    const { action, ...fields } = message
    this._sendTerminalControl(action, fields)
  },
  recordAck: durationMs => {
    recordPerformanceDuration('managed_input_ack_ms', durationMs, {
      outcome: 'accepted'
    })
  }
})
this.managedPtyTransport.requestCapabilities()
```

`onMsg` 在写入终端前解析字符串 JSON；若 `handleControlMessage(message)` 返回 true，立即返回。增加：

```js
ensureManagedPtyTransportReady = () => {
  if (!this.managedPtyTransport) {
    throw new Error('受控终端输入通道尚未初始化')
  }
  return this.managedPtyTransport.ready()
}
```

`submitManagedPtyCommand` 保留现有回显抑制，但返回 `transport.submit(command)` 的 handle；异常时调用 `cancelManagedPtyEchoSuppression()`。`interruptManagedPtyCommand` 调用 transport 的 `interrupt()`。`dispose()` 最先 dispose transport。

- [ ] **Step 5: 运行 transport、性能和源码合同测试**

Run: `node --test test/unit-ci/managed-terminal-transport.spec.js test/unit-ci/performance-metrics.spec.js test/unit-ci/managed-pty-task-controller.spec.js`

Expected: transport 测试 PASS；现有控制器测试仍 PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/electerm-agent/src/client/components/terminal/managed-terminal-transport.js apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js apps/electerm-agent/test/unit-ci/managed-terminal-transport.spec.js
git commit -m "feat: gate managed input on server acknowledgement"
```

### Task 5: 控制器只在确认后进入执行并保证清理

**Files:**
- Modify: `apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js:329-410`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal.jsx:152-176,1456-1495`
- Modify: `apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js:101-191,490-590`
- Test: `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js`

- [ ] **Step 1: 扩展 harness 并写确认失败测试**

harness 的 `submitCommand` 返回可控 handle：

```js
const acceptedGate = options.acceptedGate || deferred()
const writtenGate = options.writtenGate || deferred()
if (!options.acceptedGate) acceptedGate.resolve(true)
if (!options.writtenGate) writtenGate.resolve(true)

submitCommand: command => {
  if (options.submitCommand === false) return false
  submissions.at(-1).submittedCommand = command
  return Object.freeze({
    requestId: 'f'.repeat(32),
    accepted: acceptedGate.promise,
    written: writtenGate.promise
  })
}
```

新增测试断言 transport rejection 立即清理，不发 Ctrl+C，不残留 expected submission：

```js
const acceptedGate = deferred()
const harness = await createControllerHarness({ acceptedGate })
const lease = await harness.controller.acquire('transport-reject')
const running = lease.execute({ script: 'id', timeoutMs: 1000 })
acceptedGate.reject(Object.assign(new Error('受控输入确认超时'), {
  name: 'ManagedInputTransportError'
}))
await assert.rejects(running, /确认超时/)
assert.equal(harness.cancelledSubmissions.length, 1)
assert.equal(harness.interrupts, 0)
assert.equal(await lease.release(), true)
```

- [ ] **Step 2: 运行并确认 RED**

Run: `node --test test/unit-ci/managed-pty-task-controller.spec.js`

Expected: FAIL，当前控制器只接受布尔提交结果。

- [ ] **Step 3: 接受 transport handle 并延后任务计时**

在 execution 结构增加 `transport` 和 `transportAccepted`。提交后验证 handle：

```js
const transport = submitCommand(command)
if (!transport || typeof transport.accepted?.then !== 'function' ||
  typeof transport.written?.then !== 'function') {
  throw new Error('PTY 运维命令未能发送')
}
execution.transport = transport
Promise.resolve(transport.accepted).then(() => {
  if (execution.settled || execution.cancelRequested) return
  execution.submitted = true
  execution.transportAccepted = true
  execution.timeoutHandle = setTimer(
    () => requestCancellation(execution, 'timeout'),
    timeoutMs
  )
}).catch(error => {
  rejectExecution(execution, error, { cancelExpected: true })
})
Promise.resolve(transport.written).catch(error => {
  if (!execution.settled && !execution.cancelRequested) {
    requestCancellation(execution, error)
  }
})
```

若 signal 在 `accepted` 前触发，直接清理 token/抑制，不发送 Ctrl+C；`accepted` 后继续使用现有可信提示符恢复规则。所有 reject 路径都必须通过 `cleanupExecution` 删除 output listener 和 expected submission。

- [ ] **Step 4: 把 transport readiness 放在 tracker 快路径之前**

`terminal.jsx` 的 `ensureOperationsPtyTrackerReady` 开头改为：

```js
if (!this.term || !this.attachAddon || !this.pid || this.onClose) {
  throw new Error('当前终端未连接，运维任务尚未开始。')
}
await this.attachAddon.ensureManagedPtyTransportReady()
if (this.commandSafetyEntrypoint.hasPending()) {
  throw new Error('当前终端已有安全命令正在处理，请等待完成。')
}
if (this.isCommandSafetyTrackerReady()) return true
```

构造控制器时直接返回 AttachAddon handle，不再比较 `=== true`。

- [ ] **Step 5: 运行控制器和本地 SSH E2E**

Run: `node --test test/unit-ci/managed-pty-task-controller.spec.js && npx playwright test test/e2e/039.operations-pty-identity.spec.js --workers=1`

Expected: PASS；取消、超时、身份切换和内部回显隐藏断言全部通过。

- [ ] **Step 6: 提交**

```bash
git add apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js apps/electerm-agent/src/client/components/terminal/terminal.jsx apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js
git commit -m "fix: recover PTY tasks after transport failures"
```

### Task 6: 实现会话隔离的 SFTP TTL/LRU 缓存

**Files:**
- Create: `apps/electerm-agent/src/client/components/sftp/remote-directory-cache.js`
- Create: `apps/electerm-agent/test/unit-ci/remote-directory-cache.spec.js`

- [ ] **Step 1: 写缓存、LRU、隔离和合并失败测试**

```js
test('directory cache expires, caps LRU and coalesces identical requests', async () => {
  let now = 1000
  const cache = createRemoteDirectoryCache({
    now: () => now,
    ttlMs: 30000,
    maxEntries: 2
  })
  const key = buildRemoteDirectoryCacheKey({
    host: 'example.invalid',
    port: 22,
    username: 'root',
    sshSessionGeneration: 'session-1',
    channel: 'sftp',
    effectiveUsername: 'root',
    path: '/root'
  })
  let loads = 0
  const first = cache.runRequest(key, async () => {
    loads += 1
    await Promise.resolve()
    return [{ id: '1', name: 'a.txt' }]
  })
  const second = cache.runRequest(key, async () => {
    loads += 1
    return []
  })
  assert.equal(first, second)
  const value = await first
  cache.set(key, value)
  assert.deepEqual(value, [{ id: '1', name: 'a.txt' }])
  assert.equal(loads, 1)
  assert.equal(cache.get(key).value[0].name, 'a.txt')
  now += 30001
  assert.equal(cache.get(key), null)
  assert.equal(cache.stats().coalesced, 1)
})
```

再写两个测试：相同路径但不同 `sshSessionGeneration` 生成不同 key；`runRequest` rejection 释放 inflight 且不覆盖最近成功值。

- [ ] **Step 2: 运行并确认 RED**

Run: `node --test test/unit-ci/remote-directory-cache.spec.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现纯缓存模块**

导出：

```js
export const remoteDirectoryCacheTtlMs = 30 * 1000
export const remoteDirectoryCacheMaxEntries = 32

export function buildRemoteDirectoryCacheKey (identity = {}) {
  return [
    identity.sshSessionGeneration,
    identity.host,
    Number(identity.port || 22),
    identity.username,
    identity.channel,
    identity.effectiveUsername,
    identity.path
  ].map(value => String(value || '')).join('\u0000')
}
```

`createRemoteDirectoryCache` 内部使用 `entries` 和 `inflight` Map。`get` 校验 TTL 并通过 delete/set 更新 LRU；`set` 只保存 `value.map(item => ({ ...item }))`；`runRequest` 对相同 request key 返回同一 Promise、自动累计 `coalesced`，并在 settle 后只删除仍指向该 Promise 的 inflight 项，但不自动修改目录缓存；`clear` 同时清空两个 Map；`stats` 返回 `{ entries, inflight, coalesced }`。返回对象的完整公开接口固定为 `{ get, set, runRequest, clear, stats }`。

- [ ] **Step 4: 运行测试和 lint**

Run: `node --test test/unit-ci/remote-directory-cache.spec.js && npx standard src/client/components/sftp/remote-directory-cache.js test/unit-ci/remote-directory-cache.spec.js`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/electerm-agent/src/client/components/sftp/remote-directory-cache.js apps/electerm-agent/test/unit-ci/remote-directory-cache.spec.js
git commit -m "feat: add session-scoped SFTP directory cache"
```

### Task 7: 接入 SFTP 缓存、刷新状态和请求合并

**Files:**
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx:214-380,419-450,3061-3400,3870-3980`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp.styl:253-290`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-refresh-behavior.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-entry-lifecycle.spec.js`

- [ ] **Step 1: 写界面状态和单请求合同的失败测试**

在 `sftp-refresh-behavior.spec.js` 增加源码合同：

```js
test('SFTP cached refresh preserves visible rows and exposes live status', () => {
  const source = readSftpSource('sftp-entry.jsx')
  assert.match(source, /remoteDirectoryCache\.get\(cacheKey\)/)
  assert.match(source, /remoteRefreshState:\s*'cached-refreshing'/)
  assert.match(source, /shellpilotSftpShowingCachedRefreshing/)
  assert.doesNotMatch(
    source.slice(
      source.indexOf('applyCachedRemoteDirectory'),
      source.indexOf('remoteListUncoalesced')
    ),
    /remote:\s*\[\]/
  )
})

test('ordinary remote refresh does not schedule an unconditional second list', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('remoteListUncoalesced = async')
  const end = source.indexOf('updateRemoteList = async', start)
  const body = source.slice(start, end)
  assert.doesNotMatch(body, /replaceSftpEntryTimer\(this, 'timer5'/)
})
```

在生命周期测试添加 dispose 清理 cache 的断言。

- [ ] **Step 2: 运行并确认 RED**

Run: `node --test test/unit-ci/sftp-refresh-behavior.spec.js test/unit-ci/sftp-entry-lifecycle.spec.js`

Expected: FAIL，缓存状态和新方法不存在，且当前仍安排 1 秒补偿刷新。

- [ ] **Step 3: 在 Sftp 构造器和 state 中接入缓存**

构造器创建：

```js
this.remoteDirectoryCache = createRemoteDirectoryCache()
```

state 增加：

```js
remoteRefreshState: 'idle',
remoteRefreshError: ''
```

卸载、SSH 代次 rebind 和显式连接重置时调用 `remoteDirectoryCache.clear()`；不得跨代次复用列表。代次 rebind 的判断必须比较 `String(this.sshSessionGeneration || '')`，后端身份变化通过缓存键中的 `channel/effectiveUsername` 隔离。

- [ ] **Step 4: 拆分并合并 remoteList**

保留现有主体但改名为 `remoteListUncoalesced`。新增外层：

```js
remoteList = (...args) => {
  const [returnList = false, remotePathReal, oldPath, options = {}] = args
  const requestKey = this.buildRemoteListRequestKey({
    returnList,
    remotePath: remotePathReal || this.state.remotePath || '',
    commitList: options.commitList === true
  })
  return this.remoteDirectoryCache.runRequest(
    requestKey,
    () => this.remoteListUncoalesced(
      returnList,
      remotePathReal,
      oldPath,
      options
    )
  )
}
```

`buildRemoteListRequestKey` 只用于进行中请求的等价判断，必须包含会话代次、规范化 path、`returnList`、`commitList`，不能包含对象引用：

```js
buildRemoteListRequestKey = ({ returnList, remotePath, commitList }) => [
  String(this.sshSessionGeneration || ''),
  normalizeRemotePath(remotePath || ''),
  returnList ? 'return' : 'paint',
  commitList ? 'commit' : 'no-commit'
].join('\u0000')
```

在 `remoteListUncoalesced` 已解析 `remotePath` 且拿到当前 backend identity 后构造目录缓存键：

```js
const cacheKey = buildRemoteDirectoryCacheKey({
  sshSessionGeneration: String(this.sshSessionGeneration || ''),
  host: tab.host,
  port: tab.port || this.port || 22,
  username,
  channel: this.state.remoteFileIdentity?.channel || 'unknown',
  effectiveUsername: this.state.remoteFileIdentity?.effectiveUsername || '',
  path: normalizeRemotePath(remotePath)
})
const cached = this.remoteDirectoryCache.get(cacheKey)
if (cached && !returnList) {
  this.applyCachedRemoteDirectory(cached.value, generation, task)
}
```

`applyCachedRemoteDirectory` 必须复用现有树和选择集协调逻辑，不能清空可见列表：

```js
applyCachedRemoteDirectory = (remote, generation, task) => {
  const startedAt = performance.now()
  this.setState(prevState => {
    if (!generation.accepting ||
      !isCurrentRemoteFileGeneration(this, generation) ||
      !isCurrentSftpEntryRemoteTask(this, task)) return null
    return {
      remote,
      remoteFileTree: this.buildTree(remote, typeMap.remote),
      remoteLoading: false,
      remoteRefreshState: 'cached-refreshing',
      remoteRefreshError: '',
      selectedFiles: prevState.selectedType === typeMap.remote
        ? reconcileSelectedFileIds(
            prevState.remote,
            remote,
            prevState.selectedFiles
          )
        : prevState.selectedFiles
    }
  }, () => recordPerformanceDuration(
    'sftp_cached_paint_ms',
    performance.now() - startedAt,
    { outcome: 'completed' }
  ))
}
```

权威读取成功、`updateRemoteList` 完成且 generation/task 仍有效后调用 `remoteDirectoryCache.set(cacheKey, remote)`，主 setState 同时设 `remoteRefreshState: 'idle'`、`remoteRefreshError: ''`。catch 分支若本次命中过 cache，则 `remote` 继续使用 `oldRemote`、设置 `remoteRefreshState: 'stale-error'` 和规范化错误文本；未命中 cache 才沿用现有错误恢复。缓存值只用于列表展示，写操作及安全校验仍调用权威 backend。

删除当前每次成功列表后固定 1 秒执行的 `timer5` 补偿块。写操作需要校准时继续调用已有显式 `calibrateRemoteAfterSafeDelete` 或一次显式 `remoteList`。

- [ ] **Step 5: 增加刷新状态 UI 和文案**

`renderSftpPanelTitle` 在 heading 内增加：

```jsx
{remoteRefreshState !== 'idle'
  ? (
    <span
      className={`sftp-refresh-status is-${remoteRefreshState}`}
      role='status'
      aria-live='polite'
    >
      {e(remoteRefreshState === 'cached-refreshing'
        ? 'shellpilotSftpShowingCachedRefreshing'
        : remoteRefreshState === 'stale-error'
          ? 'shellpilotSftpShowingCachedRefreshFailed'
          : 'shellpilotSftpRefreshing')}
    </span>
    )
  : null}
```

中英文键：

```js
shellpilotSftpRefreshing: '正在刷新远端目录…',
shellpilotSftpShowingCachedRefreshing: '已显示缓存，正在刷新…',
shellpilotSftpShowingCachedRefreshFailed: '正在显示上次结果，刷新失败。'
```

英文分别为 `Refreshing remote directory…`、`Showing cached results while refreshing…`、`Showing the previous result because refresh failed.`。样式使用现有 muted/warning 颜色，不遮挡目录列表。

- [ ] **Step 6: 运行 SFTP 单测和质量 E2E**

Run: `node --test test/unit-ci/remote-directory-cache.spec.js test/unit-ci/sftp-refresh-behavior.spec.js test/unit-ci/sftp-entry-lifecycle.spec.js test/unit-ci/sftp-effective-file-routing.spec.js && npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1`

Expected: PASS；SFTP 安全删除、选择状态和生命周期门禁不回退。

- [ ] **Step 7: 提交**

```bash
git add apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx apps/electerm-agent/src/client/components/sftp/sftp.styl apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/sftp-refresh-behavior.spec.js apps/electerm-agent/test/unit-ci/sftp-entry-lifecycle.spec.js
git commit -m "perf: keep SFTP lists responsive during refresh"
```

### Task 8: 增加低敏性能指标和真实 VPS 三轮门禁

**Files:**
- Modify: `apps/electerm-agent/src/client/common/quality/quality-events.js:21-47`
- Modify: `apps/electerm-agent/src/app/lib/quality/performance-metrics.js:14-38`
- Modify: `apps/electerm-agent/src/client/store/operations-toolkit.js:137-165,184-205`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx`
- Modify: `apps/electerm-agent/test/unit-ci/performance-metrics.spec.js`
- Create: `apps/electerm-agent/test/e2e/040.real-server-responsiveness.spec.js`

- [ ] **Step 1: 写性能 allowlist 的失败测试**

扩展现有 renderer helper 测试：

```js
for (const name of [
  'managed_input_ack_ms',
  'operations_first_output_ms',
  'operations_total_ms',
  'first_sftp_ready_ms',
  'sftp_cached_paint_ms',
  'sftp_refresh_ms'
]) {
  assert.equal(await recordPerformanceDuration(name, 125, {
    outcome: 'completed'
  }), true)
}
assert.equal(calls.some(args => JSON.stringify(args).includes('/root')), false)
```

主进程测试向 `createPerformanceMetrics` 写入六个名称并断言 summary 中存在；带 `host`、`path`、`command` dimension 仍必须拒绝。

- [ ] **Step 2: 运行并确认 RED**

Run: `node --test test/unit-ci/performance-metrics.spec.js`

Expected: FAIL，新指标尚未在 renderer 和 main allowlist 中。

- [ ] **Step 3: 扩展指标 allowlist 并埋点**

将六个名称加入 `PERFORMANCE_DURATION_NAMES` 和 `DURATION_NAMES`。只允许现有低基数 dimensions。

`managed-terminal-transport` 从发送到 `accepted` 记录 `managed_input_ack_ms`。Operations runtime 在首次非空 step output 时记录 `operations_first_output_ms`，终态记录 `operations_total_ms`。SFTP 在第一次权威列表完成、缓存 setState callback 和权威刷新结束分别记录对应指标。缓存 `stats().coalesced` 只写入 E2E 附件，不持久化服务器/路径键。

- [ ] **Step 4: 编写三轮真实 VPS 测试**

新测试从与 `030.real-server-regression.spec.js` 相同的五个环境变量读取配置，限制 SFTP 写入根为 `/tmp`，但本文件只执行只读目录列表和可取消的 `sleep`。三个 serial 测试名称固定为：

```js
test('round 1 - terminal and operations recover without internal echo', async () => {})
test('round 2 - SFTP cache paints immediately and refreshes authoritatively', async () => {})
test('round 3 - cancellation reconnect and cache isolation stay usable', async () => {})
```

第一轮执行普通 `printf`、`system.overview`、`runbook.health.baseline`，断言任务完成、terminal buffer 不含 `__sp_`/`SHELLPILOT_OPS`、controller `busy()` 为 false、expected submissions 为 0。

第二轮量首次 SFTP ready、同路径缓存 setState callback 和三次权威 refresh；默认预算分别为 3000ms、100ms 和 3000ms。附件 `real-vps-sftp-responsiveness.json` 只含时长、条目数量和合并次数。

第三轮通过 `acquireOperationsPtyTask` 执行 `sleep 10`，200ms 后 abort；等待可信提示符，输入只读 marker，再触发 SSH 重连并重开 SFTP，断言新 `sshSessionGeneration` 不读取旧 cache key。

- [ ] **Step 5: 运行本地指标与本地 SSH 测试**

Run: `node --test test/unit-ci/performance-metrics.spec.js && npx playwright test test/e2e/039.operations-pty-identity.spec.js --workers=1`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/electerm-agent/src/client/common/quality/quality-events.js apps/electerm-agent/src/app/lib/quality/performance-metrics.js apps/electerm-agent/src/client/store/operations-toolkit.js apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx apps/electerm-agent/src/client/components/terminal/managed-terminal-transport.js apps/electerm-agent/test/unit-ci/performance-metrics.spec.js apps/electerm-agent/test/e2e/040.real-server-responsiveness.spec.js
git commit -m "test: enforce real VPS responsiveness budgets"
```

### Task 9: v0.4.49 候选版本、三轮实机验证与完整回归

**Files:**
- Modify: `apps/electerm-agent/package.json:3`
- Modify: `apps/electerm-agent/package-lock.json:3,9`
- Create: `apps/electerm-agent/docs/releases/v0.4.49.md`
- Test: all files changed above

- [ ] **Step 1: 更新候选版本并写发布说明**

Run: `npm version 0.4.49 --no-git-tag-version`

创建发布说明：

```markdown
# ShellPilot v0.4.49

## [修复]

- 修复真实高延迟 SSH 中受控 PTY 已执行但完成边界被回显抑制遮挡，导致运维任务超时和终端输入残留的问题。
- 修复无效或不兼容的内部终端控制消息可能静默等待的问题；现在会快速拒绝且不会写入远端 Shell。

## [优化]

- SFTP 同会话目录使用 30 秒内存缓存和同路径请求合并，重开目录立即显示最近结果并后台刷新。
- 刷新期间保留现有目录列表，并明确显示刷新、缓存和失败状态。
- 新增受控输入、运维任务和 SFTP 首屏/刷新性能指标及真实 VPS 三轮门禁。
```

- [ ] **Step 2: 运行定向和全量单测**

Run: `npm run lint && npm run test-unit-ci`

Expected: exit 0，所有 Node 测试 PASS。

- [ ] **Step 3: 运行本地 E2E 性能与核心流程**

Run: `npm run test-performance-e2e && npx playwright test test/e2e/027.quality-core-flows.spec.js test/e2e/039.operations-pty-identity.spec.js --workers=1`

Expected: exit 0；现有启动、内存、交互和安全流程预算全部通过。

- [ ] **Step 4: 使用授权的 VPS 信息分别执行三轮实机自检**

每轮都在同一 PowerShell 进程内解析 `F:\SSH工具开发\VPS服务器信息.txt`，不得输出密码：

```powershell
$pairs = @{}
Get-Content -LiteralPath 'F:\SSH工具开发\VPS服务器信息.txt' | ForEach-Object {
  $parts = $_.Trim() -split '\s+', 2
  if ($parts.Count -eq 2) { $pairs[$parts[0]] = $parts[1] }
}
$env:SHELLPILOT_E2E_HOST = $pairs['IP']
$env:SHELLPILOT_E2E_PORT = '22'
$env:SHELLPILOT_E2E_USERNAME = $pairs['账号']
$env:SHELLPILOT_E2E_PASSWORD = $pairs['密码']
$env:SHELLPILOT_E2E_REMOTE_ROOT = '/tmp'
npx playwright test test/e2e/040.real-server-responsiveness.spec.js --workers=1 --grep 'round 1'
npx playwright test test/e2e/040.real-server-responsiveness.spec.js --workers=1 --grep 'round 2'
npx playwright test test/e2e/040.real-server-responsiveness.spec.js --workers=1 --grep 'round 3'
```

Expected: 三条命令分别 exit 0；测试附件不含 IP、账号、密码、命令正文或远端路径。

- [ ] **Step 5: 运行完整真实服务器回归**

在同一个已设置环境变量的 PowerShell 会话运行：

Run: `npm run test-real-server-e2e`

Expected: PASS；`/tmp/.shellpilot-e2e-*` 沙箱在 finally 中清理，VPS 现有服务不变。

- [ ] **Step 6: 构建 Windows 候选包并做 smoke test**

Run: `npm run build && npm run package:win:dir && npm run test-package-smoke`

Expected: exit 0；生成的 unpacked `ShellPilot.exe` ProductVersion 为 `0.4.49.0`，包内不含源码测试文件或 VPS 凭据。

- [ ] **Step 7: 验证工作树、敏感信息与差异范围**

Run: `git diff --check && rg -n "SHELLPILOT_E2E_PASSWORD|VPS服务器信息|104\.129\.|23\.94\." . -g '!docs/superpowers/**' -g '!test/**' -g '!node_modules/**' -g '!work/**'`

Expected: `git diff --check` 无输出；生产文件不包含凭据文件名、真实 IP 或密码环境变量。

- [ ] **Step 8: 提交候选版本**

```bash
git add apps/electerm-agent/package.json apps/electerm-agent/package-lock.json apps/electerm-agent/docs/releases/v0.4.49.md
git commit -m "chore: prepare ShellPilot v0.4.49"
```

- [ ] **Step 9: 最终证据快照**

Run: `git status --short --branch && git log --oneline --decorate -12`

Expected: 工作树 clean，分支仅包含设计、计划、功能、测试和候选版本提交；不执行 push、merge、tag 或 GitHub Release。
