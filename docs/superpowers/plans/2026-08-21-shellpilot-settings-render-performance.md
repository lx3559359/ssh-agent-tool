# ShellPilot Settings Render Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将设置页冷打开降到 250ms 以内、同会话重复打开 P95 降到 150ms 以内，并把可见到稳定帧控制在 100ms 以内，同时保持全部设置、搜索、滚动、键盘焦点和关闭重开行为不变。

**Architecture:** 先扩展真实性能测量，使测试等待四个设置区块就绪并采集 Long Task；再用 `content-visibility` 和区块固有尺寸隔离离屏布局。如果原生隔离仍未通过预算门禁，才启用一个独立、可单元测试、可取消的逐帧挂载调度器，将后三个区块分散到后续帧。

**Tech Stack:** Electron、React class components、Stylus、Playwright、Node.js test runner、PerformanceObserver Long Tasks API

---

## 文件结构

第一阶段必改文件：

- `apps/electerm-agent/test/e2e/common/client-interaction-performance.js`：统一记录可见、内容就绪、稳定帧和 Long Task，并汇总重复样本。
- `apps/electerm-agent/test/unit-ci/client-interaction-performance.spec.js`：验证 P95、稳定帧最大值和 Long Task 汇总口径。
- `apps/electerm-agent/test/e2e/038.client-interaction-performance.spec.js`：执行冷打开、10 次重复打开、性能门禁和设置交互回归。
- `apps/electerm-agent/test/unit-ci/shellpilot-client-ux-performance.spec.js`：约束四个区块的隔离类名和 Stylus 性能声明。
- `apps/electerm-agent/src/client/components/setting-panel/setting-common.jsx`：给四个设置区块分配稳定的性能类名。
- `apps/electerm-agent/src/client/components/setting-panel/setting.styl`：实现离屏渲染隔离和分区固有尺寸。

仅在第一阶段未达标时新增或修改：

- `apps/electerm-agent/src/client/common/frame-batched-mount.js`：管理顺序逐帧挂载、优先挂载、硬性完成上限和取消。
- `apps/electerm-agent/test/unit-ci/frame-batched-mount.spec.js`：验证分帧调度器的确定性状态转换。
- `apps/electerm-agent/src/client/components/setting-panel/setting-common.jsx`：使用调度器延迟挂载后三个设置区块，并观察滚动到占位区块的行为。
- `apps/electerm-agent/src/client/components/setting-panel/setting.styl`：为未挂载区块提供稳定占位高度。

不修改 `setting-modal.jsx`、设置保存逻辑、全局状态容器或设置数据结构。

### Task 1: 建立可验证的设置交互测量口径

**Files:**

- Create: `apps/electerm-agent/test/unit-ci/client-interaction-performance.spec.js`
- Modify: `apps/electerm-agent/test/e2e/common/client-interaction-performance.js:1-117`

- [ ] **Step 1: 为样本汇总和 Long Task 采集写失败测试**

创建测试文件：

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const helperPath = path.resolve(
  __dirname,
  '../e2e/common/client-interaction-performance.js'
)
const {
  percentile,
  summarizeInteractionSamples
} = require(helperPath)

test('interaction summaries use nearest-rank P95 and retain worst frame work', () => {
  const samples = Array.from({ length: 10 }, (_, index) => ({
    totalMs: 60 + index * 5,
    stableFrameMs: 20 + index,
    maxLongTaskMs: index === 7 ? 88 : 0
  }))

  assert.equal(percentile(samples.map(sample => sample.totalMs), 0.95), 105)
  assert.deepEqual(summarizeInteractionSamples(samples), {
    sampleCount: 10,
    totalP95Ms: 105,
    stableFrameMaxMs: 29,
    maxLongTaskMs: 88
  })
})

test('store interaction measurement observes long tasks and waits for ready content', () => {
  const source = fs.readFileSync(helperPath, 'utf8')

  assert.match(source, /PerformanceObserver\.supportedEntryTypes/)
  assert.match(source, /observer\.observe\(\{ type: 'longtask' \}\)/)
  assert.match(source, /observer\.takeRecords\(\)/)
  assert.match(source, /readySelector/)
  assert.match(source, /readyCount/)
  assert.match(source, /stableFrameMs: stableAt - visibleAt/)
})
```

- [ ] **Step 2: 运行测试并确认它按预期失败**

Run:

```powershell
cd apps/electerm-agent
node --test test/unit-ci/client-interaction-performance.spec.js
```

Expected: FAIL，错误指出 `summarizeInteractionSamples is not a function`，并且当前源码没有 Long Task 观察逻辑。

- [ ] **Step 3: 增加汇总函数、稳定帧等待和 Long Task 测量**

在 `client-interaction-performance.js` 中保留现有输入延迟测量，加入以下函数，并用下列版本替换 `measureStoreInteraction`：

```js
function maxOrZero (values) {
  return values.length ? Math.max(...values) : 0
}

