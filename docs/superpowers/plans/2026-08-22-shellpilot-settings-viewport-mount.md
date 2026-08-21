# ShellPilot Settings Viewport Mount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将设置抽屉的打开关键路径限制为首屏内容，并在用户滚动到离屏区块附近时逐帧挂载对应区块，使冷打开、暖打开、稳定帧和 Long Task 全部达到既定预算。

**Architecture:** `SettingCommon` 首次只渲染启动区块和三个等高占位，通过以 `.setting-col-content` 为根的 `IntersectionObserver` 请求具体区块。独立调度器对区块编号去重，并保证每个动画帧至多执行一次挂载；性能测试以首屏区块为就绪信号，功能测试再逐个滚动并验证全部区块。

**Tech Stack:** React class components、JavaScript ES modules、Stylus、Node.js test runner、Playwright、Electron。

---

## 文件职责

- `apps/electerm-agent/src/client/common/frame-batched-mount.js`：维护按需区块请求队列、请求去重、单帧挂载上限和取消语义。
- `apps/electerm-agent/src/client/components/setting-panel/setting-common.jsx`：维护已挂载区块集合，连接占位节点、视口观察器和调度器生命周期。
- `apps/electerm-agent/src/client/components/setting-panel/setting.styl`：维持离屏占位高度和区块渲染隔离。
- `apps/electerm-agent/test/unit-ci/frame-batched-mount.spec.js`：验证调度器独立请求、去重、逐帧和取消行为。
- `apps/electerm-agent/test/unit-ci/shellpilot-client-ux-performance.spec.js`：验证设置组件使用视口驱动而非后台全量挂载。
- `apps/electerm-agent/test/unit-ci/shellpilot-ui-responsive.spec.js`：验证四个设置区块、占位和响应式结构契约。
- `apps/electerm-agent/test/e2e/038.client-interaction-performance.spec.js`：执行首屏性能门禁，并真实滚动验证全部区块。

### Task 1: 将自动全量调度器改为按需区块队列

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/frame-batched-mount.spec.js`
- Modify: `apps/electerm-agent/src/client/common/frame-batched-mount.js`

- [ ] **Step 1: 写入按需调度 RED 测试**

将测试改为只提供帧桩，并验证未请求时不调度、重复请求去重、不同区块每帧只挂载一个、取消后无陈旧回调：

```js
test('frame batched mount only mounts requested sections one per frame', async () => {
  const { createFrameBatchedMount } = await loadScheduler()
  const harness = createHarness()
  const mounted = []
  const scheduler = createFrameBatchedMount({
    onMount: index => mounted.push(index),
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame
  })

  scheduler.start([1])
  assert.equal(harness.frames.size, 0)
  scheduler.request(3)
  scheduler.request(3)
  scheduler.request(2)
  assert.equal(harness.frames.size, 1)
  harness.runFrame()
  assert.deepEqual(mounted, [3])
  assert.equal(harness.frames.size, 1)
  harness.runFrame()
  assert.deepEqual(mounted, [3, 2])
  assert.equal(harness.frames.size, 0)
})

