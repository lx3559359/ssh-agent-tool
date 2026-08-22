# Current Terminal Effective Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让运维诊断、场景脚本和抓包在当前交互式 PTY 中执行，从而继承 `su` 后的有效身份，同时保持 SSH/SFTP 登录身份、任务记录、安全确认和输出能力不变。

**Architecture:** 新增带随机 OSC 边界的 PTY 任务协议与每终端独占控制器；运维任务运行器在一次租约中完成身份/能力探测和全部步骤，输出从 AttachAddon 的远端数据流同步到面板。登录身份继续作为端点键，有效 UID/用户名仅作为本次 PTY 运行证据，不写回连接或 SFTP 配置。

**Tech Stack:** Electron、React、JavaScript ESM、xterm.js、OSC 633 Shell Integration、Node.js test runner、Playwright、本地 `@electerm/ssh2` fixture。

**Command roots:** 所有 `node`、`npm`、`npx` 命令均在 `apps/electerm-agent` 目录执行；所有 `git add`、`git commit`、`git diff`、`git status` 命令均在仓库工作树根目录执行。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `src/client/components/operations-toolkit/runtime/pty-task-protocol.js` | 构建 PTY 包装命令，解析随机 OSC 边界、有效身份、输出和退出码 |
| `src/client/components/terminal/managed-pty-task-controller.js` | 管理单终端独占租约、精确命令追踪、输出订阅、取消、超时和断线 |
| `src/client/components/terminal/attach-addon-custom.js` | 提供远端输出订阅，并在受控任务期间阻止普通输入、保留 Ctrl+C |
| `src/client/components/terminal/terminal.jsx` | 把 CommandTracker、AttachAddon 和受控 PTY 控制器接到当前终端实例 |
| `src/client/components/operations-toolkit/runtime/pty-task-channel.js` | 将运维运行器的任务租约映射到当前 SSH 终端实例 |
| `src/client/components/operations-toolkit/runtime/task-runner.js` | 在一个 PTY 租约中执行探测和全部步骤，记录有效身份 |
| `src/client/store/operations-toolkit.js` | 运行时改走 PTY；面板预探测仍走只读 SSH exec |
| `src/client/components/operations-toolkit/workspace/task-panel.jsx` | 同时展示登录用户和当前 Shell 身份 |
| `src/client/components/operations-toolkit/workspace/result-viewer.jsx` | 历史记录展示已保存的执行身份 |
| `src/client/common/shellpilot-i18n-overrides.js` | 中英文身份、PTY 占用和执行说明文案 |
| `test/e2e/common/local-ssh-server.js` | 模拟登录用户、`su root`、`exit` 和 PTY 任务协议 |
| `test/e2e/039.operations-pty-identity.spec.js` | 端到端验证 hik 登录、root Shell、抓包、退出 root 和 SFTP 身份隔离 |

旧的 `ssh-task-channel.js` 与 `remote-task-envelope.js` 暂时保留，避免影响尚未迁移的调用方；Store 不再用它们执行运维任务。

### Task 1: 建立随机边界 PTY 协议

**Files:**
- Create: `apps/electerm-agent/src/client/components/operations-toolkit/runtime/pty-task-protocol.js`
- Create: `apps/electerm-agent/test/unit-ci/operations-toolkit-pty-protocol.spec.js`

- [ ] **Step 1: 写入包装命令的失败测试**

```js
test('PTY wrapper probes effective identity and transports the script without raw interpolation', async () => {
  const { buildPtyTaskCommand, createPtyTaskToken } = await importModule(
    'src/client/components/operations-toolkit/runtime/pty-task-protocol.js'
  )
  const generatedTokens = new Set(Array.from({ length: 32 }, createPtyTaskToken))
  assert.equal(generatedTokens.size, 32)
  assert.equal([...generatedTokens].every(token => /^[a-f0-9]{48}$/.test(token)), true)
  const command = buildPtyTaskCommand({
    token: 'a'.repeat(32),
    script: "printf '%s\\n' root; exit 7"
  })
  assert.match(command, /id -u/)
  assert.match(command, /id -un/)
  assert.match(command, /base64 -d \| sh/)
  assert.match(command, /SHELLPILOT_OPS/)
  assert.doesNotMatch(command, /printf '%s\\n' root/)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/operations-toolkit-pty-protocol.spec.js`

Expected: FAIL，提示找不到 `pty-task-protocol.js`。

- [ ] **Step 3: 实现令牌校验、UTF-8 Base64 和包装命令**

```js
const tokenPattern = /^[a-f0-9]{32,128}$/
const markerName = 'SHELLPILOT_OPS'
const markerOsc = 697

function shellQuote (value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`
}