function summarizeInteractionSamples (samples) {
  return {
    sampleCount: samples.length,
    totalP95Ms: percentile(samples.map(sample => sample.totalMs), 0.95),
    stableFrameMaxMs: maxOrZero(samples.map(sample => sample.stableFrameMs)),
    maxLongTaskMs: maxOrZero(samples.map(sample => sample.maxLongTaskMs || 0))
  }
}

async function waitForStableFrames (page, frameCount = 2) {
  await page.evaluate(async (frameCount) => {
    const waitFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
    for (let index = 0; index < frameCount; index += 1) {
      await waitFrame()
    }
  }, frameCount)
}

async function measureStoreInteraction (page, {
  action,
  selector,
  readySelector = selector,
  readyCount = 1,
  timeoutMs = 3000
}) {
  return page.evaluate(async ({
    action,
    selector,
    readySelector,
    readyCount,
    timeoutMs
  }) => {
    const waitFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const visible = element => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
    }
    const longTasks = []
    const longTaskSupported = Boolean(
      window.PerformanceObserver?.supportedEntryTypes?.includes('longtask')
    )
    let observer = null
    const collectLongTasks = entries => {
      for (const entry of entries) {
        longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration
        })
      }
    }
    if (longTaskSupported) {
      observer = new window.PerformanceObserver(list => {
        collectLongTasks(list.getEntries())
      })
      observer.observe({ type: 'longtask' })
    }

    try {
      const started = performance.now()
      if (action === 'open-ai') window.store.handleOpenAIPanel()
      else if (action === 'switch-ai') window.store.handleOpenAIPanel()
      else if (action === 'open-settings') window.store.openSetting()
      else throw new Error(`Unsupported interaction action: ${action}`)
      const actionCompleted = performance.now()

      while (!visible(document.querySelector(selector))) {
        if (performance.now() - started > timeoutMs) {
          throw new Error(`Interaction timed out before visible: ${action}`)
        }
        await waitFrame()
      }
      const visibleAt = performance.now()

      while (document.querySelectorAll(readySelector).length < readyCount) {
        if (performance.now() - started > timeoutMs) {
          throw new Error(`Interaction timed out before ready: ${action}`)
        }
        await waitFrame()
      }
      const contentReadyAt = performance.now()
      await waitFrame()
      await waitFrame()
      const stableAt = performance.now()

      if (observer) collectLongTasks(observer.takeRecords())
      const measuredLongTasks = longTasks.filter(entry => (
        entry.startTime >= started && entry.startTime <= stableAt
      ))
      return {
        totalMs: stableAt - started,
        actionMs: actionCompleted - started,
        visibleMs: visibleAt - actionCompleted,
        contentReadyMs: contentReadyAt - visibleAt,
        stableFrameMs: stableAt - visibleAt,
        longTaskSupported,
        longTasks: measuredLongTasks,
        maxLongTaskMs: measuredLongTasks.length
          ? Math.max(...measuredLongTasks.map(entry => entry.duration))
          : 0
      }
    } finally {
      observer?.disconnect()
    }
  }, { action, selector, readySelector, readyCount, timeoutMs })
}
```

将导出改为：

```js
module.exports = {
  measureInputLatency,
  measureStoreInteraction,
  percentile,
  summarizeInteractionSamples,
  waitForStableFrames
}
```

- [ ] **Step 4: 运行测量辅助测试并确认通过**

Run:

```powershell
node --test test/unit-ci/client-interaction-performance.spec.js
```

Expected: 2 tests PASS。

- [ ] **Step 5: 提交测量辅助改动**

```powershell
git add -- test/unit-ci/client-interaction-performance.spec.js test/e2e/common/client-interaction-performance.js
git commit -m "test: measure repeated settings interaction latency"
```

### Task 2: 用真实性能与功能门禁复现设置页卡顿

**Files:**

- Modify: `apps/electerm-agent/test/e2e/038.client-interaction-performance.spec.js:10-154`

- [ ] **Step 1: 收紧预算并导入新的测量辅助函数**

将导入和设置预算改为：

```js
const {
  measureInputLatency,
  measureStoreInteraction,
  percentile,
  summarizeInteractionSamples,
  waitForStableFrames
} = require('./common/client-interaction-performance')

