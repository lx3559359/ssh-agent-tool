# SFTP Visible Progress and Safe Delete Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让上传、下载进度坞在任意支持窗口尺寸下始终完整可见，并在不降低恢复快照安全门槛的前提下，让安全删除持续显示真实阶段/字节进度、消除同一确认周期内的重复完整摘要、删除成功后立即更新列表，最终合并并发布 ShellPilot v0.4.43。

**Architecture:** 保留现有 `fileTransfers`、SFTP WebSocket 协议和安全事务运行器作为事实来源。进度坞通过纯几何函数计算视口内固定定位；安全删除由适配器报告真实摘要/复制/验证阶段，经 100 ms 发布门进入保持打开的确认框；适配器仅在安全删除路径复用绑定到 operation、endpoint、recoveryBinding、路径和描述符的短生命周期证明；成功结果先纯函数式移除当前列表项，再后台执行一次远端校准。

**Tech Stack:** Electron 41、React 19、Ant Design 6、Stylus、Node.js test runner、Playwright Electron E2E、StandardJS、GitHub CLI、现有 ShellPilot 发布脚本。

---

## 实施约束

- 工作目录固定为 `F:\SSH工具开发\.worktrees\sftp-visible-transfer-progress\apps\electerm-agent`；不要修改用户主工作树 `F:\SSH工具开发`。
- 不提交或删除当前未跟踪的 `.superpowers/` 与 `audit-results/`。
- 不新增 WebSocket/SFTP 协议消息，不修改 `session-sftp.js` 的复制协议。
- 不允许在快照完整验证前启用确认，不允许把安全删除降级为快速删除。
- 完整摘要继续使用 `SHELLPILOT-SHA-256-CHAIN-V1`；恢复操作仍执行完整快照验证。
- 快速删除、FTP 永久删除、AI/MCP 默认安全策略和上传/下载传输语义保持不变。

## 文件结构

### 新建

- `src/client/components/sftp/sftp-transfer-dock-layout.js`：视口安全定位的纯几何计算。
- `test/unit-ci/sftp-transfer-dock-layout.spec.js`：几何钳制、无效输入和窄窗口测试。

### 修改

- `src/client/components/sftp/sftp-transfer-progress-dock.jsx`：测量 `.sftp-wrap`、监听布局并应用固定定位。
- `src/client/components/sftp/sftp.styl`：固定进度坞、底部空间和安全删除阶段样式。
- `test/unit-ci/sftp-transfer-progress-dock.spec.js`：固定定位、observer 清理和 ARIA 契约。
- `src/client/components/common/modal.jsx`：新增默认关闭、可选保持打开的确认行为。
- `src/client/components/sftp/sftp-delete-dialog-model.js`：进度归一化、阶段文案模型和 100 ms 发布门。
- `src/client/components/sftp/sftp-delete-dialog.jsx`：阶段、目标序号、字节进度、执行中和失败状态。
- `src/client/common/shellpilot-i18n-overrides.js`：安全删除阶段和后台校准失败中英文文案。
- `test/unit-ci/sftp-delete-dialog.spec.js`：阶段顺序、节流、禁用确认和保持打开契约。
- `test/unit-ci/ui-accessibility-contract.spec.js`：确认框默认关闭行为与可选保持打开契约。
- `src/client/components/sftp/sftp-transaction-adapter.js`：摘要进度、复制轮询、准备期去重、证明绑定和执行期复用。
- `test/unit-ci/sftp-safety-transaction.spec.js`：摘要次数、进度、证明失效和安全失败关闭。
- `src/client/components/sftp/sftp-entry-lifecycle.js`：乐观删除当前远端列表项的纯函数。
- `test/unit-ci/sftp-entry-lifecycle.spec.js`：1000 项列表、路径归一化和选择清理模型。
- `src/client/components/sftp/sftp-entry.jsx`：对话框进度接线、证明生命周期、乐观更新和单次后台校准。
- `test/unit-ci/sftp-refresh-behavior.spec.js`：无固定等待、同步更新和单次后台刷新契约。
- `test/e2e/027.quality-core-flows.spec.js`：上传/下载视口边界和三轮 32 MiB 安全删除实测。
- `package.json`、`package-lock.json`、`docs/releases/v0.4.43.md`：v0.4.43 发布元数据。

## Task 1：进度坞视口几何模型

**Files:**
- Create: `test/unit-ci/sftp-transfer-dock-layout.spec.js`
- Create: `src/client/components/sftp/sftp-transfer-dock-layout.js`

- [ ] **Step 1: 写入视口钳制的失败测试**

创建 `test/unit-ci/sftp-transfer-dock-layout.spec.js`：

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modulePath = path.resolve(
  __dirname,
  '../../src/client/components/sftp/sftp-transfer-dock-layout.js'
)

async function loadLayout () {
  const url = pathToFileURL(modulePath)
  url.search = `test=${Date.now()}-${Math.random()}`
  return import(url)
}

test('SFTP dock follows the visible bottom of a fully visible workspace', async () => {
  const { computeSftpTransferDockLayout } = await loadLayout()
  assert.deepEqual(computeSftpTransferDockLayout({
    containerRect: { left: 70, right: 1438, bottom: 1040 },
    viewportWidth: 1600,
    viewportHeight: 1098
  }), {
    left: 80,
    right: 172,
    bottom: 66,
    maxWidth: 1348
  })
})

test('SFTP dock stays inside the viewport when its workspace overflows', async () => {
  const { computeSftpTransferDockLayout } = await loadLayout()
  assert.deepEqual(computeSftpTransferDockLayout({
    containerRect: { left: 70, right: 1700, bottom: 1123 },
    viewportWidth: 1600,
    viewportHeight: 1098
  }), {
    left: 80,
    right: 10,
    bottom: 8,
    maxWidth: 1510
  })
})