test('frame batched mount cancels pending requests', async () => {
  const { createFrameBatchedMount } = await loadScheduler()
  const harness = createHarness()
  const mounted = []
  const scheduler = createFrameBatchedMount({
    onMount: index => mounted.push(index),
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame
  })

  scheduler.start([1])
  scheduler.request(4)
  scheduler.cancel()
  assert.equal(harness.frames.size, 0)
  assert.deepEqual(mounted, [])
  scheduler.request(2)
  assert.equal(harness.frames.size, 0)
})
```

- [ ] **Step 2: 运行测试并确认旧实现失败**

Run:

```powershell
Set-Location apps/electerm-agent
node --test test/unit-ci/frame-batched-mount.spec.js
```

Expected: FAIL，旧 API 需要 `total` 且没有 `request()`。

- [ ] **Step 3: 实现最小按需调度器**

用以下接口替换自动递增和硬超时逻辑：

```js
export function createFrameBatchedMount ({
  onMount,
  requestFrame = window.requestAnimationFrame.bind(window),
  cancelFrame = window.cancelAnimationFrame.bind(window)
}) {
  const mounted = new Set()
  const pending = []
  let frameId = null
  let active = false

  function scheduleNext () {
    if (!active || frameId !== null || pending.length === 0) return
    frameId = requestFrame(() => {
      frameId = null
      if (!active) return
      const index = pending.shift()
      mounted.add(index)
      onMount(index)
      scheduleNext()
    })
  }

  return {
    start (initial = []) {
      if (active) return
      active = true
      initial.forEach(index => mounted.add(index))
      scheduleNext()
    },
    request (index) {
      if (!active || mounted.has(index) || pending.includes(index)) return
      pending.push(index)
      scheduleNext()
    },
    cancel () {
      active = false
      pending.splice(0)
      if (frameId !== null) cancelFrame(frameId)
      frameId = null
    }
  }
}
```

- [ ] **Step 4: 运行调度器测试确认 GREEN**

Run: `node --test test/unit-ci/frame-batched-mount.spec.js`

Expected: 2 tests PASS，0 fail。

### Task 2: 让 SettingCommon 只挂载进入视口的区块

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-client-ux-performance.spec.js`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-common.jsx`
- Verify: `apps/electerm-agent/src/client/components/setting-panel/setting.styl`

- [ ] **Step 1: 添加视口驱动源码契约 RED 断言**

在设置性能源码测试中加入：

```js
assert.match(source, /mountedSectionIndexes: \[1\]/)
assert.match(source, /this\.sectionScheduler\.request\(index\)/)
assert.match(source, /root: document\.querySelector\('\.setting-col-content'\)/)
assert.doesNotMatch(source, /maxDelayMs/)
assert.doesNotMatch(source, /mountThrough/)
```

- [ ] **Step 2: 运行相关测试并确认旧实现失败**

Run:

```powershell
node --test test/unit-ci/shellpilot-client-ux-performance.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
```

Expected: FAIL，旧组件仍使用 `mountedSectionCount`、`maxDelayMs` 和 `mountThrough`。

- [ ] **Step 3: 将组件状态改为独立区块集合**

把状态字段改为：

```js
mountedSectionIndexes: [1],
```

调度回调使用函数式状态更新并去重：

```js
onMount: index => this.setState(state => ({
  mountedSectionIndexes: state.mountedSectionIndexes.includes(index)
    ? state.mountedSectionIndexes
    : [...state.mountedSectionIndexes, index]
}))
```

- [ ] **Step 4: 将观察器改为按具体编号请求**

`startSectionMount` 中先 `start([1])`，观察器只请求相交节点；浏览器不支持观察器时延迟 100ms 请求剩余区块：

```js
this.sectionScheduler.start([1])
if (window.IntersectionObserver) {
  this.sectionObserver = new window.IntersectionObserver(entries => {
    entries
      .filter(entry => entry.isIntersecting)
      .map(entry => Number(entry.target.dataset.sectionIndex))
      .forEach(index => this.sectionScheduler.request(index))
  }, {
    root: document.querySelector('.setting-col-content'),
    rootMargin: '0px'
  })
  for (const node of this.sectionPlaceholders.values()) {
    this.sectionObserver.observe(node)
  }
  return
}
this.sectionFallbackTimer = window.setTimeout(() => {
  [2, 3, 4].forEach(index => this.sectionScheduler.request(index))
}, 100)
```

在 `componentWillUnmount` 中增加：

```js
clearTimeout(this.sectionFallbackTimer)
```

- [ ] **Step 5: 按独立区块状态决定真实内容或占位**

把 `renderDeferredSection` 判断改为：

```js
if (this.state.mountedSectionIndexes.includes(index)) {
```

保留现有三个占位的 `data-section-index`、`ref` 和 Stylus 固有高度规则。

- [ ] **Step 6: 运行组件与调度器单元测试确认 GREEN**

Run:

```powershell
node --test test/unit-ci/frame-batched-mount.spec.js test/unit-ci/shellpilot-client-ux-performance.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
```

Expected: 全部 PASS，0 fail。

### Task 2A: 细分首屏控件并替换重型导航页签

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-client-ux-performance.spec.js`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-modal.jsx`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-common.jsx`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-wrap.styl`

- [ ] **Step 1: 写入轻量页签和首屏细分 RED 契约**

加入源码断言：`setting-modal.jsx` 必须包含 `SettingsTabNavigation`、原生 `role='tablist'`、方向键/Home/End 和 roving `tabIndex`，且不再渲染 `<Tabs>`；`setting-common.jsx` 不得包含 `LoadingOutlined`、`ready` 或诊断全局变量，并必须包含 `mountedStartupDetails: []`、160ms 延迟、`session`/`numbers` 两个调度请求和对应稳定占位。

- [ ] **Step 2: 运行 RED 契约**

Run: `node --test test/unit-ci/shellpilot-client-ux-performance.spec.js`

Expected: FAIL，诊断实现仍包含 Ant Design Tabs、加载二次提交和 A/B 开关。

- [ ] **Step 3: 实现原生可访问页签**

`SettingsTabNavigation` 输出 `.setting-tabs > .setting-tabs-native-list`，每个按钮使用 `role='tab'`、`aria-selected` 和活动项 `tabIndex=0`。ArrowLeft/ArrowUp、ArrowRight/ArrowDown、Home、End 计算目标索引，调用 `onChange(items[nextIndex].key)`，并在下一帧聚焦目标按钮。删除 `Tabs` import 和诊断条件分支。

- [ ] **Step 4: 首次直接提交快捷键，分帧补齐其余启动控件**

删除 `ready` 状态、加载图标和零延时提交。新增 `mountedStartupDetails: []`，组件挂载时启动第二个 `createFrameBatchedMount`；160ms 定时器依次请求字符串键 `session`、`numbers`。快捷键同步渲染；启动会话和数值项未挂载时分别渲染不可聚焦的等高占位，挂载后保留原业务组件和处理函数。卸载时清理定时器并取消两个调度器。

- [ ] **Step 5: 添加原生页签与启动占位样式**

`.setting-tabs-native-list` 使用横向 flex 和可滚动溢出；tab 按钮使用现有主题背景、边框、圆角和 focus-visible token；`[aria-selected='true']` 使用选中态。启动会话和数值占位的高度之和保持首个区块原来的约 300px 内容范围。

- [ ] **Step 6: 运行 GREEN 单元测试**

Run:

```powershell
node --test test/unit-ci/frame-batched-mount.spec.js test/unit-ci/shellpilot-client-ux-performance.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
```

Expected: 全部 PASS，诊断全局变量和条件分支均不存在。

### Task 3: 将性能就绪信号与离屏功能回归分开

**Files:**
- Modify: `apps/electerm-agent/test/e2e/038.client-interaction-performance.spec.js`

- [ ] **Step 1: 把冷打开和暖打开就绪条件收敛到首屏区块**

两处测量统一改为：

```js
readySelector: '.sp-setting-section-startup .edit-shortcut-button',
readyCount: 1
```

- [ ] **Step 2: 逐区块滚动并验证按需挂载**

用下列逻辑替换打开后立即要求四个真实区块存在的断言：

```js
await expect(page.locator('.sp-setting-section.sp-setting-section-startup')).toBeVisible()
for (const name of ['network', 'interface', 'advanced']) {
  const section = page.locator(`.sp-setting-section.sp-setting-section-${name}`)
  if (await section.count() === 0) {
    const placeholder = page.locator(
      `.sp-setting-section-placeholder.sp-setting-section-${name}`
    )
    await expect(placeholder).toBeAttached()
    await placeholder.scrollIntoViewIfNeeded()
  }
  await expect(section).toBeAttached()
  await section.scrollIntoViewIfNeeded()
  await expect(section).toBeVisible()
}
await expect(page.locator('.sp-settings-form .sp-setting-section')).toHaveCount(4)
```

保留高级区块稳定位置、焦点、`Ctrl+K` 搜索、关闭重开和 `rendererErrors` 断言；关闭重开后的就绪断言改为启动区块可见。

在滚动离屏区块前等待 `.sp-setting-startup-session` 和 `.sp-setting-startup-numbers`，确认 160ms 后的两组启动控件都已自动补齐。

- [ ] **Step 3: 构建并运行一次真实性能门禁**

Run:

```powershell
npm run b
npx playwright test test/e2e/038.client-interaction-performance.spec.js --workers=1
```

Expected: 冷打开总耗时不超过 250ms、稳定帧不超过 100ms、暖打开 P95 不超过 150ms、最大 Long Task 不超过 100ms，且四区块功能回归 PASS。

- [ ] **Step 4: 若首次运行失败，保存附件并只修复有证据的瓶颈**

读取 Playwright 生成的 `client-interaction-performance.json` 和错误堆栈。指标失败时只调整进入关键路径的区块或观察边界；功能失败时只修正占位观察或等待条件。每次修复后重新执行 Step 3，直到同一实现通过。

- [ ] **Step 5: 连续运行三轮核心门禁**

Run:

```powershell
1..3 | ForEach-Object {
  npx playwright test test/e2e/038.client-interaction-performance.spec.js --workers=1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: 三轮全部 PASS，0 fail；每轮预算和功能断言都满足。

- [ ] **Step 6: 提交视口驱动实现**

Run:

```powershell
git add -- apps/electerm-agent/src/client/common/frame-batched-mount.js apps/electerm-agent/src/client/components/setting-panel/setting-common.jsx apps/electerm-agent/src/client/components/setting-panel/setting.styl apps/electerm-agent/test/unit-ci/frame-batched-mount.spec.js apps/electerm-agent/test/unit-ci/shellpilot-client-ux-performance.spec.js apps/electerm-agent/test/unit-ci/shellpilot-ui-responsive.spec.js apps/electerm-agent/test/e2e/038.client-interaction-performance.spec.js
git commit -m "perf: mount settings sections on demand"
```

### Task 4: 完整自检、审查、合并与发布

**Files:**
- Verify: all files in `origin/master...HEAD`
- Inspect: `apps/electerm-agent/test-results/**/client-interaction-performance.json`

- [ ] **Step 1: 运行完整单元测试**

Run: `npm run test-unit-ci`

Expected: 退出码 0，0 fail。

- [ ] **Step 2: 运行代码检查**

Run: `npm run lint`

Expected: 退出码 0，无新增 lint 错误。

- [ ] **Step 3: 运行完整性能端到端套件**

Run: `npm run test-performance-e2e`

Expected: 性能基线和客户端交互性能用例全部 PASS。

- [ ] **Step 4: 运行生产构建**

Run: `npm run b`

Expected: 退出码 0，生成生产前端资源。

- [ ] **Step 5: 执行差异和工作树审计**

Run:

```powershell
git diff --check origin/master...HEAD
git status --short
git log --oneline origin/master..HEAD
git diff --stat origin/master...HEAD
```

Expected: `git diff --check` 无输出；实现提交后工作树干净；差异只覆盖设计、计划、测量、设置渲染和相应测试。

- [ ] **Step 6: 使用完成前验证与代码审查技能复核**

使用 `superpowers:verification-before-completion` 对全部新鲜证据逐项核验，再使用 `superpowers:requesting-code-review` 审查 `origin/master...HEAD`。发现问题时按 `superpowers:receiving-code-review` 验证、修复并重跑受影响门禁。

- [ ] **Step 7: 合并并发布更新**

仅在 Step 1-6 全部通过后，使用 `superpowers:finishing-a-development-branch` 选择本地合并路径，将 `codex/settings-render-performance` 合并到主分支；随后按仓库现有版本与发布脚本创建更新提交、标签和发布产物，并验证远端分支、标签及发布页面均已更新。