const BUDGETS = {
  aiInputP95Ms: Number(process.env.SHELLPILOT_BUDGET_AI_INPUT_P95_MS || 50),
  aiPanelOpenMs: Number(process.env.SHELLPILOT_BUDGET_AI_PANEL_OPEN_MS || 250),
  rightPanelSwitchMs: Number(process.env.SHELLPILOT_BUDGET_RIGHT_PANEL_SWITCH_MS || 250),
  settingsColdOpenMs: Number(process.env.SHELLPILOT_BUDGET_SETTINGS_COLD_OPEN_MS || 250),
  settingsWarmOpenP95Ms: Number(process.env.SHELLPILOT_BUDGET_SETTINGS_WARM_OPEN_P95_MS || 150),
  settingsStableFrameMs: Number(process.env.SHELLPILOT_BUDGET_SETTINGS_STABLE_FRAME_MS || 100),
  settingsLongTaskMs: Number(process.env.SHELLPILOT_BUDGET_SETTINGS_LONG_TASK_MS || 100)
}
```

紧接 `const page = run.page` 后注册渲染错误收集：

```js
    const rendererErrors = []
    page.on('pageerror', error => {
      rendererErrors.push(String(error?.stack || error))
    })
    page.on('console', message => {
      if (message.type() === 'error') rendererErrors.push(message.text())
    })
```

- [ ] **Step 2: 用冷打开、10 次重复打开和行为回归替换现有单次设置测量**

用以下代码替换从 `hideSettingModal()` 到旧 `settingsOpen` 断言的代码块：

```js
    await page.evaluate(() => window.store.hideSettingModal())
    await expect(page.locator('.setting-wrap')).toHaveCount(0)
    await waitForStableFrames(page)

    const settingsColdOpen = await measureStoreInteraction(page, {
      action: 'open-settings',
      selector: '.setting-wrap .setting-tabs',
      readySelector: '.sp-settings-form .sp-setting-section',
      readyCount: 4
    })
    console.log(`[client-interaction] ${JSON.stringify({ settingsColdOpen })}`)
    expect(settingsColdOpen.totalMs).toBeLessThanOrEqual(BUDGETS.settingsColdOpenMs)
    expect(settingsColdOpen.stableFrameMs).toBeLessThanOrEqual(BUDGETS.settingsStableFrameMs)
    if (settingsColdOpen.longTaskSupported) {
      expect(settingsColdOpen.maxLongTaskMs).toBeLessThanOrEqual(BUDGETS.settingsLongTaskMs)
    }

    const settingsWarmSamples = []
    for (let index = 0; index < 10; index += 1) {
      await page.evaluate(() => window.store.hideSettingModal())
      await expect(page.locator('.setting-wrap')).toHaveCount(0)
      await waitForStableFrames(page)
      settingsWarmSamples.push(await measureStoreInteraction(page, {
        action: 'open-settings',
        selector: '.setting-wrap .setting-tabs',
        readySelector: '.sp-settings-form .sp-setting-section',
        readyCount: 4
      }))
    }
    const settingsWarm = summarizeInteractionSamples(settingsWarmSamples)
    console.log(`[client-interaction] ${JSON.stringify({ settingsWarm })}`)
    expect(settingsWarm.totalP95Ms)
      .toBeLessThanOrEqual(BUDGETS.settingsWarmOpenP95Ms)
    expect(settingsWarm.stableFrameMaxMs)
      .toBeLessThanOrEqual(BUDGETS.settingsStableFrameMs)
    if (settingsWarmSamples.some(sample => sample.longTaskSupported)) {
      expect(settingsWarm.maxLongTaskMs)
        .toBeLessThanOrEqual(BUDGETS.settingsLongTaskMs)
    }

    const sections = page.locator('.sp-settings-form .sp-setting-section')
    await expect(sections).toHaveCount(4)
    await expect(page.locator('.sp-setting-section-startup')).toBeVisible()
    const advancedSection = page.locator('.sp-setting-section-advanced')
    await advancedSection.scrollIntoViewIfNeeded()
    await expect(advancedSection).toBeVisible()
    const advancedTopBeforeStable = await advancedSection.evaluate(element => (
      element.getBoundingClientRect().top
    ))
    await waitForStableFrames(page)
    const advancedTopAfterStable = await advancedSection.evaluate(element => (
      element.getBoundingClientRect().top
    ))
    expect(Math.abs(advancedTopAfterStable - advancedTopBeforeStable))
      .toBeLessThanOrEqual(8)
    const advancedControl = advancedSection.locator('input, button, [tabindex]').first()
    await advancedControl.focus()
    await expect(advancedControl).toBeFocused()

    const closeButton = page.locator('.setting-wrap .close-setting-wrap-icon')
    await closeButton.focus()
    await expect(closeButton).toBeFocused()
    await page.keyboard.press('Control+K')
    const settingsSearch = page.locator('.setting-header-search input')
    await expect(settingsSearch).toBeFocused()
    await settingsSearch.fill('proxy')
    const generalResult = page.locator('.setting-search-results [role="option"]')
    await expect(generalResult).toHaveCount(1)
    await generalResult.click()
    await expect(page.locator('.sp-setting-section-network')).toBeAttached()

    await closeButton.click()
    await expect(page.locator('.setting-wrap')).toHaveCount(0)
    await page.evaluate(() => window.store.openSetting())
    await expect(page.locator('.sp-settings-form .sp-setting-section')).toHaveCount(4)
    expect(rendererErrors, rendererErrors.join('\n')).toEqual([])