test('SFTP dock clamps cropped, narrow, and invalid geometry', async () => {
  const { computeSftpTransferDockLayout } = await loadLayout()
  assert.deepEqual(computeSftpTransferDockLayout({
    containerRect: { left: -40, right: 280, bottom: 700 },
    viewportWidth: 320,
    viewportHeight: 720
  }), {
    left: 10,
    right: 50,
    bottom: 28,
    maxWidth: 260
  })
  const fallback = computeSftpTransferDockLayout({
    containerRect: { left: Number.NaN, right: Infinity, bottom: undefined },
    viewportWidth: 900,
    viewportHeight: 600
  })
  assert.deepEqual(fallback, {
    left: 10,
    right: 10,
    bottom: 8,
    maxWidth: 880
  })
  assert.equal(Object.values(fallback).every(Number.isFinite), true)
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-dock-layout.spec.js
```

Expected: FAIL，模块 `sftp-transfer-dock-layout.js` 尚不存在。

- [ ] **Step 3: 实现纯几何函数**

创建 `src/client/components/sftp/sftp-transfer-dock-layout.js`：

```js
function finiteOr (value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp (value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function computeSftpTransferDockLayout ({
  containerRect,
  viewportWidth,
  viewportHeight,
  horizontalGutter = 10,
  bottomGutter = 8
} = {}) {
  const width = Math.max(0, finiteOr(viewportWidth, 0))
  const height = Math.max(0, finiteOr(viewportHeight, 0))
  const gutterX = Math.max(0, finiteOr(horizontalGutter, 10))
  const gutterBottom = Math.max(0, finiteOr(bottomGutter, 8))
  const visibleLeft = clamp(finiteOr(containerRect?.left, 0), 0, width)
  const visibleRight = clamp(
    finiteOr(containerRect?.right, width),
    visibleLeft,
    width
  )
  const visibleBottom = clamp(
    finiteOr(containerRect?.bottom, height),
    0,
    height
  )
  const left = clamp(visibleLeft + gutterX, 0, width)
  const rightEdge = clamp(visibleRight - gutterX, left, width)
  const right = Math.max(0, width - rightEdge)
  const bottom = Math.max(gutterBottom, height - visibleBottom + gutterBottom)

  return {
    left,
    right,
    bottom,
    maxWidth: Math.max(0, width - left - right)
  }
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-dock-layout.spec.js
```

Expected: PASS，3 个几何场景全部通过。

- [ ] **Step 5: 提交几何模型**

```powershell
git add -- src/client/components/sftp/sftp-transfer-dock-layout.js test/unit-ci/sftp-transfer-dock-layout.spec.js
git commit -m "fix(sftp): anchor transfer dock inside viewport"
```

## Task 2：进度坞固定定位、清理和真实 Electron 边界

**Files:**
- Modify: `test/unit-ci/sftp-transfer-progress-dock.spec.js`
- Modify: `src/client/components/sftp/sftp-transfer-progress-dock.jsx`
- Modify: `src/client/components/sftp/sftp.styl`
- Modify: `test/e2e/027.quality-core-flows.spec.js`

- [ ] **Step 1: 把旧绝对定位测试改成固定定位和清理契约**

在 `test/unit-ci/sftp-transfer-progress-dock.spec.js` 的明显展示测试中，用以下断言替换绝对定位断言，并保留既有进度、终态和响应式断言：

```js
assert.match(styles, /\.sftp-transfer-progress-dock\s+[\s\S]*?position fixed/)
assert.doesNotMatch(styles, /\.sftp-transfer-progress-dock\s+[\s\S]*?position absolute/)
assert.match(styles, /height calc\(100% - 64px\) !important/)
assert.match(dock, /computeSftpTransferDockLayout/)
assert.match(dock, /getBoundingClientRect\(\)/)
assert.match(dock, /closest\('\.sftp-wrap'\)/)
assert.match(dock, /new ResizeObserver\(measure\)/)
assert.match(dock, /window\.addEventListener\('resize', measure\)/)
assert.match(dock, /window\.removeEventListener\('resize', measure\)/)
assert.match(dock, /observer\?\.disconnect\(\)/)
assert.match(dock, /ref=\{dockRef\}/)
assert.match(dock, /style=\{dockLayout\}/)
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: FAIL，样式仍为 `position absolute`，组件尚未测量容器或清理 observer。

- [ ] **Step 3: 接入几何测量和布局监听**

在 `sftp-transfer-progress-dock.jsx` 增加导入：

```js
import { computeSftpTransferDockLayout } from './sftp-transfer-dock-layout.js'
```

在组件状态与 effect 区域加入：

```jsx
const dockRef = useRef(null)
const [dockLayout, setDockLayout] = useState(() => (
  computeSftpTransferDockLayout({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  })
))

useEffect(() => {
  if (!published.count) return undefined
  const dock = dockRef.current
  const workspace = dock?.closest('.sftp-wrap')
  const measure = () => {
    setDockLayout(computeSftpTransferDockLayout({
      containerRect: workspace?.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }))
  }
  measure()
  window.addEventListener('resize', measure)
  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(measure)
    : null
  if (workspace) observer?.observe(workspace)
  return () => {
    window.removeEventListener('resize', measure)
    observer?.disconnect()
  }
}, [published.count, expanded])
```

把根元素改为：

```jsx
<section
  ref={dockRef}
  className={dockClass}
  style={dockLayout}
  aria-label={e('shellpilotSftpTransferProgress')}
>
```

- [ ] **Step 4: 改为固定定位并保留列表底部空间**

在 `sftp.styl` 中保留现有 `:has(> .sftp-transfer-progress-dock)` 的 64 px 列表让位，只把定位块改为：

```stylus
.sftp-transfer-progress-dock
  position fixed
  z-index 20
  left 10px
  right 10px
  bottom 8px
  max-width calc(100vw - 20px)
  min-height 50px
```

其余颜色、进度条、窄窗口和终态样式不变。

- [ ] **Step 5: 运行单元测试并确认 GREEN**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-dock-layout.spec.js test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: PASS；既有活动、暂停、部分完成、失败、完成和 ARIA 测试继续通过。

- [ ] **Step 6: 给本地 Electron 流程增加视口边界断言**

在 `test/e2e/027.quality-core-flows.spec.js` 增加：

```js
async function expectDockInsideViewport (page, dock) {
  const geometry = await dock.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }
  })
  expect(geometry.left).toBeGreaterThanOrEqual(0)
  expect(geometry.top).toBeGreaterThanOrEqual(0)
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth)
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight)
}
```

让 `expectVisibleTransferProgress()` 返回 dock 后，在上传和下载处都断言：

```js
const uploadDock = await expectVisibleTransferProgress(
  page,
  'quality-progress-upload.bin',
  /本地|Local/
)
await expectDockInsideViewport(page, uploadDock)
```

下载前缩短窗口，下载活动时断言并恢复窗口：

```js
const originalBounds = await run.electronApp.evaluate(({ BrowserWindow }) => (
  BrowserWindow.getAllWindows()[0].getBounds()
))
await run.electronApp.evaluate(({ BrowserWindow }) => {
  const window = BrowserWindow.getAllWindows()[0]
  const bounds = window.getBounds()
  window.setBounds({ ...bounds, height: 820 })
})
const downloadDock = await expectVisibleTransferProgress(
  page,
  'quality-progress-download.bin',
  /远程|Remote/
)
await expectDockInsideViewport(page, downloadDock)
await run.electronApp.evaluate(({ BrowserWindow }, bounds) => {
  BrowserWindow.getAllWindows()[0].setBounds(bounds)
}, originalBounds)
```

- [ ] **Step 7: 运行本地 Electron 测试并提交**

Run:

```powershell
npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1
```

Expected: PASS；上传和下载在普通与 820 px 高窗口中均满足四个视口边界。

```powershell
git add -- src/client/components/sftp/sftp-transfer-progress-dock.jsx src/client/components/sftp/sftp.styl test/unit-ci/sftp-transfer-progress-dock.spec.js test/e2e/027.quality-core-flows.spec.js
git commit -m "fix(sftp): keep transfer progress fully visible"
```

## Task 3：安全删除阶段模型和保持打开的确认框

**Files:**
- Modify: `test/unit-ci/sftp-delete-dialog.spec.js`
- Modify: `test/unit-ci/ui-accessibility-contract.spec.js`
- Modify: `src/client/components/common/modal.jsx`
- Modify: `src/client/components/sftp/sftp-delete-dialog-model.js`
- Modify: `src/client/components/sftp/sftp-delete-dialog.jsx`
- Modify: `src/client/components/sftp/sftp.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`

- [ ] **Step 1: 写入阶段归一化和发布节流失败测试**

在 `test/unit-ci/sftp-delete-dialog.spec.js` 增加：

```js
test('safe delete progress normalizes bytes, target position, and percentage', async () => {
  const {
    normalizeSafeDeleteProgress
  } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-delete-dialog-model.js'
  )).href)
  assert.deepEqual(normalizeSafeDeleteProgress({
    phase: 'snapshot-copy',
    completedBytes: 75,
    totalBytes: 100,
    targetIndex: 2,
    targetCount: 3
  }), {
    phase: 'snapshot-copy',
    completedBytes: 75,
    totalBytes: 100,
    targetIndex: 2,
    targetCount: 3,
    determinate: true,
    percent: 75
  })
  assert.deepEqual(normalizeSafeDeleteProgress({
    phase: 'source-scan',
    completedBytes: 32,
    totalBytes: null,
    targetIndex: 9,
    targetCount: 2
  }), {
    phase: 'source-scan',
    completedBytes: 32,
    totalBytes: null,
    targetIndex: 2,
    targetCount: 2,
    determinate: false,
    percent: null
  })
})

test('safe delete progress publishes phase changes immediately and bytes at 100ms', async () => {
  const { createSafeDeleteProgressGate } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-delete-dialog-model.js'
  )).href)
  let now = 0
  const timers = []
  const published = []
  const gate = createSafeDeleteProgressGate({
    now: () => now,
    setTimer: (callback, delay) => {
      const timer = { callback, delay }
      timers.push(timer)
      return timer
    },
    clearTimer: () => {},
    onPublish: value => published.push(value)
  })
  gate.update({ phase: 'source-scan', completedBytes: 0 })
  now = 10
  gate.update({ phase: 'source-scan', completedBytes: 64 })
  gate.update({ phase: 'source-scan', completedBytes: 128 })
  assert.equal(published.length, 1)
  assert.equal(timers.at(-1).delay, 90)
  gate.update({ phase: 'snapshot-copy', completedBytes: 0 })
  assert.equal(published.at(-1).phase, 'snapshot-copy')
  gate.dispose()
})
```

扩展源码契约：

```js
assert.match(source, /phase='source-scan'|phase:\s*'source-scan'/)
assert.match(source, /role='progressbar'/)
assert.match(source, /aria-valuenow/)
assert.match(source, /targetIndex/)
assert.match(source, /closeOnOk:\s*false/)
assert.match(source, /progress\s*\(/)
assert.match(source, /complete\s*\(/)
```

- [ ] **Step 2: 写入 Modal 向后兼容失败测试**

在 `test/unit-ci/ui-accessibility-contract.spec.js` 增加：

```js
test('custom confirm can stay open after an explicit action', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/common/modal.jsx'
  ), 'utf8')
  assert.match(source, /closeOnOk\s*=\s*true/)
  assert.match(source, /let currentOptions = options/)
  assert.match(source, /currentOptions = \{ \.\.\.currentOptions, \.\.\.newOptions \}/)
  assert.match(source, /if \(closeOnOk\) destroy\(\)/)
  assert.match(source, /if \(newCloseOnOk\) destroy\(\)/)
})
```

- [ ] **Step 3: 运行测试并确认 RED**

Run:

```powershell
node --test test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: FAIL，阶段模型、进度门和 `closeOnOk` 尚不存在。

- [ ] **Step 4: 实现安全删除进度模型**

在 `sftp-delete-dialog-model.js` 追加：

```js
const safeDeletePhases = new Set([
  'source-scan',
  'snapshot-copy',
  'snapshot-verify',
  'ready',
  'deleting',
  'result-verify',
  'failed'
])

function nonNegativeNumber (value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

export function normalizeSafeDeleteProgress (progress = {}) {
  const phase = safeDeletePhases.has(progress.phase)
    ? progress.phase
    : 'source-scan'
  const completedBytes = nonNegativeNumber(progress.completedBytes)
  const rawTotal = progress.totalBytes
  const totalBytes = rawTotal === null || rawTotal === undefined
    ? null
    : nonNegativeNumber(rawTotal)
  const targetCount = Math.max(1, Math.trunc(nonNegativeNumber(progress.targetCount, 1)))
  const targetIndex = Math.min(
    targetCount,
    Math.max(1, Math.trunc(nonNegativeNumber(progress.targetIndex, 1)))
  )
  const determinate = totalBytes !== null && totalBytes > 0
  const boundedCompleted = determinate
    ? Math.min(completedBytes, totalBytes)
    : completedBytes
  return {
    phase,
    completedBytes: boundedCompleted,
    totalBytes,
    targetIndex,
    targetCount,
    determinate,
    percent: determinate
      ? Math.floor((boundedCompleted / totalBytes) * 100)
      : null
  }
}

export function createSafeDeleteProgressGate ({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onPublish,
  intervalMs = 100
} = {}) {
  let previous = null
  let latest = null
  let timer = null
  let lastPublishedAt = Number.NEGATIVE_INFINITY
  let disposed = false
  const publish = () => {
    timer = null
    if (disposed || !latest) return
    previous = latest
    lastPublishedAt = now()
    onPublish(latest)
  }
  const cancelPending = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }
  return {
    update (value) {
      if (disposed) return
      latest = normalizeSafeDeleteProgress(value)
      const elapsed = now() - lastPublishedAt
      const immediate = !previous || previous.phase !== latest.phase || elapsed >= intervalMs
      if (immediate) {
        cancelPending()
        publish()
      } else if (timer === null) {
        timer = setTimer(publish, Math.max(0, intervalMs - elapsed))
      }
    },
    dispose () {
      disposed = true
      cancelPending()
      previous = null
      latest = null
    }
  }
}
```

- [ ] **Step 5: 给 Modal 增加默认兼容的保持打开选项**

在 `createModalInstance()` 开头保存累计选项，并从中完成初次解构；这样安全删除的高频 content 更新不会把上一轮按钮/onOk 状态重置成最初值：

```js
let currentOptions = options
```

初次解构中加入 `closeOnOk = true`，并把初次 `handleOk` 改为：

```js
const handleOk = () => {
  if (onOk) onOk()
  if (closeOnOk) destroy()
}
```

在 `update()` 开头累计更新，再从 `currentOptions` 解构：

```js
currentOptions = { ...currentOptions, ...newOptions }
const updatedOptions = currentOptions
```

解构中加入：

```js
closeOnOk: newCloseOnOk = closeOnOk,
```

并把更新后的确认处理改为：

```js
const newHandleOk = () => {
  if (newOnOk) newOnOk()
  if (newCloseOnOk) destroy()
}
```

确保 `closeOnOk` 和 `newCloseOnOk` 不透传到 `<Modal>` DOM props；所有未指定该选项的现有确认框仍在确认后关闭。

- [ ] **Step 6: 渲染阶段、字节和执行中状态**

在 `sftp-delete-dialog.jsx` 导入 `filesize`、`createSafeDeleteProgressGate` 和 `normalizeSafeDeleteProgress`。使用以下阶段键：

```js
const phaseTranslationKeys = {
  'source-scan': 'shellpilotSftpSafeDeleteSourceScan',
  'snapshot-copy': 'shellpilotSftpSafeDeleteSnapshotCopy',
  'snapshot-verify': 'shellpilotSftpSafeDeleteSnapshotVerify',
  ready: 'shellpilotSftpSafeDeleteReady',
  deleting: 'shellpilotSftpSafeDeleteDeleting',
  'result-verify': 'shellpilotSftpSafeDeleteResultVerify',
  failed: 'shellpilotSftpSafeDeleteFailed'
}
```

让 `SafeDeleteDialogBody` 接收 `progress`，归一化后渲染：

```jsx
const normalized = normalizeSafeDeleteProgress(progress)
const stateText = normalized.phase === 'failed'
  ? formatShellPilotTranslation(translate, phaseTranslationKeys.failed, {
      detail: redactDeletePreparationError(error)
    })
  : formatShellPilotTranslation(
      translate,
      phaseTranslationKeys[normalized.phase],
      {
        count: count || preview.count,
        current: normalized.targetIndex,
        total: normalized.targetCount
      }
    )

<div
  className={`sftp-safe-delete-dialog is-${normalized.phase}`}
  aria-busy={!['ready', 'failed'].includes(normalized.phase)}
>
  <div className='sftp-safe-delete-state' role={normalized.phase === 'failed' ? 'alert' : 'status'} aria-live='polite' aria-atomic='true'>
    {stateText}
  </div>
  {!['ready', 'failed'].includes(normalized.phase) && (
    <div
      className={`sftp-safe-delete-progress${normalized.determinate ? '' : ' is-indeterminate'}`}
      role='progressbar'
      aria-valuemin={0}
      aria-valuemax={100}
      {...(normalized.determinate ? { 'aria-valuenow': normalized.percent } : {})}
    >
      <span style={normalized.determinate ? { width: `${normalized.percent}%` } : undefined} />
    </div>
  )}
  <div className='sftp-safe-delete-bytes'>
    {normalized.completedBytes > 0 ? filesize(normalized.completedBytes) : ''}
    {normalized.determinate ? ` / ${filesize(normalized.totalBytes)}` : ''}
  </div>
</div>
```

在 `openSafeDeleteDialog()` 中创建一个 gate；其 `onPublish` 只通过 `modal.update()` 更新 content。初始 Modal 传 `closeOnOk: false`。控制器公开以下行为：

```js
progress (value) {
  if (!settled || value.phase === 'deleting' || value.phase === 'result-verify') {
    progressGate.update(value)
  }
},
ready (count) {
  if (settled) return
  currentCount = count
  progressGate.update({ phase: 'ready', targetIndex: count, targetCount: count })
  modal.update({
    closeOnOk: false,
    okButtonProps: { disabled: false },
    onOk: () => {
      progressGate.update({
        phase: 'deleting',
        targetIndex: 1,
        targetCount: count
      })
      modal.update({ okButtonProps: { disabled: true } })
      settle('confirm')
    }
  })
},
fail (error, { retryable = !settled } = {}) {
  progressGate.update({ phase: 'failed', targetCount: currentCount || files.length })
  modal.update({
    content: renderProgress({ phase: 'failed' }, error),
    okText: translate(retryable ? 'shellpilotRetry' : 'shellpilotCloseDialog'),
    okButtonProps: { disabled: false },
    closeOnOk: true,
    onOk: () => {
      if (retryable) settle('retry')
    }
  })
},
complete () {
  progressGate.dispose()
  modal.destroy()
},
destroy () {
  progressGate.dispose()
  modal.destroy()
  controller.abort()
  settle('cancel')
}
```

`renderProgress()` 必须始终传入当前 files、count、translate；取消时继续 abort，确认执行时不销毁 Modal。

- [ ] **Step 7: 增加中英文文案和样式**

在中英文 override 对应区分别加入：

```js
shellpilotSftpSafeDeleteSourceScan: '正在扫描原文件（{current}/{total}）…',
shellpilotSftpSafeDeleteSnapshotCopy: '正在复制恢复快照（{current}/{total}）…',
shellpilotSftpSafeDeleteSnapshotVerify: '正在验证恢复快照（{current}/{total}）…',
shellpilotSftpSafeDeleteDeleting: '正在复核并安全删除（{current}/{total}）…',
shellpilotSftpSafeDeleteResultVerify: '正在确认删除结果（{current}/{total}）…',
shellpilotSftpStateCalibrationFailed: '远端状态校准失败，请手动刷新。',
```

```js
shellpilotSftpSafeDeleteSourceScan: 'Scanning source ({current}/{total})…',
shellpilotSftpSafeDeleteSnapshotCopy: 'Copying recovery snapshot ({current}/{total})…',
shellpilotSftpSafeDeleteSnapshotVerify: 'Verifying recovery snapshot ({current}/{total})…',
shellpilotSftpSafeDeleteDeleting: 'Rechecking and safely deleting ({current}/{total})…',
shellpilotSftpSafeDeleteResultVerify: 'Verifying deletion result ({current}/{total})…',
shellpilotSftpStateCalibrationFailed: 'Remote state calibration failed. Refresh manually.',
```

在 `sftp.styl` 增加：

```stylus
.sftp-safe-delete-progress
  position relative
  height 8px
  margin 12px 0 6px
  overflow hidden
  background var(--sp-control-background)
  border-radius 999px
  > span
    display block
    height 100%
    background var(--sp-primary)
    transition width 100ms linear
  &.is-indeterminate > span
    width 35%
    animation sftp-transfer-progress-indeterminate 1.1s ease-in-out infinite
.sftp-safe-delete-bytes
  min-height 20px
  color var(--sp-text-muted)
  font-variant-numeric tabular-nums
```

- [ ] **Step 8: 运行测试并提交**

Run:

```powershell
node --test test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/ui-accessibility-contract.spec.js test/unit-ci/sftp-file-context-i18n.spec.js
```

Expected: PASS；默认 Modal 行为未变，安全删除确认后可保持打开且进度更新最多每 100 ms 发布一次。

```powershell
git add -- src/client/components/common/modal.jsx src/client/components/sftp/sftp-delete-dialog-model.js src/client/components/sftp/sftp-delete-dialog.jsx src/client/components/sftp/sftp.styl src/client/common/shellpilot-i18n-overrides.js test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/ui-accessibility-contract.spec.js
git commit -m "feat(sftp): show safe delete stages and bytes"
```

## Task 4：适配器真实进度与准备阶段重复摘要消除

**Files:**
- Modify: `test/unit-ci/sftp-safety-transaction.spec.js`
- Modify: `src/client/components/sftp/sftp-transaction-adapter.js`

- [ ] **Step 1: 给 fake SFTP 和摘要测试增加可观察进度**

在 `createFakeSftp()` 的 `copyEntry` 中支持可选延迟，但默认保持当前同步行为：

```js
if (options.copyDelay) {
  await new Promise(resolve => setTimeout(resolve, options.copyDelay))
}
```

增加测试：

```js
test('SFTP bounded digest reports actual monotonic bytes', async () => {
  const { digestRemoteFile } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const sftp = createFakeSftp({
    '/srv/app/big.bin': { type: 'file', content: Buffer.alloc(180000, 7) }
  })
  const progress = []
  const result = await digestRemoteFile(
    sftp,
    '/srv/app/big.bin',
    180000,
    undefined,
    bytes => progress.push(bytes)
  )
  assert.equal(result.size, 180000)
  assert.deepEqual(progress, [65536, 65536, 48928])
})

test('SFTP delete prepare reads source and staging once without rereading final snapshot', async () => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const sftp = createFakeSftp({
    '/srv/app/big.bin': { type: 'file', content: Buffer.alloc(180000, 7) }
  })
  const progress = []
  const operation = await buildSftpOperation({
    id: 'adapter-delete-progress',
    action: 'delete',
    paths: { source: '/srv/app/big.bin' },
    type: 'file',
    expected: { absent: true }
  })
  const adapter = createSftpTransactionAdapter({
    getSftp: () => sftp,
    onProgress: (current, value) => progress.push({ id: current.id, ...value })
  })
  const prepared = await adapter.prepare(operation)
  const resource = prepared.plan.resources[0]
  const reads = remotePath => sftp.calls.filter(call => (
    call[0] === 'readFileChunk' && call[1] === remotePath
  )).length
  assert.equal(reads(resource.path), 3)
  assert.equal(reads(resource.stagingPath), 3)
  assert.equal(reads(resource.snapshotPath), 0)
  assert.deepEqual([...new Set(progress.map(item => item.phase))], [
    'source-scan',
    'snapshot-copy',
    'snapshot-verify'
  ])
  for (const phase of ['source-scan', 'snapshot-copy', 'snapshot-verify']) {
    const bytes = progress.filter(item => item.phase === phase)
      .map(item => item.completedBytes)
    assert.deepEqual(bytes, [...bytes].sort((left, right) => left - right))
  }
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node --test test/unit-ci/sftp-safety-transaction.spec.js
```

Expected: FAIL；`digestRemoteFile` 不报告字节，准备阶段仍读取最终 snapshot 多次。

- [ ] **Step 3: 给描述符摘要增加实际字节回调**

把适配器工厂签名扩展为可注入进度和轮询计时器；默认值保持所有旧调用兼容：

```js
export function createSftpTransactionAdapter ({
  getSftp,
  onProgress,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  const reportProgress = (operation, progress) => {
    if (operation.effect.action !== 'delete' || typeof onProgress !== 'function') return
    try {
      onProgress(operation, progress)
    } catch {}
  }
```

把 `digestRemoteFile` 签名改为：

```js
async function digestRemoteFile (
  sftp,
  path,
  expectedSize,
  signal,
  onBytes
) {
```

每次 `digest.update(bytes)` 成功后调用：

```js
if (typeof onBytes === 'function' && bytes.byteLength > 0) {
  onBytes(bytes.byteLength)
}
```

给 `describeEntry()` 增加最后一个可选参数 `byteProgress`，文件摘要传 `bytes => byteProgress?.addBytes(bytes)`，递归调用继续传同一个 tracker。新增：

```js
function createByteProgress (onProgress, phase, knownTotal = null) {
  let completedBytes = 0
  let totalBytes = Number.isFinite(knownTotal) && knownTotal >= 0
    ? knownTotal
    : null
  const publish = () => onProgress?.({ phase, completedBytes, totalBytes })
  publish()
  return {
    setKnownTotal (value) {
      if (Number.isFinite(value) && value >= 0) totalBytes = value
      publish()
    },
    addBytes (value) {
      const bytes = Number(value)
      if (!Number.isFinite(bytes) || bytes <= 0) return
      completedBytes += bytes
      publish()
    },
    finish () {
      if (totalBytes !== null) completedBytes = totalBytes
      publish()
    }
  }
}
```

根节点为文件时用其 `stat.size` 调用 `setKnownTotal()`；目录保持 `totalBytes: null`，但所有子文件实际读取字节仍累加且不回退。

把 `prepareNewManifest()` 扩展为 `prepareNewManifest(sftp, operation, signal, progressOptions = {})`，从中取得 `onProgress`。描述每个 source 时建立一个 tracker：

```js
const sourceProgress = createByteProgress(
  value => onProgress?.(value),
  'source-scan'
)
resource.original = await describeEntry(
  sftp,
  resource.path,
  createDescriptorBudget(),
  0,
  signal,
  sourceProgress
)
sourceProgress.finish()
```

- [ ] **Step 4: 实现最多 250 ms 一次的暂存大小轮询**

新增轮询器：

```js
function monitorSnapshotCopy ({
  sftp,
  resource,
  signal,
  onProgress,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let stopped = false
  let timer = null
  let lastBytes = 0
  const totalBytes = resource.original.type === 'file'
    ? resource.original.size
    : null
  const poll = async () => {
    if (stopped || signal?.aborted) return
    try {
      const stat = await lstatOrAbsent(sftp, resource.stagingPath, signal)
      if (stopped) return
      if (stat && totalBytes !== null) {
        lastBytes = Math.max(
          lastBytes,
          Math.min(Number(stat.size) || 0, totalBytes)
        )
        onProgress?.({
          phase: 'snapshot-copy',
          completedBytes: lastBytes,
          totalBytes
        })
      }
    } catch (error) {
      if (!isMissingError(error)) stopped = true
    }
    if (!stopped) timer = setTimer(poll, 250)
  }
  onProgress?.({ phase: 'snapshot-copy', completedBytes: 0, totalBytes })
  timer = setTimer(poll, 250)
  return () => {
    stopped = true
    if (timer !== null) clearTimer(timer)
  }
}
```

在 `copyEntry()` 前启动，在 `finally` 停止；复制完成时文件报告 `completedBytes === totalBytes`，目录继续报告不确定进度。轮询错误不得覆盖主复制结果。

把 `copyVerifiedSnapshot()` 扩展为 `copyVerifiedSnapshot(sftp, resource, signal, progressOptions = {})`，从中取得 `onProgress`、`setTimer` 和 `clearTimer`。接线使用：

```js
const publish = value => onProgress?.(value)
const stopMonitoring = monitorSnapshotCopy({
  sftp,
  resource,
  signal,
  onProgress: publish,
  setTimer,
  clearTimer
})
try {
  await sftp.copyEntry(resource.path, resource.stagingPath, { signal })
} finally {
  stopMonitoring()
}
publish({
  phase: 'snapshot-copy',
  completedBytes: resource.original.type === 'file' ? resource.original.size : 0,
  totalBytes: resource.original.type === 'file' ? resource.original.size : null
})
const snapshotProgress = createByteProgress(
  publish,
  'snapshot-verify',
  resource.original.type === 'file' ? resource.original.size : null
)
```

适配器 `prepare()` 先完整验证并复用已有清单；没有已有清单时调用新准备函数：

```js
const existing = await loadManifest(sftp, operation, context.signal)
if (existing) return existing
return prepareNewManifest(sftp, operation, context.signal, {
  onProgress: value => reportProgress(operation, value),
  setTimer,
  clearTimer
})
```

- [ ] **Step 5: 分离清单结构验证和完整快照验证**

把 `validateManifest` 和 `loadManifest` 增加选项：

```js
async function validateManifest (
  sftp,
  operation,
  manifest,
  signal,
  { verifySnapshots = true } = {}
) {
```

资源路径、id、effectKey、endpointKey、plan 和 artifacts 的现有结构检查始终执行；只有以下块受选项控制：

```js
if (verifySnapshots && manifest.plan.action !== 'chmod') {
  await verifySnapshot(sftp, actual, signal)
}
```

`loadManifest()` 原样透传选项，`requireManifest()` 同样接受并传递最后一个 `options = {}` 参数，所有旧调用继续使用默认完整验证。新增轻量元数据函数：

```js
function descriptorMetadata (descriptor) {
  if (descriptor.absent) return { absent: true }
  return {
    type: descriptor.type,
    mode: descriptor.mode,
    uid: descriptor.uid,
    gid: descriptor.gid,
    ...(descriptor.type === 'file' ? { size: descriptor.size } : {})
  }
}

async function verifySnapshotMetadata (sftp, resource, descriptor, signal) {
  const actual = await describeEntryMetadata(sftp, resource.snapshotPath, signal)
  if (!sameDescriptor(actual, descriptorMetadata(descriptor))) {
    throw new Error('SFTP 快照元数据发生变化，已拒绝继续操作。')
  }
  return actual
}
```

`describeEntryMetadata()` 只执行 `lstat`，返回 type/mode/uid/gid 和文件 size，不读取内容、不递归目录。

- [ ] **Step 6: 仅在新建安全删除清单的连续调用中去重**

让 `copyVerifiedSnapshot()` 返回已完整验证的 staged 描述符。对 `operation.effect.action === 'delete'`：

```js
const staged = await describeEntry(
  sftp,
  resource.stagingPath,
  createDescriptorBudget(),
  0,
  signal,
  snapshotProgress
)
if (!sameDescriptor(staged, resource.original)) {
  throw new Error('SFTP 快照复制不完整，已拒绝生成恢复清单。')
}
await sftp.rename(resource.stagingPath, resource.snapshotPath)
await verifySnapshotMetadata(sftp, resource, staged, signal)
return staged
```

清单原子提交后使用：

```js
const verified = await loadManifest(sftp, operation, signal, {
  verifySnapshots: operation.effect.action !== 'delete'
})
```

复用磁盘上已经存在的旧清单时仍用默认 `verifySnapshots: true`，因为该快照与当前调用之间存在可观察时间间隔。chmod、rename、editor-save、upload、copy、move 暂不改变验证次数。

- [ ] **Step 7: 运行安全回归并提交**

Run:

```powershell
node --test test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/sftp-delete-dialog.spec.js
```

Expected: PASS；准备阶段大文件仅有原文件一次、staging 一次完整摘要，final snapshot 为 0 次完整摘要；复制/清单/所有权失败仍关闭操作。

```powershell
git add -- src/client/components/sftp/sftp-transaction-adapter.js test/unit-ci/sftp-safety-transaction.spec.js
git commit -m "perf(sftp): remove repeated safe delete snapshot reads"
```

## Task 5：确认周期证明绑定与执行后复用

**Files:**
- Modify: `test/unit-ci/sftp-safety-transaction.spec.js`
- Modify: `src/client/components/sftp/sftp-transaction-adapter.js`

- [ ] **Step 1: 写入执行期摘要次数和证明失效测试**

增加：

```js
test('SFTP delete reuses only an execution proof bound to the same recovery', async () => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const sftp = createFakeSftp({
    '/srv/app/big.bin': { type: 'file', content: Buffer.alloc(180000, 9) }
  })
  const operation = await buildSftpOperation({
    id: 'adapter-delete-proof',
    action: 'delete',
    paths: { source: '/srv/app/big.bin' },
    type: 'file',
    expected: { absent: true }
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
  Object.assign(operation, await adapter.prepare(operation), {
    recoveryBinding: { schemaVersion: 2, algorithm: 'SHA-256', fingerprint: 'a'.repeat(64) }
  })
  assert.equal(adapter.bindPreparedProof(operation), true)
  sftp.calls.length = 0
  const executeResult = await adapter.beforeExecute(operation)
  const resource = operation.plan.resources[0]
  const snapshotReadsBeforeVerify = sftp.calls.filter(call => (
    call[0] === 'readFileChunk' && call[1] === resource.snapshotPath
  )).length
  assert.equal(snapshotReadsBeforeVerify, 3)
  await adapter.verifyExecute(operation, { executeResult })
  assert.equal(sftp.calls.filter(call => (
    call[0] === 'readFileChunk' && call[1] === resource.snapshotPath
  )).length, snapshotReadsBeforeVerify)
  assert.equal(sftp.exists(resource.path), false)
})

test('SFTP prepared proof rejects endpoint, recovery, path, and descriptor changes', async t => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const cases = [
    ['endpoint', operation => { operation.endpointKey = `${operation.endpointKey}-changed` }],
    ['recovery', operation => { operation.recoveryBinding.fingerprint = 'b'.repeat(64) }],
    ['path', operation => { operation.plan.resources[0].snapshotPath += '.changed' }],
    ['descriptor', operation => { operation.plan.resources[0].original.size += 1 }]
  ]
  for (const [name, mutation] of cases) {
    await t.test(name, async () => {
      const sftp = createFakeSftp({
        '/srv/app/file.txt': { type: 'file', content: 'original' }
      })
      const operation = await buildSftpOperation({
        id: `adapter-proof-mismatch-${Math.random()}`,
        action: 'delete',
        paths: { source: '/srv/app/file.txt' },
        type: 'file',
        expected: { absent: true }
      })
      const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
      Object.assign(operation, await adapter.prepare(operation), {
        recoveryBinding: { schemaVersion: 2, algorithm: 'SHA-256', fingerprint: 'a'.repeat(64) }
      })
      adapter.bindPreparedProof(operation)
      mutation(operation)
      await assert.rejects(
        adapter.beforeExecute(operation),
        /proof|证明|绑定|不匹配/i
      )
      assert.equal(sftp.exists('/srv/app/file.txt'), true)
    })
  }
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node --test test/unit-ci/sftp-safety-transaction.spec.js
```

Expected: FAIL；适配器没有 `bindPreparedProof`，`verifyExecute` 仍重复完整读取 snapshot。

- [ ] **Step 3: 建立只在适配器实例内存活的准备证明**

在 `createSftpTransactionAdapter()` 内创建 `preparedProofs`，使用克隆后的必要字段，禁止保存 SFTP client、回调或 signal：

```js
const preparedProofs = new Map()

function cloneProofValue (value) {
  return JSON.parse(JSON.stringify(value))
}

function proofPayload (operation) {
  return {
    operationId: operation.id,
    effectKey: operation.effectKey,
    endpointKey: operation.endpointKey,
    recoveryBinding: operation.recoveryBinding || null,
    resources: operation.plan.resources.map(resource => ({
      path: resource.path,
      snapshotPath: resource.snapshotPath,
      original: resource.original
    }))
  }
}

function rememberPreparedProof (operation, prepared) {
  preparedProofs.set(operation.id, {
    operationId: operation.id,
    effectKey: operation.effectKey,
    endpointKey: operation.endpointKey,
    recoveryBinding: null,
    resources: cloneProofValue(prepared.plan.resources.map(resource => ({
      path: resource.path,
      snapshotPath: resource.snapshotPath,
      original: resource.original
    })))
  })
}
```

`prepare()` 成功后调用 `rememberPreparedProof()`。适配器公开：

```js
bindPreparedProof (operation) {
  const proof = preparedProofs.get(operation.id)
  const expected = proofPayload(operation)
  const comparable = { ...expected, recoveryBinding: null }
  if (!proof || !sameDescriptor(proof, comparable) || !operation.recoveryBinding) {
    preparedProofs.delete(operation.id)
    throw new Error('SFTP 准备证明与恢复绑定不匹配。')
  }
  proof.recoveryBinding = cloneProofValue(operation.recoveryBinding)
  return true
},
discardPreparedProof (operationId) {
  preparedProofs.delete(operationId)
},
discardAllPreparedProofs () {
  preparedProofs.clear()
}
```

准备失败、取消、重试和连接重建时由调用方执行 `discardPreparedProof()`；`beforeExecute()` 取得证明后立即从 map 删除，不能跨第二次确认复用。

- [ ] **Step 4: 让执行前完整验证返回绑定证明**

修改 `verifySnapshot()` 返回完整 descriptor，并让 `verifySnapshot()` 与 `assertOriginalState()` 都接受最后一个可选 `byteProgress` 参数并传入 `describeEntry()`。先消费并验证 ready 前绑定的证明；无论成功或失败都立即从 map 删除：

```js
function consumePreparedProof (operation) {
  const proof = preparedProofs.get(operation.id)
  preparedProofs.delete(operation.id)
  const expected = proofPayload(operation)
  if (!proof || !sameDescriptor(proof, expected)) {
    throw new Error('SFTP 准备证明与当前执行事务不匹配。')
  }
  return proof
}
```

生产安全删除的 operation 必有 `recoveryBinding`；`beforeExecute()` 在任何远端修改前调用 `consumePreparedProof(operation)`。为保留现有适配器级单元测试的直接调用方式，仅当测试 operation 没有 recoveryBinding 时跳过内存证明消费；真实 runner 在进入 adapter 前已经强制要求 recovery binding：

```js
if (action === 'delete' && operation.recoveryBinding) {
  consumePreparedProof(operation)
}
```

随后仍执行结构清单验证、最终 snapshot 一次完整摘要、原文件一次完整描述，最后才 rename/remove。snapshot 和 original 共用同一个 `deleting` tracker，文件总量是所有原始文件大小的两倍，目录总量保持未知，确保同一阶段字节只增不减：

```js
const knownDeleteBytes = operation.plan.resources.every(resource => (
  resource.original.type === 'file'
))
  ? operation.plan.resources.reduce((sum, resource) => (
      sum + resource.original.size * 2
    ), 0)
  : null
const deleteProgress = createByteProgress(
  value => reportProgress(operation, value),
  'deleting',
  knownDeleteBytes
)
const verifiedSnapshots = []
for (const resource of operation.plan.resources) {
  verifiedSnapshots.push({
    resource,
    descriptor: await verifySnapshot(sftp, resource, signal, deleteProgress)
  })
  await assertOriginalState(sftp, resource, action, signal, deleteProgress)
}
deleteProgress.finish()
```

随后返回：

```js
return {
  summary: `SFTP ${action} 已执行，等待验证。`,
  ...(action === 'delete'
    ? {
        snapshotProof: {
          ...proofPayload(operation),
          resources: verifiedSnapshots.map(({ resource, descriptor }) => ({
            path: resource.path,
            snapshotPath: resource.snapshotPath,
            descriptor
          }))
        }
      }
    : {})
}
```

执行前进度统一报告 `phase: 'deleting'`，字节来自 snapshot 与原文件分块读取；实际 remove 前必须再次检查 signal。

- [ ] **Step 5: 执行后只复用同一 runner 调用传入的证明**

新增严格校验：

```js
function requireExecutionProof (operation, executeResult) {
  const proof = executeResult?.snapshotProof
  if (!proof || proof.operationId !== operation.id ||
    proof.effectKey !== operation.effectKey ||
    proof.endpointKey !== operation.endpointKey ||
    !sameDescriptor(proof.recoveryBinding, operation.recoveryBinding) ||
    !Array.isArray(proof.resources)) {
    throw new Error('SFTP 执行证明与当前事务不匹配。')
  }
  for (const resource of operation.plan.resources) {
    const item = proof.resources.find(value => value.path === resource.path)
    if (!item || item.snapshotPath !== resource.snapshotPath ||
      !sameDescriptor(item.descriptor, resource.original)) {
      throw new Error('SFTP 执行证明资源不匹配。')
    }
  }
  return proof
}
```

`verifyExecute()` 对 delete 且存在 `context.executeResult` 时：

```js
const proof = requireExecutionProof(operation, context.executeResult)
await requireManifest(sftp, operation, context.signal, { verifySnapshots: false })
reportProgress(operation, {
  phase: 'result-verify',
  completedBytes: 0,
  totalBytes: null
})
await verifyExecuteState(sftp, operation, context.signal)
for (const item of proof.resources) {
  const resource = operation.plan.resources.find(value => value.path === item.path)
  await verifySnapshotMetadata(sftp, resource, item.descriptor, context.signal)
}
reportProgress(operation, {
  phase: 'result-verify',
  completedBytes: 1,
  totalBytes: null
})
```

随后生成 postMutation。没有 `executeResult` 的旧直接调用保留现有完整 `requireManifest()` 路径；runner 已经把 `beforeExecute` 结果通过 `context.executeResult` 传入，所以生产安全删除走证明路径。恢复和 verifyRollback 不得使用该证明。

- [ ] **Step 6: 运行安全事务完整回归并提交**

Run:

```powershell
node --test test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/safety-transaction-*.spec.js
```

Expected: PASS；执行前 snapshot 和 original 各完整验证一次，执行后 snapshot 不再重复完整读取；证明任一绑定字段变化都在删除前失败。

```powershell
git add -- src/client/components/sftp/sftp-transaction-adapter.js test/unit-ci/sftp-safety-transaction.spec.js
git commit -m "perf(sftp): reuse bound delete verification proof"
```

## Task 6：对话框接线、乐观列表更新和单次后台校准

**Files:**
- Modify: `test/unit-ci/sftp-entry-lifecycle.spec.js`
- Modify: `test/unit-ci/sftp-refresh-behavior.spec.js`
- Modify: `test/unit-ci/sftp-safety-transaction.spec.js`
- Modify: `src/client/components/sftp/sftp-entry-lifecycle.js`
- Modify: `src/client/components/sftp/sftp-entry.jsx`

- [ ] **Step 1: 写入 1000 项乐观移除纯函数测试**

在 `test/unit-ci/sftp-entry-lifecycle.spec.js` 增加：

```js
test('safe delete removes matching absolute paths from a 1000 item remote list', async () => {
  const { removeDeletedRemoteEntries } = await loadModule()
  const remote = Array.from({ length: 1000 }, (_, index) => ({
    id: `remote-${index}`,
    type: 'remote',
    path: '/srv/app',
    name: `item-${index}.txt`
  }))
  const next = removeDeletedRemoteEntries(remote, [
    '/srv/app/item-10.txt',
    '/srv/app/./item-999.txt'
  ])
  assert.equal(next.length, 998)
  assert.equal(next.some(file => file.name === 'item-10.txt'), false)
  assert.equal(next.some(file => file.name === 'item-999.txt'), false)
  assert.equal(next[0], remote[0])
})
```

- [ ] **Step 2: 写入入口同步更新与无固定等待契约**

在 `test/unit-ci/sftp-refresh-behavior.spec.js` 增加：

```js
test('safe delete updates the list immediately and calibrates once in background', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('delFiles = async')
  const end = source.indexOf('\n  renderDelConfirmTitle', start)
  const body = source.slice(start, end)
  assert.match(body, /applyOptimisticRemoteDelete/)
  assert.match(body, /void this\.calibrateRemoteAfterSafeDelete\(\)/)
  assert.doesNotMatch(body, /wait\(500\)/)
  assert.equal((body.match(/calibrateRemoteAfterSafeDelete/g) || []).length, 1)
})

test('background safe delete calibration can surface one actionable warning', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('calibrateRemoteAfterSafeDelete = async')
  const end = source.indexOf('\n  delFiles = async', start)
  const body = source.slice(start, end)
  assert.match(body, /remoteList\(false, undefined, undefined, \{[\s\S]*rethrow: true/)
  assert.match(body, /shellpilotSftpStateCalibrationFailed/)
  assert.equal((body.match(/message\.warning/g) || []).length, 1)
})
```

更新 `sftp-safety-transaction.spec.js` 的 UI 源码契约，要求 `bindPreparedProof` 位于 `dialog.ready` 之前，进度 handler 在 cancel/retry/执行完成时清理。

- [ ] **Step 3: 运行测试并确认 RED**

Run:

```powershell
node --test test/unit-ci/sftp-entry-lifecycle.spec.js test/unit-ci/sftp-refresh-behavior.spec.js test/unit-ci/sftp-safety-transaction.spec.js
```

Expected: FAIL；没有乐观移除函数，`delFiles` 仍固定等待 500 ms。

- [ ] **Step 4: 实现绝对路径乐观移除**

在 `sftp-entry-lifecycle.js` 导入现有 `resolve` 与 `normalizeRemotePath`，追加：

```js
export function removeDeletedRemoteEntries (remote = [], deletedPaths = []) {
  const targets = new Set(deletedPaths.map(path => (
    normalizeRemotePath(String(path || ''))
  )))
  if (!targets.size) return remote
  return remote.filter(file => {
    if (!file || file.isParent || file.isEmpty || file.isEditing) return true
    const absolutePath = normalizeRemotePath(resolve(file.path, file.name))
    return !targets.has(absolutePath)
  })
}
```

- [ ] **Step 5: 把适配器进度绑定到每个目标**

在 constructor 中建立 handler map：

```js
this.sftpSafetyProgressHandlers = new Map()
this.sftpSafetyAdapter = createSftpTransactionAdapter({
  getSftp: () => this.sftp,
  onProgress: (operation, progress) => {
    this.sftpSafetyProgressHandlers.get(operation.id)?.(progress)
  }
})
```

`prepareSftpSafetyOperation()` 接受 `onProgress`。生成 request 后、调用 runner 前注册，失败时清理：

```js
if (typeof onProgress === 'function') {
  this.sftpSafetyProgressHandlers.set(request.id, onProgress)
}
try {
  return await this.sftpSafetyRunner.prepare(request)
} catch (error) {
  this.sftpSafetyProgressHandlers.delete(request.id)
  this.sftpSafetyAdapter.discardPreparedProof(request.id)
  throw error
}
```

componentWillUnmount 时执行 `this.sftpSafetyProgressHandlers.clear()` 和 `this.sftpSafetyAdapter.discardAllPreparedProofs()`；`handleReloadRemoteSftp()` 在销毁连接前也执行这两项。取消、重试、执行成功/失败时按 operation id 同时删除 handler 和 prepared proof。

- [ ] **Step 6: 按目标序号驱动同一个安全删除对话框**

准备每个目标时传：

```js
onProgress: progress => dialog.progress({
  ...progress,
  targetIndex: index + 1,
  targetCount: targets.length
})
```

`Promise.allSettled` 完成后，对每个 fulfilled operation 先执行：

```js
this.sftpSafetyAdapter.bindPreparedProof(operation)
```

全部绑定成功后才 `dialog.ready(operations.length)`。执行循环开始前和每项验证时使用：

```js
dialog.progress({
  phase: 'deleting',
  completedBytes: 0,
  totalBytes: null,
  targetIndex: index + 1,
  targetCount: operations.length
})
```

runner 的 adapter 进度会继续更新字节；执行后报告 `result-verify`。全部成功时：

```js
const deletedPaths = targets.map(file => resolve(file.path, file.name))
dialog.complete()
return {
  deletedPaths,
  operationCount: operations.length,
  recoverable: true
}
```

准备失败可重试；执行失败调用 `dialog.fail(error, { retryable: false })`，保留恢复记录并继续向上抛错，不得直接删除。

FTP 的既有永久删除分支不创建 dialog 或安全证明，成功返回同样的结果形状但明确 `recoverable: false`：

```js
return {
  deletedPaths: files.map(file => resolve(file.path, file.name)),
  operationCount: files.length,
  recoverable: false
}
```

- [ ] **Step 7: 同步移除列表并异步校准一次**

导入 `removeDeletedRemoteEntries`，新增：

```js
applyOptimisticRemoteDelete = (deletedPaths) => {
  this.setState(prevState => {
    const remote = removeDeletedRemoteEntries(prevState.remote, deletedPaths)
    return {
      remote,
      remoteFileTree: this.buildTree(remote, typeMap.remote),
      selectedFiles: new Set(),
      selectedType: ''
    }
  })
}

calibrateRemoteAfterSafeDelete = async () => {
  try {
    await this.remoteList(false, undefined, undefined, {
      rethrow: true,
      suppressVisibleError: true
    })
  } catch (error) {
    message.warning(e('shellpilotSftpStateCalibrationFailed'))
  }
}
```

给 `remoteList` 增加第四个默认参数 `options = {}`；catch 中仅在 `!options.suppressVisibleError` 时调用现有 `onError`，并在状态恢复后：

```js
if (options.rethrow) throw error
```

把远端分支的 `delFiles` 改为：

```js
const result = await this.deleteRemoteFilesWithSafety(files, options)
if (!result) return false
this.applyOptimisticRemoteDelete(result.deletedPaths)
if (result.recoverable) {
  message.success(formatShellPilotTranslation(e, 'shellpilotSftpDeletedWithRecovery', {
    count: result.operationCount
  }))
}
void this.calibrateRemoteAfterSafeDelete()
return true
```

删除原来的 `await wait(500)`、同步 `await this.remoteList()` 和 `deleteRemoteFilesWithSafety` 内部的成功消息。快速删除代码不改。

- [ ] **Step 8: 运行聚焦回归并提交**

Run:

```powershell
node --test test/unit-ci/sftp-entry-lifecycle.spec.js test/unit-ci/sftp-refresh-behavior.spec.js test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/sftp-fast-delete.spec.js
```

Expected: PASS；1000 项纯函数测试通过，安全删除没有固定等待且只发起一次后台校准，快速删除契约不变。

```powershell
git add -- src/client/components/sftp/sftp-entry-lifecycle.js src/client/components/sftp/sftp-entry.jsx test/unit-ci/sftp-entry-lifecycle.spec.js test/unit-ci/sftp-refresh-behavior.spec.js test/unit-ci/sftp-safety-transaction.spec.js
git commit -m "perf(sftp): update safe delete results immediately"
```

## Task 7：三轮真实 Electron 性能与交互验收

**Files:**
- Modify: `test/e2e/027.quality-core-flows.spec.js`

- [ ] **Step 1: 把安全删除 fixture 扩展为三轮 32 MiB**

在测试准备区增加：

```js
const safeDeleteBody = Buffer.alloc(32 * 1024 * 1024, 0x6d)
const safeDeleteSamples = []
```

用以下循环替换单个小文件安全删除片段：

```js
let lastSafeDeleteName = ''
for (let index = 0; index < 3; index += 1) {
  const safeDeleteName = `quality-safe-delete-${index}.bin`
  lastSafeDeleteName = safeDeleteName
  const safeDeletePath = fixture.resolve(`/${safeDeleteName}`)
  await fs.promises.writeFile(safeDeletePath, safeDeleteBody)
  await page.evaluate(async () => {
    await window.refs.get('sftp-' + window.store.activeTabId).remoteList()
  })
  const safeDeleteRow = page.locator(
    `.session-current .file-list.remote .sftp-item[title="${safeDeleteName}"]`
  )
  await expect(safeDeleteRow).toBeVisible({ timeout: 20000 })
  await safeDeleteRow.click({ button: 'right' })
  const safeDeleteMenu = page.locator('.ant-dropdown:visible').last()
  const clickedAt = Date.now()
  await safeDeleteMenu.getByText(/安全删除.*可恢复|Safe Delete.*Recoverable/i).click()
  const safeDeleteConfirm = page.locator('.custom-modal-wrap:visible').last()
  await expect(safeDeleteConfirm).toBeVisible({ timeout: 1000 })
  expect(Date.now() - clickedAt).toBeLessThan(150)
  await expect(safeDeleteConfirm.locator('.custom-modal-ok-btn')).toBeDisabled()
  await expect(safeDeleteConfirm.locator('.sftp-safe-delete-progress')).toBeVisible()
  await expect(safeDeleteConfirm).toContainText(
    /扫描原文件|复制恢复快照|验证恢复快照|Scanning source|Copying recovery snapshot|Verifying recovery snapshot/i
  )
  await expect(safeDeleteConfirm).toContainText(
    /恢复快照已验证|Recovery snapshots verified/i,
    { timeout: 30000 }
  )
  const readyAt = Date.now()
  await expect(safeDeleteConfirm.locator('.custom-modal-ok-btn')).toBeEnabled()
  await safeDeleteConfirm.locator('button.custom-modal-ok-btn').click()
  await expect(safeDeleteConfirm).toContainText(
    /复核并安全删除|确认删除结果|Rechecking and safely deleting|Verifying deletion result/i
  )
  await expect.poll(() => pathExists(safeDeletePath), { timeout: 30000 }).toBe(false)
  await expect(safeDeleteRow).toHaveCount(0, { timeout: 1000 })
  safeDeleteSamples.push({
    prepareMs: readyAt - clickedAt,
    confirmToListMs: Date.now() - readyAt
  })
}
await test.info().attach('sftp-safe-delete-performance.json', {
  body: Buffer.from(JSON.stringify(safeDeleteSamples, null, 2)),
  contentType: 'application/json'
})
console.log(`[sftp-safe-delete] ${JSON.stringify(safeDeleteSamples)}`)
expect(safeDeleteSamples.every(sample => sample.prepareMs < 10760)).toBe(true)
expect(safeDeleteSamples.every(sample => sample.confirmToListMs < 7470)).toBe(true)
```

安全中心回归继续使用 `lastSafeDeleteName` 断言记录存在。阈值取已测 v0.4.42 三轮最小值，要求每轮都明显优于旧基线，而不是只比较平均值。

- [ ] **Step 2: 运行 E2E 并确认新断言先暴露未完成接线**

Run:

```powershell
npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1
```

Expected before Tasks 3–6: FAIL 于阶段进度、保持打开、列表 1 秒内移除或旧基线预算。完成 Tasks 3–6 后应 PASS。

- [ ] **Step 3: 只修复 E2E 暴露的真实接线缺口**

如果测试失败，先保存 trace/截图和性能附件，并停止 Task 7；根据失败归属返回 Task 2（布局）、Task 3（对话框）、Task 4（准备进度）、Task 5（验证证明）或 Task 6（列表刷新），在该任务指定的 unit spec 中先写失败回归，再按原任务步骤修复并重新提交。Task 7 本身不接受临时生产改动，也不得放宽以下断言：进度坞在视口内、确认前禁用、三轮 32 MiB、列表 1 秒内移除、摘要计数和恢复中心记录。

- [ ] **Step 4: 再跑两次确认稳定性**

Run:

```powershell
npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1 --repeat-each=2
```

Expected: 两次全部 PASS；附件共记录 6 组 prepare/confirm-to-list 数据，无 renderer pageerror、凭据泄漏或恢复记录缺失。

- [ ] **Step 5: 提交 E2E 验收**

```powershell
git add -- test/e2e/027.quality-core-flows.spec.js
git commit -m "test(sftp): enforce visible and responsive safe operations"
```

## Task 8：v0.4.43 发布元数据

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `docs/releases/v0.4.43.md`

- [ ] **Step 1: 写入版本和发布说明**

把 `package.json`、`package-lock.json` 顶层 `version` 和 `package-lock.json` 的 `packages[""].version` 从 `0.4.42` 改为 `0.4.43`。

`package.json` 顶部应为：

```json
{
  "name": "ssh-agent-tool",
  "version": "0.4.43",
  "productName": "ShellPilot"
}
```

`package-lock.json` 的两个项目版本字段应为：

```json
{
  "name": "ssh-agent-tool",
  "version": "0.4.43",
  "packages": {
    "": {
      "name": "ssh-agent-tool",
      "version": "0.4.43"
    }
  }
}
```

以上是需改字段的结构片段；保留两个 JSON 文件中的所有其他现有字段和依赖内容。

创建 `docs/releases/v0.4.43.md`：

```md
# ShellPilot v0.4.43

## [新增]

- 安全删除现在持续显示原文件扫描、恢复快照复制、快照验证、删除和结果确认阶段；可取得可靠总量时同时显示真实字节与百分比。

## [修复]

- 修复部分窗口尺寸下 SFTP 上传进度坞被视口底部裁切的问题；上传和下载进度现在始终完整显示在当前工作区可见范围内。
- 修复安全删除准备和确认后重复读取完整快照摘要导致响应过慢的问题，同时保留确认前、删除前和恢复前的完整安全验证。

## [改动]

- 安全删除成功后立即从当前远端列表移除目标，再在后台执行一次状态校准，不再固定等待 500 ms。
- 安全删除的短生命周期验证证明严格绑定事务、端点、恢复绑定、路径和描述符；取消、重试、连接或元数据变化都会使其失效。
```

- [ ] **Step 2: 运行发布元数据测试**

Run:

```powershell
node --test test/unit-ci/release-version-baseline.spec.js test/unit-ci/release-version-consistency.spec.js test/unit-ci/release-notes.spec.js
```

Expected: PASS；当前包版本高于 v0.4.42 基线，lock 与 package 一致，三段发布说明存在。

- [ ] **Step 3: 提交版本元数据**

```powershell
git add -- package.json package-lock.json docs/releases/v0.4.43.md
git commit -m "chore: prepare ShellPilot v0.4.43"
```

## Task 9：完整验证、评审、合并与发布

**Files:**
- Verify only; production source should already be committed.

- [ ] **Step 1: 运行聚焦格式与测试**

Run:

```powershell
npx standard src/client/components/common/modal.jsx src/client/components/sftp/sftp-transfer-dock-layout.js src/client/components/sftp/sftp-transfer-progress-dock.jsx src/client/components/sftp/sftp-delete-dialog-model.js src/client/components/sftp/sftp-delete-dialog.jsx src/client/components/sftp/sftp-transaction-adapter.js src/client/components/sftp/sftp-entry-lifecycle.js src/client/components/sftp/sftp-entry.jsx test/unit-ci/sftp-transfer-dock-layout.spec.js test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/sftp-entry-lifecycle.spec.js test/unit-ci/sftp-refresh-behavior.spec.js test/e2e/027.quality-core-flows.spec.js
node --test test/unit-ci/sftp-transfer-dock-layout.spec.js test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/sftp-entry-lifecycle.spec.js test/unit-ci/sftp-refresh-behavior.spec.js test/unit-ci/sftp-fast-delete.spec.js test/unit-ci/ui-accessibility-contract.spec.js
git diff --check origin/master...HEAD
```

Expected: Standard 无输出、所有聚焦测试 PASS、`git diff --check` 无输出。

- [ ] **Step 2: 运行完整常规功能自检**

Run:

```powershell
npm run test-unit-ci
npm run lint
npm run smoke:ssh-sftp
npm run smoke:safety
npx playwright test test/e2e/027.quality-core-flows.spec.js test/e2e/028.crash-recovery.spec.js test/e2e/038.client-interaction-performance.spec.js --workers=1
```

Expected: 全部 PASS；上传、下载、进度终态、快速删除、安全删除、恢复、SSH 基础流程、崩溃恢复和常规交互性能无回归。

- [ ] **Step 3: 执行代码评审与完成前验证技能**

调用 `requesting-code-review`。每个确认问题先写失败测试再修复并提交。随后调用 `verification-before-completion`，重新运行所有受影响命令，不使用旧日志代替新证据。

- [ ] **Step 4: 检查提交边界**

Run:

```powershell
git status --short --branch
git log --oneline origin/master..HEAD
git diff --stat origin/master...HEAD
git diff --name-only origin/master...HEAD
```

Expected: 仅 `.superpowers/`、`audit-results/` 仍为未跟踪且不在 diff；所有计划内源文件、测试、设计、计划和 v0.4.43 元数据已提交；无 dist、截图、凭据或外部服务器配置。

- [ ] **Step 5: 推送、创建 PR 并合并**

Run:

```powershell
git push -u origin codex/sftp-response-performance
gh pr create --base master --head codex/sftp-response-performance --title "fix: improve SFTP progress and safe delete responsiveness" --body "Fixes viewport-clipped SFTP transfer progress, adds real safe-delete stages and byte progress, removes duplicate snapshot reads, and updates the remote list immediately while preserving recoverability. Includes three-run 32 MiB Electron acceptance coverage and prepares v0.4.43."
gh pr checks --watch
gh pr merge --merge --delete-branch
```

Expected: PR checks PASS，PR 以 merge commit 合入 `master`。记录 PR URL 和 merge commit。

- [ ] **Step 6: 从已合并 master 构建 Windows 发布资产**

当前工作树必须 clean（除计划明确忽略的两个未跟踪目录）后执行：

```powershell
git fetch origin master --tags
git switch --detach origin/master
npm run b
npm run pb
npx cross-env PYTHONUTF8=1 electron-builder --win --x64 --publish never
npm run release:approval
npm run release:prepare-assets
npm run release:local:verify
npm run release:github:dry
```

Expected: Windows x64 安装包/便携包和 updater 元数据均为 0.4.43；本地资产、checksums、approval manifest、latest.yml 与 dry-run 发布命令全部验证通过。

- [ ] **Step 7: 发布并验证在线更新源**

Run:

```powershell
npm run release:github
npm run release:github:verify
npm run release:modelscope
npm run release:modelscope:hub
npm run release:update-sources:verify
```

Expected: GitHub Release `v0.4.43` 发布成功，ModelScope 两条同步路径成功，严格在线更新源字节验证通过。记录 release URL、tag、资产名称和校验结果。

- [ ] **Step 8: 最终交付核对**

Run:

```powershell
gh release view v0.4.43 --json url,tagName,isDraft,isPrerelease,assets
git show --no-patch --oneline origin/master
```

Expected: release 非 draft、非 prerelease，tag 为 `v0.4.43`，必要 Windows 资产齐全；最终回复包含 PR、merge commit、release URL、三轮性能数据、完整测试结果和未提交目录说明。

## 规格覆盖矩阵

| 设计/验收要求 | 计划任务 |
| --- | --- |
| 上传/下载进度坞不超出视口 | Tasks 1–2、7、9 |
| 不假设标签栏固定高度；resize/observer 清理 | Tasks 1–2 |
| 点击安全删除立即反馈、确认前禁用 | Tasks 3、6、7 |
| source/copy/snapshot/ready/delete/result 阶段 | Tasks 3–7 |
| 摘要真实字节、复制最多 250 ms 轮询、UI 100 ms 节流 | Tasks 3–4 |
| 准备阶段移除连续调用内重复完整摘要 | Task 4 |
| 执行前 snapshot 与 original 仍完整验证 | Task 5 |
| 执行后复用同一 runner 调用的绑定证明 | Task 5 |
| operation/endpoint/recovery/path/descriptor 失效 | Tasks 5–6 |
| 取消、重试、断线和错误失败关闭 | Tasks 3–6、9 |
| 删除后同步乐观移除、无 500 ms、后台一次校准 | Task 6 |
| 快速删除、恢复中心、FTP、AI/MCP 不变 | Tasks 6–7、9 |
| 32 MiB 三轮性能、1000 项列表、完整常规自检 | Tasks 6–7、9 |
| 合并并发布 v0.4.43 | Tasks 8–9 |