function encodeUtf8Base64 (value) {
  const bytes = new TextEncoder().encode(String(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function assertPtyTaskToken (value) {
  const token = String(value || '')
  if (!tokenPattern.test(token)) throw new Error('PTY 运维任务令牌无效')
  return token
}

export function createPtyTaskToken () {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('PTY 运维任务缺少安全随机源')
  }
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function buildPtyTaskCommand ({ token: providedToken, script }) {
  const token = assertPtyTaskToken(providedToken)
  const encodedScript = encodeUtf8Base64(script)
  const marker = `\\033]${markerOsc};${markerName};%s`
  return [
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
    'sh -c "exit $__sp_status"'
  ].join(' ')
}
```

- [ ] **Step 4: 运行包装命令测试并确认通过**

Run: `node --test test/unit-ci/operations-toolkit-pty-protocol.spec.js --test-name-pattern="PTY wrapper"`

Expected: PASS，1 test、0 failures。

- [ ] **Step 5: 写入流式解析器的失败测试**

```js
test('PTY parser accepts split markers and emits only bounded task output', async () => {
  const { createPtyTaskOutputParser } = await importModule(
    'src/client/components/operations-toolkit/runtime/pty-task-protocol.js'
  )
  const token = 'b'.repeat(32)
  const parser = createPtyTaskOutputParser({ token })
  const chunks = [
    `prompt\\r\\n\u001b]697;SHELLPILOT_OPS;${token};sta`,
    'rt;MA==;cm9vdA==\u0007hello\u001b[31m root\u001b[0m\\r\\n',
    `\u001b]697;SHELLPILOT_OPS;${token};end;0\u0007$ `
  ]
  const results = chunks.map(chunk => parser.push(chunk))
  assert.deepEqual(parser.identity(), { uid: '0', username: 'root' })
  assert.equal(results.flatMap(item => item.output).join(''), 'hello root\n')
  assert.equal(parser.exitCode(), 0)
})

test('PTY parser rejects wrong tokens duplicate boundaries and invalid identities', async () => {
  const { createPtyTaskOutputParser } = await importModule(
    'src/client/components/operations-toolkit/runtime/pty-task-protocol.js'
  )
  const token = 'c'.repeat(32)
  const parser = createPtyTaskOutputParser({ token })
  assert.throws(() => parser.push(
    `\u001b]697;SHELLPILOT_OPS;${'d'.repeat(32)};start;MA==;cm9vdA==\u0007`
  ), /令牌/)
  assert.equal(parser.identity(), null)
})
```

- [ ] **Step 6: 实现跨数据块解析、身份校验和 ANSI 清理**

实现并导出以下固定接口：

```js
export function createPtyTaskOutputParser ({ token: providedToken }) {
  const token = assertPtyTaskToken(providedToken)
  const prefix = `\u001b]697;SHELLPILOT_OPS;`
  let pending = ''
  let started = false
  let ended = false
  let effectiveIdentity = null
  let completedExitCode = null
  const sanitizer = createTerminalTextSanitizer()

  function push (chunk) {
    pending += String(chunk || '')
    const output = []
    while (pending) {
      const markerStart = pending.indexOf(prefix)
      if (markerStart < 0) {
        const flushLength = Math.max(0, pending.length - prefix.length + 1)
        const visible = pending.slice(0, flushLength)
        pending = pending.slice(flushLength)
        if (started && !ended && visible) {
          const clean = sanitizer.push(visible)
          if (clean) output.push(clean)
        }
        break
      }
      const visible = pending.slice(0, markerStart)
      if (started && !ended && visible) {
        const clean = sanitizer.push(visible)
        if (clean) output.push(clean)
      }
      pending = pending.slice(markerStart)
      const markerEnd = pending.indexOf('\u0007')
      if (markerEnd < 0) break
      const marker = pending.slice(prefix.length, markerEnd).split(';')
      pending = pending.slice(markerEnd + 1)
      if (marker[0] !== token) throw new Error('PTY 运维任务边界令牌不匹配')
      if (marker[1] === 'start') {
        if (started || ended || marker.length !== 4) throw new Error('PTY 运维任务开始边界无效')
        const uid = decodeUtf8Base64(marker[2])
        const username = decodeUtf8Base64(marker[3])
        if (!/^\d+$/.test(uid) || !/^[^\x00-\x1f\x7f]{1,256}$/.test(username)) {
          throw new Error('PTY 运维任务有效身份无效')
        }
        started = true
        effectiveIdentity = Object.freeze({ uid, username })
      } else if (marker[1] === 'end') {
        const exitCode = Number(marker[2])
        if (!started || ended || marker.length !== 3 || !/^\d+$/.test(marker[2]) ||
          !Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
          throw new Error('PTY 运维任务结束边界无效')
        }
        ended = true
        completedExitCode = exitCode
        const tail = sanitizer.finish()
        if (tail) output.push(tail)
      } else {
        throw new Error('PTY 运维任务边界阶段无效')
      }
    }
    return { output }
  }

  return Object.freeze({
    push,
    identity: () => effectiveIdentity,
    exitCode: () => completedExitCode,
    started: () => started,
    ended: () => ended
  })
}
```

同文件实现 `decodeUtf8Base64` 与有状态的 `createTerminalTextSanitizer`。清理器必须跨 `push` 保留未闭合的 CSI/OSC/单字符 ESC 后缀，删除完整控制序列，保留普通 UTF-8 文本，并把 `\r\n`、裸 `\r` 统一为 `\n`；不得逐块调用无状态正则。测试中加入 ANSI 序列跨块、中文跨块、OSC 非任务标记和 4 字节 UTF-8 字符，确保不泄漏控制字符或产生替换字符。

- [ ] **Step 7: 运行协议测试并确认通过**

Run: `node --test test/unit-ci/operations-toolkit-pty-protocol.spec.js`

Expected: PASS，全部协议测试通过、0 failures。

- [ ] **Step 8: 提交协议层**

```bash
git add apps/electerm-agent/src/client/components/operations-toolkit/runtime/pty-task-protocol.js apps/electerm-agent/test/unit-ci/operations-toolkit-pty-protocol.spec.js
git commit -m "feat(operations): define managed PTY task protocol"
```

### Task 2: 建立每终端独占 PTY 控制器

**Files:**
- Create: `apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js`
- Create: `apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js`

- [ ] **Step 1: 写入租约、身份和完成条件的失败测试**

使用注入适配器创建 harness，覆盖：

```js
test('one lease spans discovery and steps and resolves only after marker command finish and prompt', async () => {
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-1')
  const running = lease.execute({
    taskId: 'operations-1-discovery',
    script: 'id',
    timeoutMs: 1000,
    onChunk: chunk => harness.output.push(chunk)
  })
  assert.equal(harness.controller.isBusy(), true)
  await assert.rejects(
    harness.controller.acquire('operations-2'),
    /当前终端已有运维任务/
  )
  harness.emitManagedStart({ uid: '0', username: 'root' })
  harness.emitOutput('effective root\r\n')
  harness.emitManagedEnd(0)
  harness.emitCommandFinished(0)
  let settled = false
  running.then(
    () => { settled = true },
    () => { settled = true }
  )
  await Promise.resolve()
  assert.equal(settled, false)
  harness.emitPromptStarted()
  const result = await running
  assert.deepEqual(result.identity, { uid: '0', username: 'root' })
  assert.equal(result.exitCode, 0)
  await lease.release()
  assert.equal(harness.controller.isBusy(), false)
})
```

再加入以下独立测试：同一租约第二步身份由 root 变成 hik 时失败；缺少开始标记时脚本不得报告成功；非法退出码、重复完成和迟到输出被拒绝；不同 owner 不能复用租约。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/managed-pty-task-controller.spec.js`

Expected: FAIL，提示找不到 `managed-pty-task-controller.js`。

- [ ] **Step 3: 实现控制器固定接口**

```js
export function createManagedPtyTaskController ({
  ensureReady,
  getTerminalState,
  expectSubmission,
  armSubmission,
  cancelSubmission,
  submitCommand,
  interrupt,
  subscribeOutput,
  createToken
}) {
  let leaseOwner = ''
  let active = null
  let firstIdentity = null

  async function acquire (ownerId) {
    const owner = String(ownerId || '')
    if (!owner) throw new Error('PTY 运维任务缺少租约标识')
    if (leaseOwner) throw new Error('当前终端已有运维任务正在执行')
    leaseOwner = owner
    firstIdentity = null
    try {
      await ensureReady()
      assertRunnableTerminalState(getTerminalState())
    } catch (error) {
      if (leaseOwner === owner) leaseOwner = ''
      throw error
    }
    return Object.freeze({
      execute: options => execute(owner, options),
      release: () => release(owner)
    })
  }

  function handleCommandFinished (event) {
    if (!active || event.token !== active.submissionToken || event.command !== active.command) return false
    active.commandExitCode = event.exitCode
    settleIfComplete(active)
    return true
  }

  function handlePromptStarted () {
    if (!active) return false
    active.promptReturned = true
    settleIfComplete(active)
    return true
  }

  function handleUserInput (data) {
    if (!leaseOwner) return { handled: false }
    if (data === '\x03') {
      requestCancellation(active, 'user')
      return { handled: true, send: false }
    }
    return { handled: true, send: false }
  }

  async function invalidate (reason = '终端连接已断开') {
    const current = active
    leaseOwner = ''
    active = null
    firstIdentity = null
    if (current) rejectExecution(current, disconnectedError(reason))
  }

  return Object.freeze({
    acquire,
    handleCommandFinished,
    handlePromptStarted,
    handleUserInput,
    invalidate,
    isBusy: () => Boolean(leaseOwner),
    owner: () => leaseOwner
  })
}
```

在同文件实现这些内部函数并保持单一职责：

- `assertRunnableTerminalState`：要求普通 buffer、非密码提示、Shell Integration 已激活、处于空提示符。
- `execute`：创建协议 parser、订阅输出、绑定 AbortSignal、启动超时、精确 arm CommandTracker 后调用 `submitCommand`。
- `settleIfComplete`：普通完成要求开始标记、结束标记、相同退出码、CommandTracker 完成和新提示符；取消允许缺少结束标记，但必须收到 CommandTracker 完成和新提示符。
- `requestCancellation`：只调用一次 `interrupt()`；超时来源产生 `TimeoutError`，用户/Signal 来源产生 `AbortError`。
- 取消后另设有限恢复等待；仍收不到匹配的 CommandTracker 完成和新提示符时，抛出 `CancellationUnknownError`，保留 PTY 锁并停止后续命令。
- `release`：只允许 owner 释放；正常返回 `true`，若处于“取消结果未知”恢复态则返回 `false` 并保持锁，等待断线/重连时 `invalidate` 清理。
- `rejectExecution`：清理监听器、计时器和 submission token，且只 settle 一次。

- [ ] **Step 4: 写入取消、超时和断线的失败测试**

```js
test('abort sends one Ctrl+C and waits for tracked prompt recovery', async () => {
  const harness = await createControllerHarness()
  const controller = new AbortController()
  const lease = await harness.controller.acquire('operations-cancel')
  const running = lease.execute({
    taskId: 'operations-cancel-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: controller.signal
  })
  harness.emitManagedStart({ uid: '0', username: 'root' })
  controller.abort()
  controller.abort()
  assert.equal(harness.interrupts, 1)
  harness.emitCommandFinished(130)
  harness.emitPromptStarted()
  await assert.rejects(running, error => error.name === 'AbortError')
})
```

增加超时发送一次 Ctrl+C、Ctrl+C 后无提示符抛出 `CancellationUnknownError` 且 `release()` 返回 `false`、断线解除恢复锁并拒绝迟到 marker、正常释放时清理 output listener 的测试。

- [ ] **Step 5: 实现取消收敛并运行全部控制器测试**

Run: `node --test test/unit-ci/managed-pty-task-controller.spec.js`

Expected: PASS，租约、身份、输出、取消、超时和断线测试全部通过。

- [ ] **Step 6: 提交控制器**

```bash
git add apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js
git commit -m "feat(terminal): manage exclusive PTY operations"
```

### Task 3: 接入 AttachAddon、CommandTracker 和终端生命周期

**Files:**
- Modify: `apps/electerm-agent/src/client/components/terminal/shell.js:1-190`
- Modify: `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js:6-31,189-269,296-369,431-444`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal.jsx:120-180,265-303,320-333,1267-1315,1444-1467,1863-1871,1979-1988`
- Modify: `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js`

- [ ] **Step 1: 写入远端输出订阅与输入阻止的失败测试**

```js
test('AttachAddon publishes decoded remote output and blocks normal input during a managed PTY task', async () => {
  const { addon, sent, parent } = await createDirectAttachHarness()
  const output = []
  parent.handleManagedPtyInput = data => (
    data === '\x03'
      ? { handled: true, send: true }
      : { handled: true, send: false }
  )
  const subscription = addon.onRemoteOutput(chunk => output.push(chunk))
  addon.writeToTerminal('root output\r\n')
  addon.sendToServer('x')
  addon.sendToServer('\x03')
  subscription.dispose()
  assert.deepEqual(output, ['root output\r\n'])
  assert.deepEqual(sent, ['\x03'])
})
```

再加入二进制 UTF-8 跨 WebSocket 块时由独立流式 `TextDecoder` 只发布一次且不出现 `�`、dispose 后不再发布、无锁时输入行为不变的测试。

- [ ] **Step 2: 运行定向测试并确认失败**

Run: `node --test test/unit-ci/terminal-input-stability.spec.js --test-name-pattern="managed PTY|remote output"`

Expected: FAIL，`onRemoteOutput` 不存在且输入未被阻止。

- [ ] **Step 3: 为 AttachAddon 添加最小适配器**

```js
// constructor
this._remoteOutputListeners = new Set()
this._remoteOutputDecoder = new TextDecoder('utf-8')

onRemoteOutput = listener => {
  if (typeof listener !== 'function') throw new TypeError('Remote output listener is required')
  this._remoteOutputListeners.add(listener)
  return { dispose: () => this._remoteOutputListeners.delete(listener) }
}

_publishRemoteOutput = value => {
  const text = typeof value === 'string'
    ? value
    : this._remoteOutputDecoder.decode(value, { stream: true })
  for (const listener of [...this._remoteOutputListeners]) listener(text)
}

// writeToTerminal string branch: immediately before term.write
this._publishRemoteOutput(str)

// onRead binary branch: decode the original ArrayBuffer once for managed listeners
this._publishRemoteOutput(data)

// sendToServer, before ordinary safety handling
const managed = this.term?.parent?.handleManagedPtyInput?.(data)
if (managed?.handled === true) {
  return managed.send === true ? this._sendToServerDirect(data) : undefined
}

// dispose
this._remoteOutputListeners.clear()
this._remoteOutputDecoder = new TextDecoder('utf-8')
```

不得在 output suppression 期间发布 Shell Integration 注入回显；只在最终写入终端的数据分支发布。

- [ ] **Step 4: 写入当前子 Shell 重新跟踪与终端集成的失败测试**

先为 `shell.js` 和 Terminal 写行为测试：`su root`、`su - root`、`sudo -i`、`sudo -s` 或直接进入 `bash`/`zsh` 后，旧 Shell Integration 不再产生新提示符时，可在观察到后续远端输出且输出静默至少 200ms 后生成一次“当前 Shell 重跟踪”引导命令；该命令必须清除继承但失效的 `ELECTERM_SHELL_INTEGRATION`，在当前 PTY 内按 `$BASH_VERSION`/`$ZSH_VERSION` 选择注入实现，并复用现有 session nonce。`sleep 60`、`sudo tcpdump`、密码提示、TUI、存在待输入文本或没有后续输出时必须拒绝注入。

随后对 `terminal.jsx` 做结构合同测试，要求：初始化 `createManagedPtyTaskController`；CommandTracker 的完成和提示事件同时转发；`runSafetyCommand` 在 PTY 租约占用时拒绝；断线和卸载调用 `invalidate`；对外暴露 `acquireOperationsPtyTask`。

```js
assert.match(terminalSource, /createManagedPtyTaskController/)
assert.match(terminalSource, /onPromptStarted\(this\.handleTerminalPromptStarted\)/)
assert.match(terminalSource, /acquireOperationsPtyTask/)
assert.match(terminalSource, /operationsPtyTaskController\.invalidate/)
```

- [ ] **Step 5: 在 Terminal 中创建并接线控制器**

```js
this.operationsPtyTaskController = createManagedPtyTaskController({
  ensureReady: this.ensureOperationsPtyTrackerReady,
  getTerminalState: () => ({
    alternateBuffer: this.term?.buffer?.active?.type === 'alternate',
    passwordPrompt: this.attachAddon?.isPasswordPromptDetected?.() === true,
    shellIntegrationActive: this.cmdAddon?.hasShellIntegration?.() === true,
    commandInputActive: this.cmdAddon?.isCommandInputActive?.() === true,
    currentInput: this.cmdAddon?.getCurrentCommandInput?.()
  }),
  expectSubmission: command => this.cmdAddon?.expectExternalSubmission(command),
  armSubmission: token => this.cmdAddon?.markExpectedSubmissionReleased(token) === true,
  cancelSubmission: token => this.cmdAddon?.cancelExpectedSubmission(token) === true,
  submitCommand: command => this.attachAddon?.submitManagedPtyCommand(command) === true,
  interrupt: () => this.attachAddon?.interruptManagedPtyCommand() === true,
  subscribeOutput: listener => this.attachAddon.onRemoteOutput(listener),
  createToken: () => createPtyTaskToken()
})
```

新增 `getCurrentShellIntegrationCommand(sessionNonce)`，只构建发送到当前 PTY 的自适应 Bash/Zsh 引导命令，不修改远端 profile。Terminal 在 `onCommandExecuted` 记录受支持的交互式子 Shell 候选，在后续 `notifyOnData` 标记其已有远端输出，在 CommandTracker 正常完成时清除候选。运维专用就绪函数为：

```js
ensureOperationsPtyTrackerReady = async () => {
  if (this.isCommandSafetyTrackerReady()) return true
  if (!this.canRearmCurrentShellIntegration()) {
    return this.ensureCommandSafetyTrackerReady()
  }
  await this.waitForCurrentShellOutputQuiet(200)
  await this.injectShellIntegration({
    forceForSafety: true,
    forceCurrentShell: true
  })
  if (!this.isCommandSafetyTrackerReady()) {
    throw new Error('当前 Shell 跟踪未恢复，运维命令尚未发送。')
  }
  return true
}
```

`forceCurrentShell` 必须绕过旧的 `shellInjected` 标志并使用自适应引导命令；只能由上述严格候选门禁调用。开始注入前 PTY 租约已经生效，因此普通输入和其他自动命令均被阻止。若引导命令未收到相同 nonce 的新 A/B 提示事件，任务失败，不提交身份探测或工具脚本。

为 AttachAddon 增加只供控制器调用的 `submitManagedPtyCommand(command)` 与 `interruptManagedPtyCommand()`；它们分别走 `_sendToServerDirect(command + '\r')` 和 `_sendToServerDirect('\x03')`，拒绝空命令。

Terminal 增加：

```js
acquireOperationsPtyTask = ownerId => this.operationsPtyTaskController.acquire(ownerId)

handleManagedPtyInput = data => this.operationsPtyTaskController.handleUserInput(data)

handleTerminalPromptStarted = () => {
  this.operationsPtyTaskController.handlePromptStarted()
}

handleTerminalCommandFinished = event => {
  const managed = this.operationsPtyTaskController.handleCommandFinished(event)
  return managed || this.commandSafetyEntrypoint.handleCommandFinished(event)
}
```

在 `runSafetyCommand` 开头检测 `operationsPtyTaskController.isBusy()` 并抛出“当前终端正在执行运维任务，请完成或取消后重试”。在 socket close、重新连接开始和 component unmount 时 await/捕获 `invalidate`，确保旧输出不能落到新会话。

- [ ] **Step 6: 运行终端回归**

Run: `node --test test/unit-ci/terminal-input-stability.spec.js test/unit-ci/terminal-safety-controller.spec.js test/unit-ci/terminal-safety-coordinator.spec.js`

Expected: PASS，现有手工输入、安全事务和新增 PTY 锁测试均为 0 failures。

- [ ] **Step 7: 提交终端接线**

```bash
git add apps/electerm-agent/src/client/components/terminal/shell.js apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js apps/electerm-agent/src/client/components/terminal/terminal.jsx apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js
git commit -m "feat(terminal): expose tracked managed PTY execution"
```

### Task 4: 让运维运行器持有 PTY 租约并记录有效身份

**Files:**
- Create: `apps/electerm-agent/src/client/components/operations-toolkit/runtime/pty-task-channel.js`
- Create: `apps/electerm-agent/test/unit-ci/operations-toolkit-pty-channel.spec.js`
- Modify: `apps/electerm-agent/src/client/components/operations-toolkit/runtime/task-runner.js:1-170`
- Modify: `apps/electerm-agent/src/client/components/operations-toolkit/runtime/task-model.js:1-60`
- Modify: `apps/electerm-agent/test/unit-ci/operations-toolkit-runner.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/operations-toolkit-task-model.spec.js`

- [ ] **Step 1: 写入 PTY 通道端点绑定失败测试**

```js
test('PTY channel acquires the exact live SSH terminal and never invokes SSH exec', async () => {
  const calls = []
  const endpoint = {
    tabId: 'tab-1', pid: 88, terminalPid: 88, sessionType: 'ssh',
    host: 'example.com', port: 22, username: 'hik', connectionUsername: 'hik',
    hostKeyFingerprint: 'SHA256:fixture'
  }
  const terminal = {
    pid: 88,
    isSsh: () => true,
    getTerminalSafetyEndpoint: () => ({ ...endpoint }),
    acquireOperationsPtyTask: async owner => {
      calls.push(owner)
      return { execute: async () => ({ exitCode: 0, identity: { uid: '0', username: 'root' } }), release: async () => {} }
    }
  }
  const channel = createPtyTaskChannel({ getTerminal: id => id === 'tab-1' ? terminal : null })
  const lease = await channel.acquire({ endpoint, taskId: 'operations-1' })
  assert.deepEqual(await lease.execute({ script: 'id' }), {
    exitCode: 0,
    identity: { uid: '0', username: 'root' }
  })
  assert.deepEqual(calls, ['operations-1'])
})
```

增加 PID、`terminalPid`、session type、主机、端口、登录用户或主机密钥不同/缺失均在 acquire 前失败的测试；不得只按 tabId 找到终端后直接执行。

- [ ] **Step 2: 实现 `createPtyTaskChannel`**

```js
export function createPtyTaskChannel ({ getTerminal } = {}) {
  if (typeof getTerminal !== 'function') throw new Error('PTY 运维通道缺少终端解析器')
  return Object.freeze({
    async acquire ({ endpoint, taskId }) {
      const terminal = getTerminal(endpoint.tabId)
      if (!terminal?.pid || terminal.isSsh?.() !== true ||
        typeof terminal.acquireOperationsPtyTask !== 'function') {
        throw new Error('当前 SSH 终端不支持受控 PTY 运维任务')
      }
      assertSameSessionEndpoint(endpoint, terminal.getTerminalSafetyEndpoint())
      if (Number(terminal.pid) !== Number(endpoint.pid)) {
        throw new Error('当前 SSH 终端会话已经变化')
      }
      return terminal.acquireOperationsPtyTask(taskId)
    }
  })
}
```

同时把运行器构造校验从 `channel.execute` 改为 `channel.acquire`，旧 SSH exec 通道不能误接到新运行器。

- [ ] **Step 3: 写入运行器租约和身份失败测试**

```js
test('runner keeps one PTY lease across discovery and every step and stores both identities', async () => {
  const events = []
  const lease = {
    execute: async ({ script, onChunk }) => {
      onChunk(script.includes('discover') ? 'capabilities' : 'root output')
      return { exitCode: 0, identity: { uid: '0', username: 'root' } }
    },
    release: async () => { events.push('release'); return true }
  }
  const runner = createOperationsTaskRunner({
    channel: { acquire: async () => { events.push('acquire'); return lease } },
    discover: async (_endpoint, context) => {
      const result = await context.execute({ script: 'discover', onChunk: () => {} })
      context.onIdentity(result.identity)
      return { tools: ['id'] }
    }
  })
  const task = await runner.run({
    tool,
    endpoint: { ...endpoint, username: 'hik', connectionUsername: 'hik' }
  }).completion
  assert.deepEqual(events, ['acquire', 'release'])
  assert.equal(task.endpoint.connectionUsername, 'hik')
  assert.deepEqual(task.runtimeIdentity, {
    channel: 'pty', effectiveUid: '0', effectiveUsername: 'root'
  })
})
```

增加探测失败、步骤失败、取消和异常均只 release 一次；后续步骤返回不同身份时任务失败；`CancellationUnknownError` 映射为 `cancellation-unknown` 且租约返回 `false` 时不宣称终端已释放；旧记录没有 `runtimeIdentity` 仍可读取的测试。

- [ ] **Step 4: 修改运行器为任务级租约**

删除运行时能力缓存。每次任务执行使用以下顺序：

```js
let lease
try {
  task = setTask(transitionOperationsTask(task, operationsTaskStatuses.discovering))
  lease = await channel.acquire({ endpoint, taskId, signal: controller.signal })
  const onIdentity = identity => {
    const runtimeIdentity = normalizeOperationsRuntimeIdentity(identity)
    if (task.runtimeIdentity && (
      task.runtimeIdentity.effectiveUid !== runtimeIdentity.effectiveUid ||
      task.runtimeIdentity.effectiveUsername !== runtimeIdentity.effectiveUsername
    )) throw new Error('当前 Shell 有效身份在任务执行期间发生变化')
    task = setTask({ ...task, runtimeIdentity })
  }
  const capabilities = await discover(endpoint, {
    taskId,
    signal: controller.signal,
    execute: lease.execute,
    onIdentity
  })
  // 原有步骤循环继续使用 lease.execute，并对每次 result.identity 调用 onIdentity。
} finally {
  const released = await lease?.release()
  if (released === false) {
    task = setTask({ ...task, terminalRecoveryRequired: true })
    taskStore?.save(task)
  }
  controllers.delete(taskId)
  releaseEndpointSlot(countMap, key)
}
```

端点规范化必须令 `connectionUsername` 成为任务/审计展示使用的登录用户名，并继续保留同值 `username` 供现有 SSH 端点守卫兼容；`endpointKey` 明确使用 `connectionUsername || username`，任何 `runtimeIdentity` 都不能改写这两个字段。

`task-model.js` 同时加入终态 `cancellationUnknown: 'cancellation-unknown'`。运行器捕获 `CancellationUnknownError` 时使用该状态，保留错误原因与 `terminalRecoveryRequired: true`；`cancel()` 仍返回该最终任务，不能把它改写为普通 `cancelled`。

在 `task-model.js` 导出：

```js
export function normalizeOperationsRuntimeIdentity (identity = {}) {
  const effectiveUid = String(identity.uid || '')
  const effectiveUsername = String(identity.username || '')
  if (!/^\d+$/.test(effectiveUid) || !effectiveUsername || effectiveUsername.length > 256) {
    throw new Error('运维任务当前 Shell 身份无效')
  }
  return Object.freeze({ channel: 'pty', effectiveUid, effectiveUsername })
}
```

- [ ] **Step 5: 运行通道、运行器和模型测试**

Run: `node --test test/unit-ci/operations-toolkit-pty-channel.spec.js test/unit-ci/operations-toolkit-runner.spec.js test/unit-ci/operations-toolkit-task-model.spec.js`

Expected: PASS，0 failures。

- [ ] **Step 6: 提交任务运行层**

```bash
git add apps/electerm-agent/src/client/components/operations-toolkit/runtime/pty-task-channel.js apps/electerm-agent/src/client/components/operations-toolkit/runtime/task-runner.js apps/electerm-agent/src/client/components/operations-toolkit/runtime/task-model.js apps/electerm-agent/test/unit-ci/operations-toolkit-pty-channel.spec.js apps/electerm-agent/test/unit-ci/operations-toolkit-runner.spec.js apps/electerm-agent/test/unit-ci/operations-toolkit-task-model.spec.js
git commit -m "feat(operations): run tasks through one PTY lease"
```

### Task 5: 切换 Store 探测/执行通道并更新身份 UI

**Files:**
- Modify: `apps/electerm-agent/src/client/store/operations-toolkit.js:1-205`
- Modify: `apps/electerm-agent/src/client/components/operations-toolkit/workspace/task-panel.jsx:1-90`
- Modify: `apps/electerm-agent/src/client/components/operations-toolkit/workspace/result-viewer.jsx:1-85`
- Modify: `apps/electerm-agent/src/client/components/operations-toolkit/workspace/operations-workspace.jsx:250-365`
- Modify: `apps/electerm-agent/src/client/components/operations-toolkit/workspace/operations-workspace.styl:220-380`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js:740-800,2580-2640`
- Create: `apps/electerm-agent/test/unit-ci/operations-toolkit-effective-identity.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/operations-workspace-connection.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/operations-toolkit-resource-ui.spec.js`

- [ ] **Step 1: 写入 Store 路由失败测试**

测试要求 `createRuntime` 构造 `createPtyTaskChannel`；执行期探测通过租约 `execute`；`refreshOperationsCapabilities` 仍调用只读 `runCmd`；任务步骤不得调用 `createSshTaskChannel`。

```js
assert.match(source, /createPtyTaskChannel/)
assert.match(source, /executeOperationsDiscoveryThroughPty/)
assert.doesNotMatch(createRuntimeSource, /createSshTaskChannel/)
assert.match(refreshSource, /runCmd\(endpoint\.pid, command/)
```

- [ ] **Step 2: 实现预探测与执行探测分离**

在 Store 中增加两个明确函数：

```js
async function previewOperationsCapabilities (endpoint) {
  const nonce = createDiscoveryNonce()
  const response = await runCmd(endpoint.pid, buildOperationsDiscoveryCommand(nonce), {
    timeoutMs: 30000,
    maxOutputBytes: 1024 * 1024
  })
  return parseOperationsDiscoveryOutput(commandOutput(response), nonce)
}

async function executeOperationsDiscoveryThroughPty (_endpoint, context) {
  const nonce = createDiscoveryNonce()
  let output = ''
  const result = await context.execute({
    taskId: `${context.taskId}-discovery`,
    script: buildOperationsDiscoveryCommand(nonce),
    timeoutMs: 30000,
    signal: context.signal,
    onChunk: chunk => { output += chunk }
  })
  context.onIdentity(result.identity)
  if (result.exitCode !== 0) throw new Error('当前终端环境探测失败')
  return parseOperationsDiscoveryOutput(output, nonce)
}
```

`createRuntime` 使用 `createPtyTaskChannel({ getTerminal: tabId => refs.get('term-' + tabId) })` 和执行探测函数。`refreshOperationsCapabilities` 直接调用 `previewOperationsCapabilities`，其结果只写入参数表单状态。

`resolveCurrentEndpoint` 从 `terminal.getTerminalSafetyEndpoint()` 取得 tabId、PID、`terminalPid`、session type、主机密钥和 SSH 登录用户名；主机密钥缺失时拒绝启动 PTY 任务。返回值显式增加 `connectionUsername: safetyEndpoint.username`，同时保留 `username` 供现有端点守卫兼容。不要把 `runtimeIdentity` 写入标签页、连接配置或 SFTP 上下文。

- [ ] **Step 3: 写入双身份 UI 失败测试**

```js
test('task panel labels connection and effective shell identities separately', () => {
  assert.match(taskPanelSource, /shellpilotOperationsLoginUser/)
  assert.match(taskPanelSource, /shellpilotOperationsCurrentShell/)
  assert.match(taskPanelSource, /runtimeIdentity\.effectiveUsername/)
  assert.match(taskPanelSource, /endpoint\?\.connectionUsername/)
  assert.doesNotMatch(taskPanelSource, /endpoint\.(?:username|connectionUsername)\s*=\s*runtimeIdentity/)
})
```

要求历史记录同样显示有效身份；无身份的旧记录显示“当前 Shell：未知”；`cancellation-unknown` 显示明确的重连恢复说明且不呈现为普通“已取消”；空任务说明不再声称“独立后台任务，不占用终端”。

- [ ] **Step 4: 实现 TaskPanel、历史和中英文文案**

```jsx
<div className='operations-task-identities'>
  <span>{tf('shellpilotOperationsLoginUser', {
    username: task.endpoint?.connectionUsername || task.endpoint?.username || ''
  })}</span>
  <span>{tf('shellpilotOperationsCurrentShell', {
    username: task.runtimeIdentity?.effectiveUsername ||
      e('shellpilotOperationsEffectiveIdentityUnknown')
  })}</span>
</div>
```

新增完整中英文键：

```js
shellpilotOperationsLoginUser: '登录用户：{username}',
shellpilotOperationsCurrentShell: '当前 Shell：{username}',
shellpilotOperationsEffectiveIdentityUnknown: '未知',
shellpilotOperationsCurrentTerminalTaskHint: '脚本将在当前 SSH 终端中执行，并继承当前 Shell 身份。',
shellpilotOperationsTerminalBusy: '当前终端正在执行运维任务，请完成或取消后重试。',
shellpilotOperationsCancellationUnknown: '取消结果未知；终端保持占用，请重连后再执行自动命令。',
shellpilotOperationsShellRearmFailed: '当前 Shell 跟踪未恢复，命令尚未发送。'
```

英文分别为 `Login user: {username}`、`Current shell: {username}`、`Unknown`、`The script runs in the current SSH terminal and inherits its active shell identity.`、`An operations task is already using this terminal. Finish or cancel it before retrying.`、`Cancellation outcome is unknown. This terminal remains locked; reconnect before running another automated command.`、`Current shell tracking could not be restored. No command was sent.`。

- [ ] **Step 5: 运行 Store/UI 测试**

Run: `node --test test/unit-ci/operations-toolkit-effective-identity.spec.js test/unit-ci/operations-workspace-connection.spec.js test/unit-ci/operations-toolkit-resource-ui.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js`

Expected: PASS，登录身份、有效身份、预探测和 UI 文案测试全部通过。

- [ ] **Step 6: 提交 Store 与 UI**

```bash
git add apps/electerm-agent/src/client/store/operations-toolkit.js apps/electerm-agent/src/client/components/operations-toolkit/workspace/task-panel.jsx apps/electerm-agent/src/client/components/operations-toolkit/workspace/result-viewer.jsx apps/electerm-agent/src/client/components/operations-toolkit/workspace/operations-workspace.jsx apps/electerm-agent/src/client/components/operations-toolkit/workspace/operations-workspace.styl apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/operations-toolkit-effective-identity.spec.js apps/electerm-agent/test/unit-ci/operations-workspace-connection.spec.js apps/electerm-agent/test/unit-ci/operations-toolkit-resource-ui.spec.js
git commit -m "fix(operations): honor current terminal identity"
```

### Task 6: 验证抓包 root 分支和任务历史兼容

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/operations-toolkit-packet-capture.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/operations-toolkit-release-gate.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/operations-toolkit-task-model.spec.js`
- Modify: `apps/electerm-agent/src/client/components/operations-toolkit/runtime/task-record-store.js:1-75` only if the test reveals normalization is required

- [ ] **Step 1: 写入 root/普通用户 Shell 执行测试**

使用本地 POSIX `sh` fixture，把 `id`、`sudo`、`tcpdump`、`timeout`、`mktemp`、`stat`、`ln`、`rm` 和 `ip` 放入临时 PATH。root fixture 的 `id -u` 返回 0，普通用户 fixture 返回 1000。

```js
test('packet capture uses current root shell without invoking sudo', async () => {
  const result = runPacketCaptureFixture({ uid: 0, username: 'root' })
  assert.equal(result.status, 0)
  assert.equal(result.calls.some(call => call.startsWith('sudo ')), false)
  assert.equal(result.calls.some(call => call.includes('tcpdump -nn')), true)
})

test('packet capture still requires noninteractive sudo for an unprivileged shell', async () => {
  const result = runPacketCaptureFixture({ uid: 1000, username: 'hik' })
  assert.equal(result.calls.some(call => call.startsWith('sudo -n tcpdump')), true)
})
```

- [ ] **Step 2: 运行测试并确认现有命令模板行为**

Run: `node --test test/unit-ci/operations-toolkit-packet-capture.spec.js --test-name-pattern="current root shell|unprivileged shell"`

Expected: root fixture 不调用 sudo，普通用户 fixture 调用 `sudo -n`。如果现有模板已通过，不改生产抓包脚本；该测试作为执行通道回归证据。

- [ ] **Step 3: 验证历史记录保留双身份且不迁移旧记录**

```js
test('task record store preserves runtime identity and accepts legacy records without it', async () => {
  const store = createMemoryTaskRecordStore()
  store.save({ ...completedTask, runtimeIdentity: {
    channel: 'pty', effectiveUid: '0', effectiveUsername: 'root'
  } })
  store.save({ ...legacyCompletedTask })
  assert.equal(store.list()[0].runtimeIdentity, undefined)
  assert.equal(store.list()[1].runtimeIdentity.effectiveUsername, 'root')
})
```

只有测试失败时才在 `sanitizeRecord` 中显式白名单化 `runtimeIdentity`；不得补写旧记录或把 root 写入 `endpoint.username`。

- [ ] **Step 4: 运行抓包、历史和发布门禁测试**

Run: `node --test test/unit-ci/operations-toolkit-packet-capture.spec.js test/unit-ci/operations-toolkit-task-model.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js`

Expected: PASS，0 failures。

- [ ] **Step 5: 提交权限与兼容回归**

```bash
git add apps/electerm-agent/test/unit-ci/operations-toolkit-packet-capture.spec.js apps/electerm-agent/test/unit-ci/operations-toolkit-release-gate.spec.js apps/electerm-agent/test/unit-ci/operations-toolkit-task-model.spec.js apps/electerm-agent/src/client/components/operations-toolkit/runtime/task-record-store.js
git commit -m "test(operations): cover effective root execution"
```

如果 `task-record-store.js` 未修改，不把该路径加入 `git add`。

### Task 7: 添加本地 SSH/PTY 端到端回归

**Files:**
- Modify: `apps/electerm-agent/test/e2e/common/local-ssh-server.js:1-110,356-490`
- Create: `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js`

- [ ] **Step 1: 扩展本地 SSH fixture 的有效身份状态**

在每个 shell session 保存独立身份，默认：

```js
const shellIdentity = {
  uid: String(options.loginUid || 1000),
  username: options.loginUsername || TEST_USERNAME
}
```

`runCommand` 处理：

```js
if (command === 'su root') {
  shellIdentity.uid = '0'
  shellIdentity.username = 'root'
  state.effectiveIdentity = { ...shellIdentity }
  state.shellIntegrationActive = false
  stream.write('root shell active\r\nroot@fixture:# ')
  return
}
if (command === 'exit' && shellIdentity.uid === '0') {
  shellIdentity.uid = String(options.loginUid || 1000)
  shellIdentity.username = options.loginUsername || TEST_USERNAME
  state.effectiveIdentity = { ...shellIdentity }
  completeTrackedCommand(stream, state, command, 0, 'login shell active\r\n')
  return
}
```

`su root` 成功后故意不写 OSC 633 D/A/B，以模拟真实子 Shell 丢失客户端内存注入；fixture 必须识别当前 Shell 自适应重跟踪命令，清除继承的失效标志，递增 `state.shellIntegrationRearms`，再用同一 session nonce 写 A/B。这样 E2E 如果绕过重跟踪就会稳定失败。

随后识别 PTY 包装命令中的 token 与脚本 Base64，向 shell 流写开始 OSC、fixture 输出和结束 OSC，并继续写精确 OSC 633 E/C/D/A/B。能力探测脚本返回合法的 `__SHELLPILOT_OPERATIONS_BEGIN__/END__` 数据；普通脚本记录到 `state.managedPtyScripts`，输出 `managed_user=<username> managed_uid=<uid>`。

- [ ] **Step 2: 写入 E2E 失败测试**

测试流程必须完全使用本地 fixture：

```js
test('operations and packet capture inherit su root while SFTP keeps the login identity', async () => {
  const sshServer = await startLocalSshServer({ managedPtyTasks: true, sftpRoot: fixture.root })
  await connectWithQuickWizard(page, sshServer)
  await sendTerminalLine(page, 'su root')
  await expect.poll(() => sshServer.state.effectiveIdentity?.username).toBe('root')

  const diagnostic = await page.evaluate(() => (
    window.store.runOperationsTool('system.overview').completion
  ))
  expect(diagnostic.endpoint.username).toBe(sshServer.username)
  expect(diagnostic.endpoint.connectionUsername).toBe(sshServer.username)
  expect(diagnostic.runtimeIdentity).toEqual({
    channel: 'pty', effectiveUid: '0', effectiveUsername: 'root'
  })
  expect(sshServer.state.shellIntegrationRearms).toBe(1)
  expect(sshServer.state.managedPtyScripts.length).toBeGreaterThan(0)
  expect(sshServer.state.execCommands.some(command => command.includes('/.shellpilot/tasks/'))).toBe(false)

  await runPacketCaptureFromOperationsUi(page)
  expect(sshServer.state.managedPtyScripts.some(item => item.script.includes('tcpdump'))).toBe(true)
  await expect(page.locator('.operations-task-identities')).toContainText('登录用户')
  await expect(page.locator('.operations-task-identities')).toContainText('当前 Shell：root')

  await openSftpAndWait(page, sshServer)
  expect(sshServer.state.authenticatedUsernames.length).toBeGreaterThan(0)
  expect(sshServer.state.authenticatedUsernames.every(
    username => username === sshServer.username
  )).toBe(true)

  await sendTerminalLine(page, 'exit')
  const afterExit = await page.evaluate(() => (
    window.store.runOperationsTool('system.overview').completion
  ))
  expect(afterExit.runtimeIdentity.effectiveUsername).toBe(sshServer.username)
  expect(afterExit.endpoint.connectionUsername).toBe(sshServer.username)
})
```

测试中通过 UI 完成资源敏感抓包确认，不直接伪造确认 capability。fixture 不执行真实 tcpdump、不访问用户服务器。

- [ ] **Step 3: 运行 E2E 并修正 fixture 协议细节**

Run: `npx playwright test test/e2e/039.operations-pty-identity.spec.js --workers=1`

Expected: PASS，1 test、0 failures；测试日志显示运维脚本只进入 shell command 记录，不进入 SSH exec 任务目录。

- [ ] **Step 4: 回归无连接运维工作区**

Run: `npx playwright test test/e2e/032.operations-toolkit.spec.js --workers=1`

Expected: PASS，原有目录、布局、参数和连接引导不退化。

- [ ] **Step 5: 提交 E2E**

```bash
git add apps/electerm-agent/test/e2e/common/local-ssh-server.js apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js
git commit -m "test(e2e): verify su-aware operations PTY"
```

### Task 8: 完整自检与交付准备

**Files:**
- Modify only if verification finds a defect: files already listed in Tasks 1-7

- [ ] **Step 1: 运行所有相关单元测试**

Run:

```bash
node --test test/unit-ci/operations-toolkit-pty-protocol.spec.js test/unit-ci/managed-pty-task-controller.spec.js test/unit-ci/operations-toolkit-pty-channel.spec.js test/unit-ci/operations-toolkit-runner.spec.js test/unit-ci/operations-toolkit-task-model.spec.js test/unit-ci/operations-toolkit-effective-identity.spec.js test/unit-ci/operations-toolkit-packet-capture.spec.js test/unit-ci/operations-toolkit-resource-ui.spec.js test/unit-ci/terminal-input-stability.spec.js test/unit-ci/terminal-safety-controller.spec.js test/unit-ci/terminal-safety-coordinator.spec.js
```

Expected: PASS，0 failures。

- [ ] **Step 2: 运行 lint**

Run: `npm run lint`

Expected: exit 0，0 lint errors。

- [ ] **Step 3: 运行完整单元测试**

Run: `npm run test-unit-ci`

Expected: exit 0，0 failures；平台能力相关测试只允许保留仓库既有 skip。

- [ ] **Step 4: 运行运维 E2E 与性能回归**

Run:

```bash
npx playwright test test/e2e/032.operations-toolkit.spec.js test/e2e/039.operations-pty-identity.spec.js test/e2e/038.client-interaction-performance.spec.js --workers=1
```

Expected: PASS，0 failures；AI 输入性能门槛保持现有测试要求。

- [ ] **Step 5: 构建渲染器**

Run: `npm run vite-build`

Expected: exit 0，生产构建完成且无模块解析错误。

- [ ] **Step 6: 自检身份隔离和差异**

Run:

```bash
git diff master...HEAD --check
git diff master...HEAD -- apps/electerm-agent/src/client/components/sftp apps/electerm-agent/src/app/server/session-sftp.js
git status --short --branch
```

Expected: `diff --check` 无输出；SFTP 差异无输出；工作区只包含计划内修改且最终为 clean。

- [ ] **Step 7: 请求代码审查并修复发现的问题**

使用 `superpowers:requesting-code-review`，审查重点为：远端输出能否伪造完成、取消是否错误宣称成功、登录身份是否被有效身份覆盖、是否存在 SSH exec 静默回退、任务锁是否在异常路径泄漏。

每个审查问题先增加失败测试，再做最小修复并重新运行 Steps 1-6。

- [ ] **Step 8: 提交验证修复（仅在有修改时）**

```bash
git add apps/electerm-agent/src apps/electerm-agent/test
git commit -m "fix(operations): close PTY identity review findings"
```

若审查没有产生修改，不创建空提交。

- [ ] **Step 9: 按完成分支流程交付**

使用 `superpowers:verification-before-completion` 重新核对最新测试证据，再使用 `superpowers:finishing-a-development-branch` 提供合并、PR、保留或清理分支选项。未经用户明确授权，不发布新版本或创建线上 Release。