```

在最终 `metrics.measured` 中用以下字段替换旧 `settingsOpen`：

```js
        settingsColdOpen,
        settingsWarm,
        settingsWarmSamples
```

- [ ] **Step 3: 构建真实性能应用并运行 RED 门禁**

首次在该工作树执行时运行：

```powershell
npm ci
npm run b
npx playwright test test/e2e/038.client-interaction-performance.spec.js --workers=1
```

Expected: 构建成功；性能用例在设置冷打开 250ms 或稳定帧 100ms 门禁处 FAIL。基线预期接近冷打开 378.7ms、稳定帧 280.2ms。若环境波动使首次运行意外通过，再运行两次并保存三次输出；只有三次全部通过才可判定现状已经满足门禁。

- [ ] **Step 4: 保持 RED 改动未提交并检查范围**

Run:

```powershell
git diff --check
git status --short
```

Expected: 只有 `038.client-interaction-performance.spec.js` 包含尚未提交的 RED 门禁改动，且 `git diff --check` 无错误。

### Task 3: 为四个设置区块增加原生渲染隔离

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-client-ux-performance.spec.js`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-common.jsx:353-430`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting.styl:93-105`

- [ ] **Step 1: 写设置区块性能契约的失败测试**

在 `shellpilot-client-ux-performance.spec.js` 末尾增加：

```js
test('general settings isolate offscreen section rendering with stable size hints', () => {
  const common = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/setting-common.jsx'
  ), 'utf8')
  const style = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/setting.styl'
  ), 'utf8')

  for (const name of ['startup', 'network', 'interface', 'advanced']) {
    assert.match(common, new RegExp(`className='sp-setting-section-${name}'`))
    assert.match(style, new RegExp(`\\.sp-setting-section-${name}`))
  }
  assert.match(style, /\.sp-setting-section\r?\n[\s\S]{0,260}content-visibility auto/)
  assert.equal((style.match(/contain-intrinsic-size auto \d+px/g) || []).length, 4)
})
```

- [ ] **Step 2: 运行测试并确认四个性能类名尚不存在**

Run:

```powershell
node --test test/unit-ci/shellpilot-client-ux-performance.spec.js
```

Expected: 新测试 FAIL，错误指向缺失的 `sp-setting-section-startup`。

- [ ] **Step 3: 给四个区块分配稳定类名**

在 `setting-common.jsx` 的四个 `SettingSection` 上按顺序加入：

```jsx
        <SettingSection
          className='sp-setting-section-startup'
          title={e('startupAndConnection')}
          description={e('startupAndConnectionDescription')}
        >
```

```jsx
        <SettingSection
          className='sp-setting-section-network'
          title={e('networkAndUpdates')}
          description={e('networkAndUpdatesDescription')}
        >
```

```jsx
        <SettingSection
          className='sp-setting-section-interface'
          title={e('interfaceAndLanguage')}
          description={e('interfaceAndLanguageDescription')}
        >
```

```jsx
        <SettingSection
          className='sp-setting-section-advanced'
          title={e('advancedSettings')}
          description={e('advancedSettingsDescription')}
        >
```

- [ ] **Step 4: 加入区块隔离与固有尺寸**

在 `.sp-setting-section` 的现有声明中加入 `content-visibility auto`，并在该规则后增加四个尺寸规则：

```stylus
.sp-setting-section
  min-width 0
  margin 0 0 16px
  padding 20px
  box-sizing border-box
  content-visibility auto
  background-image var(--sp-card-background)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-panel)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-card)

.sp-setting-section-startup
  contain-intrinsic-size auto 480px

.sp-setting-section-network
  contain-intrinsic-size auto 360px

.sp-setting-section-interface
  contain-intrinsic-size auto 520px

.sp-setting-section-advanced
  contain-intrinsic-size auto 920px
```

- [ ] **Step 5: 运行单元与响应式契约测试**

Run:

```powershell
node --test test/unit-ci/shellpilot-client-ux-performance.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js
```

Expected: 所有测试 PASS；现有卡片层级、响应式和主题契约未退化。

- [ ] **Step 6: 重建客户端并运行第一阶段性能门禁**

Run:

```powershell
npm run b
npx playwright test test/e2e/038.client-interaction-performance.spec.js --workers=1
```

Expected: 用例输出 `settingsColdOpen`、`settingsWarm` 和 10 个暖打开样本。若冷打开不超过 250ms、暖打开 P95 不超过 150ms、稳定帧最大值不超过 100ms，且受支持时最大 Long Task 不超过 100ms，则 PASS。

### Task 4: 按真实性能数据执行复杂度门禁

**Files:**

- Inspect: `apps/electerm-agent/test-results/**/client-interaction-performance.json`
- Commit first-stage files if all budgets pass

- [ ] **Step 1: 连续运行三次设置性能用例**

Run:

```powershell
1..3 | ForEach-Object {
  npx playwright test test/e2e/038.client-interaction-performance.spec.js --workers=1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: 三次全部 PASS，并且每次附件都包含冷打开、10 个暖打开样本、稳定帧和 Long Task 支持状态。

- [ ] **Step 2: 根据唯一门槛选择路径**

满足下列全部条件时执行 Step 3，并跳过 Task 5：

```text
settingsColdOpen.totalMs <= 250
settingsWarm.totalP95Ms <= 150
settingsColdOpen.stableFrameMs <= 100
settingsWarm.stableFrameMaxMs <= 100
maxLongTaskMs <= 100 when longTaskSupported is true
```

任一运行或任一条件失败时，不提交第一阶段，继续执行 Task 5。不得放宽预算、减少 10 个重复样本或移除功能断言。

- [ ] **Step 3: 第一阶段达标时提交 CSS 隔离和性能门禁**

```powershell
git add -- test/e2e/038.client-interaction-performance.spec.js test/unit-ci/shellpilot-client-ux-performance.spec.js src/client/components/setting-panel/setting-common.jsx src/client/components/setting-panel/setting.styl
git commit -m "perf: isolate settings section rendering"
```

Expected: 提交只包含四个列出的文件。随后直接执行 Task 6。

### Task 5: 第一阶段未达标时增加可取消的分帧挂载

仅在 Task 4 的门槛要求继续时执行本任务。

**Files:**

- Create: `apps/electerm-agent/src/client/common/frame-batched-mount.js`
- Create: `apps/electerm-agent/test/unit-ci/frame-batched-mount.spec.js`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-common.jsx`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting.styl`

- [ ] **Step 1: 为分帧顺序、优先级、硬上限和取消写失败测试**

创建 `frame-batched-mount.spec.js`：

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadScheduler () {
  return import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/common/frame-batched-mount.js'
  )))
}

function createHarness () {
  const frames = new Map()
  const timers = new Map()
  let nextId = 1
  return {
    frames,
    timers,
    requestFrame: callback => {
      const id = nextId++
      frames.set(id, callback)
      return id
    },
    cancelFrame: id => frames.delete(id),
    setTimer: callback => {
      const id = nextId++
      timers.set(id, callback)
      return id
    },
    clearTimer: id => timers.delete(id),
    runFrame () {
      const [id, callback] = frames.entries().next().value
      frames.delete(id)
      callback()
    },
    runTimer () {
      const [id, callback] = timers.entries().next().value
      timers.delete(id)
      callback()
    }
  }
}

test('frame batched mount reveals one section per frame in order', async () => {
  const { createFrameBatchedMount } = await loadScheduler()
  const harness = createHarness()
  const mounted = []
  const scheduler = createFrameBatchedMount({
    total: 4,
    initial: 1,
    onMount: count => mounted.push(count),
    ...harness
  })

  scheduler.start()
  harness.runFrame()
  harness.runFrame()
  harness.runFrame()

  assert.deepEqual(mounted, [2, 3, 4])
  assert.equal(harness.frames.size, 0)
  assert.equal(harness.timers.size, 0)
})

test('priority, timeout and cancel finish without stale callbacks', async () => {
  const { createFrameBatchedMount } = await loadScheduler()

  const priorityHarness = createHarness()
  const priorityMounted = []
  const priority = createFrameBatchedMount({
    total: 4,
    initial: 1,
    onMount: count => priorityMounted.push(count),
    ...priorityHarness
  })
  priority.start()
  priority.mountThrough(3)
  assert.deepEqual(priorityMounted, [3])
  priorityHarness.runFrame()
  assert.deepEqual(priorityMounted, [3, 4])

  const timeoutHarness = createHarness()
  const timeoutMounted = []
  const timeout = createFrameBatchedMount({
    total: 4,
    initial: 1,
    onMount: count => timeoutMounted.push(count),
    ...timeoutHarness
  })
  timeout.start()
  timeoutHarness.runTimer()
  assert.deepEqual(timeoutMounted, [4])
  assert.equal(timeoutHarness.frames.size, 0)

  const cancelHarness = createHarness()
  const cancelMounted = []
  const cancelled = createFrameBatchedMount({
    total: 4,
    initial: 1,
    onMount: count => cancelMounted.push(count),
    ...cancelHarness
  })
  cancelled.start()
  cancelled.cancel()
  assert.equal(cancelHarness.frames.size, 0)
  assert.equal(cancelHarness.timers.size, 0)
  assert.deepEqual(cancelMounted, [])
})
```

- [ ] **Step 2: 运行调度器测试并确认模块缺失**

Run:

```powershell
node --test test/unit-ci/frame-batched-mount.spec.js
```

Expected: FAIL，错误为找不到 `frame-batched-mount.js`。

- [ ] **Step 3: 实现最小可取消调度器**

创建 `frame-batched-mount.js`：

```js
export function createFrameBatchedMount ({
  total,
  initial = 1,
  maxDelayMs = 250,
  onMount,
  requestFrame = window.requestAnimationFrame.bind(window),
  cancelFrame = window.cancelAnimationFrame.bind(window),
  setTimer = window.setTimeout.bind(window),
  clearTimer = window.clearTimeout.bind(window)
}) {
  let mounted = Math.min(total, Math.max(0, initial))
  let frameId = null
  let timerId = null
  let active = false

  function stopScheduledWork () {
    active = false
    if (frameId !== null) cancelFrame(frameId)
    if (timerId !== null) clearTimer(timerId)
    frameId = null
    timerId = null
  }

  function scheduleNext () {
    if (!active || mounted >= total) {
      stopScheduledWork()
      return
    }
    frameId = requestFrame(() => {
      frameId = null
      if (!active) return
      mounted += 1
      onMount(mounted)
      scheduleNext()
    })
  }

  return {
    start () {
      if (active || mounted >= total) return
      active = true
      timerId = setTimer(() => {
        timerId = null
        if (!active) return
        mounted = total
        onMount(mounted)
        stopScheduledWork()
      }, maxDelayMs)
      scheduleNext()
    },
    mountThrough (count) {
      if (!active) return
      const next = Math.min(total, Math.max(mounted, count))
      if (next !== mounted) {
        mounted = next
        onMount(mounted)
      }
      if (mounted >= total) stopScheduledWork()
    },
    cancel () {
      stopScheduledWork()
    },
    getMountedCount () {
      return mounted
    }
  }
}
```

- [ ] **Step 4: 运行调度器测试并确认通过**

Run:

```powershell
node --test test/unit-ci/frame-batched-mount.spec.js
```

Expected: 2 tests PASS。

- [ ] **Step 5: 在 `SettingCommon` 中接入调度生命周期**

加入导入：

```js
import { createFrameBatchedMount } from '../../common/frame-batched-mount.js'
```

将初始状态扩展为：

```js
  state = {
    ready: false,
    mountedSectionCount: 1,
    submittingPass: false,
    passInputFocused: false,
    placeholderLogin: window.pre.requireAuth ? '********' : e('notSet'),
    loginPass: ''
  }
```

用以下生命周期和占位观察方法替换当前挂载、卸载逻辑：

```js
  sectionPlaceholders = new Map()

  componentDidMount () {
    this.timer = setTimeout(() => {
      this.setState({ ready: true }, this.startSectionMount)
    }, 0)
  }

  componentWillUnmount () {
    clearTimeout(this.timer)
    clearTimeout(this.timer1)
    this.sectionScheduler?.cancel()
    this.sectionObserver?.disconnect()
  }

  startSectionMount = () => {
    this.sectionScheduler = createFrameBatchedMount({
      total: 4,
      initial: 1,
      maxDelayMs: 250,
      onMount: mountedSectionCount => this.setState({ mountedSectionCount })
    })
    if (window.IntersectionObserver) {
      this.sectionObserver = new window.IntersectionObserver(entries => {
        const visibleIndexes = entries
          .filter(entry => entry.isIntersecting)
          .map(entry => Number(entry.target.dataset.sectionIndex))
        if (visibleIndexes.length) {
          this.sectionScheduler.mountThrough(Math.max(...visibleIndexes))
        }
      }, {
        root: document.querySelector('.setting-col-content'),
        rootMargin: '120px 0px'
      })
      for (const node of this.sectionPlaceholders.values()) {
        this.sectionObserver.observe(node)
      }
    }
    this.sectionScheduler.start()
  }

  setSectionPlaceholder = (index, node) => {
    const previous = this.sectionPlaceholders.get(index)
    if (previous) this.sectionObserver?.unobserve(previous)
    if (!node) {
      this.sectionPlaceholders.delete(index)
      return
    }
    this.sectionPlaceholders.set(index, node)
    this.sectionObserver?.observe(node)
  }

  renderDeferredSection = ({
    index,
    name,
    title,
    description,
    renderBody
  }) => {
    const className = `sp-setting-section-${name}`
    if (this.state.mountedSectionCount >= index) {
      return (
        <SettingSection key={name} className={className} title={title} description={description}>
          {renderBody()}
        </SettingSection>
      )
    }
    return (
      <div
        key={name}
        aria-hidden='true'
        className={`sp-setting-section-placeholder ${className}`}
        data-section-index={index}
        ref={node => this.setSectionPlaceholder(index, node)}
      />
    )
  }
```

- [ ] **Step 6: 将四个区块改成惰性 body 工厂**

在 `render()` 中保留页面头部，然后使用以下调用；原有每个区块的 children 原样移动到相应 `renderBody` 内：

```jsx
        {this.renderDeferredSection({
          index: 1,
          name: 'startup',
          title: e('startupAndConnection'),
          description: e('startupAndConnectionDescription'),
          renderBody: () => (
            <>
              <HotkeySetting {...hotkeyProps} />
              <div className='sp-setting-field sp-setting-field-stacked'>
                <div className='pd1b'>{e('onStartBookmarks')}</div>
                <div className='pd2b'><StartSession {...pops} /></div>
              </div>
              {this.renderNumber('sshReadyTimeout', {
                step: 200,
                min: 100,
                cls: 'timeout-desc',
                extraDesc: e('shellpilotMillisecondsUnit')
              }, e('timeoutDesc'))}
              {this.renderNumber('keepaliveInterval', {
                step: 1000,
                min: 0,
                max: 20000000,
                cls: 'keepalive-interval-desc',
                extraDesc: e('shellpilotMillisecondsUnit')
              }, e('keepaliveIntervalDesc'))}
            </>
          )
        })}
        {this.renderDeferredSection({
          index: 2,
          name: 'network',
          title: e('networkAndUpdates'),
          description: e('networkAndUpdatesDescription'),
          renderBody: () => (
            <>
              {this.renderProxy()}
              {this.renderUpdateChannel()}
              {this.renderUpdateSource()}
            </>
          )
        })}
        {this.renderDeferredSection({
          index: 3,
          name: 'interface',
          title: e('interfaceAndLanguage'),
          description: e('interfaceAndLanguageDescription'),
          renderBody: () => this.renderAppearanceFields(terminalThemes, theme, customCss)
        })}
        {this.renderDeferredSection({
          index: 4,
          name: 'advanced',
          title: e('advancedSettings'),
          description: e('advancedSettingsDescription'),
          renderBody: this.renderAdvancedFields
        })}
```

- [ ] **Step 7: 为未挂载区块加入稳定占位**

在四个固有尺寸规则后加入：

```stylus
.sp-setting-section-placeholder
  width 100%
  min-width 0
  margin 0 0 16px
  box-sizing border-box

.sp-setting-section-placeholder.sp-setting-section-network
  min-height 360px

.sp-setting-section-placeholder.sp-setting-section-interface
  min-height 520px

.sp-setting-section-placeholder.sp-setting-section-advanced
  min-height 920px
```

- [ ] **Step 8: 运行单元测试、重建并重复三次性能门禁**

Run:

```powershell
node --test test/unit-ci/frame-batched-mount.spec.js test/unit-ci/shellpilot-client-ux-performance.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
npm run b
1..3 | ForEach-Object {
  npx playwright test test/e2e/038.client-interaction-performance.spec.js --workers=1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: 单元测试全部 PASS，三次性能用例全部满足 Task 4 的五项预算；高级区块滚动、焦点、搜索和关闭重开断言全部 PASS。

- [ ] **Step 9: 提交分帧实现和 RED 门禁转绿的全部文件**

```powershell
git add -- test/e2e/038.client-interaction-performance.spec.js test/unit-ci/shellpilot-client-ux-performance.spec.js test/unit-ci/frame-batched-mount.spec.js src/client/common/frame-batched-mount.js src/client/components/setting-panel/setting-common.jsx src/client/components/setting-panel/setting.styl
git commit -m "perf: batch settings section mounting"
```

### Task 6: 完整验证、审查与性能报告

**Files:**

- Verify all changed files from Tasks 1-5
- Inspect: `apps/electerm-agent/test-results/**/client-interaction-performance.json`

- [ ] **Step 1: 运行完整单元测试**

Run:

```powershell
npm run test-unit-ci
```

Expected: 全部 Node 单元测试 PASS，0 fail。

- [ ] **Step 2: 运行代码检查**

Run:

```powershell
npm run lint
```

Expected: StandardJS 检查退出码 0。

- [ ] **Step 3: 运行完整性能端到端套件**

Run:

```powershell
npm run test-performance-e2e
```

Expected: `029.performance-baseline.spec.js` 和 `038.client-interaction-performance.spec.js` 全部 PASS；启动、终端、内存、AI、设置指标均在各自预算内。

- [ ] **Step 4: 运行生产构建**

Run:

```powershell
npm run b
```

Expected: 清理、编译和运行时文件准备全部退出码 0；前端构建无新增错误。

- [ ] **Step 5: 执行完成前差异与提交审计**

Run:

```powershell
git diff --check origin/master...HEAD
git status --short
git log --oneline origin/master..HEAD
git diff --stat origin/master...HEAD
```

Expected: `git diff --check` 无输出，工作树干净，提交只覆盖设计、计划、性能测量、设置区块隔离以及有条件启用的分帧文件。

- [ ] **Step 6: 汇总最终性能证据**

从最后一次 `client-interaction-performance.json` 和控制台输出中报告以下实际值，并与基线 378.7ms/280.2ms 对比：

```text
settingsColdOpen.totalMs
settingsColdOpen.stableFrameMs
settingsWarm.totalP95Ms
settingsWarm.stableFrameMaxMs
settingsColdOpen.maxLongTaskMs
settingsWarm.maxLongTaskMs
aiInputP95Ms
aiPanelOpen.totalMs
rightPanelSwitch.totalMs
```

同时明确记录最终采用“仅渲染隔离”还是“渲染隔离 + 分帧挂载”。所有数值必须来自最后一次通过的真实性能端到端附件，不使用手工估算。

- [ ] **Step 7: 请求代码审查并处理发现**

调用 `superpowers:requesting-code-review`，以设计文档、实施计划、`origin/master...HEAD` 差异和 Task 6 的验证输出作为审查输入。任何 P0/P1/P2 问题先按 `superpowers:receiving-code-review` 验证并修复，再重新执行受影响测试和 Task 6 的完整门禁。
