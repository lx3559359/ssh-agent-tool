# ShellPilot Client Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ShellPilot's AI composer responsive under long chat histories and add deterministic interaction budgets for the loaded AI panel, right-panel switching, and Settings.

**Architecture:** Keep AI history normalization at startup and mutation boundaries, preserve unchanged message identities, and memoize the scoped history passed into the existing `manate/react` `auto()` memo boundary. Exercise the real Electron renderer with deterministic long-history data and measure event-to-stable-frame latency without adding production per-keystroke telemetry.

**Tech Stack:** Electron 41, React 19, manate 2, Node.js test runner, Playwright 1.61, Vite 8, StandardJS

---

## Execution baseline

Execute this plan in an isolated worktree based on `origin/master` at ShellPilot 0.4.35 or newer. The current primary checkout contains user-owned uncommitted changes and its checked-out application version is 0.4.34, so the release baseline correctly refuses to build there. Bring the approved design and this plan into the isolated branch before implementation; do not merge, reset, clean, or stage files from the primary checkout.

## File responsibility map

- `apps/electerm-agent/src/client/components/ai/ai-chat-actions.js`: trusted-history mutation boundary and identity-preserving scoped selector.
- `apps/electerm-agent/src/client/components/ai/ai-run-cancellation.js`: derive the active run from an already-scoped history array.
- `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`: memoize scoped history and keep prompt changes out of the history subtree.
- `apps/electerm-agent/src/client/components/ai/ai-chat-history.jsx`: consume explicit config props while retaining the existing `auto()` memo boundary.
- `apps/electerm-agent/src/client/store/common.js`: remove one AI history entry immutably through the shared action boundary.
- `apps/electerm-agent/test/unit-ci/ai-chat-actions.spec.js`: real-function identity, sanitization, retention, and immutable-removal regression tests.
- `apps/electerm-agent/test/unit-ci/ai-run-cancellation.spec.js`: active-run selection from scoped history.
- `apps/electerm-agent/test/unit-ci/ai-chat-layout.spec.js`: render-boundary source contract.
- `apps/electerm-agent/test/unit-ci/ai-conversation-safety.spec.js`: updated scoped-history persistence contract.
- `apps/electerm-agent/test/unit-ci/agent-takeover-concurrency.spec.js`: updated explicit history-component dependency contract.
- `apps/electerm-agent/test/e2e/common/client-interaction-performance.js`: reusable event-to-stable-frame measurement helpers.
- `apps/electerm-agent/test/e2e/038.client-interaction-performance.spec.js`: real Electron long-history and loaded-surface budgets.
- `apps/electerm-agent/package.json`: include the new interaction scenario in `test-performance-e2e`.

## Task 1: Establish failing interaction and identity regressions

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/ai-chat-actions.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-run-cancellation.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-chat-layout.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-conversation-safety.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/agent-takeover-concurrency.spec.js`
- Create: `apps/electerm-agent/test/e2e/common/client-interaction-performance.js`
- Create: `apps/electerm-agent/test/e2e/038.client-interaction-performance.spec.js`
- Modify: `apps/electerm-agent/package.json`

- [ ] **Step 1: Add real-function history identity and immutable-removal tests**

Append these tests to `test/unit-ci/ai-chat-actions.spec.js`:

```js
test('AI chat scoped selection preserves trusted message identities', async () => {
  const { getAIChatHistoryForScope } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/ai/ai-chat-actions.js'
  )))
  const legacy = { id: 'legacy', response: 'legacy answer' }
  const matching = {
    id: 'matching',
    conversationScopeId: 'tab-a',
    response: 'matching answer'
  }
  const other = {
    id: 'other',
    conversationScopeId: 'tab-b',
    response: 'other answer'
  }

  const scoped = getAIChatHistoryForScope(
    [legacy, matching, other],
    'tab-a'
  )

  assert.deepEqual(scoped.map(item => item.id), ['legacy', 'matching'])
  assert.equal(scoped[0], legacy)
  assert.equal(scoped[1], matching)
})

test('AI chat append sanitizes only the new entry and preserves retained identities', async () => {
  const { appendAIChatHistory } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/ai/ai-chat-actions.js'
  )))
  const retained = {
    id: 'retained',
    conversationScopeId: 'tab-a',
    response: 'existing safe answer'
  }
  const store = { aiChatHistory: [retained] }

  appendAIChatHistory(store, {
    id: 'new-entry',
    conversationScopeId: 'tab-a',
    response: 'new answer\nAuthorization: Bearer append-secret'
  })

  assert.equal(store.aiChatHistory[0], retained)
  assert.match(store.aiChatHistory[1].response, /new answer/)
  assert.doesNotMatch(store.aiChatHistory[1].response, /append-secret/)
})

test('AI chat update preserves traced entries that did not change', async () => {
  const { updateAIChatHistoryEntry } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/ai/ai-chat-actions.js'
  )))
  const traced = {
    id: 'traced-untouched',
    response: 'stable answer',
    metadata: { traceId: 'sp-1784304000099-12345678' }
  }
  const store = {
    aiChatHistory: [traced, { id: 'active', response: '' }]
  }

  assert.equal(updateAIChatHistoryEntry(store, 'active', {
    response: 'next chunk'
  }), true)
  assert.equal(store.aiChatHistory[0], traced)
  assert.equal(store.aiChatHistory[1].response, 'next chunk')
})

test('AI chat scoped clear preserves entries from other scopes', async () => {
  const { clearAIChatContext } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/ai/ai-chat-actions.js'
  )))
  const keep = {
    id: 'keep-other-scope',
    conversationScopeId: 'tab-b',
    response: 'stable answer',
    metadata: { traceId: 'sp-1784304000100-12345678' }
  }
  const store = {
    aiChatHistory: [
      { id: 'remove-current-scope', conversationScopeId: 'tab-a' },
      keep
    ]
  }

  clearAIChatContext(store, 'tab-a')
  assert.deepEqual(store.aiChatHistory.map(item => item.id), ['keep-other-scope'])
  assert.equal(store.aiChatHistory[0], keep)
})

test('AI chat removal replaces the array and preserves remaining identities', async () => {
  const { removeAIChatHistoryEntry } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/ai/ai-chat-actions.js'
  )))
  const keep = { id: 'keep', response: 'keep me' }
  const remove = { id: 'remove', response: 'remove me' }
  const previous = [keep, remove]
  const store = { aiChatHistory: previous }

  assert.equal(removeAIChatHistoryEntry(store, 'remove'), true)
  assert.notEqual(store.aiChatHistory, previous)
  assert.deepEqual(store.aiChatHistory.map(item => item.id), ['keep'])
  assert.equal(store.aiChatHistory[0], keep)
  assert.equal(removeAIChatHistoryEntry(store, 'missing'), false)
})
```

- [ ] **Step 2: Add the active-run and render-boundary contracts**

Append this test to `test/unit-ci/ai-run-cancellation.spec.js`:

```js
test('selects the newest active run from an already scoped history', async () => {
  const { getActiveAIChatRun } = await import(moduleUrl)
  const done = { id: 'done', completionStatus: 'completed' }
  const pending = { id: 'pending', completionStatus: 'pending' }
  const stopping = { id: 'stopping', completionStatus: 'stopping' }
  const scoped = [done, pending, stopping]

  assert.equal(getActiveAIChatRun(scoped), stopping)
  assert.equal(getActiveAIChatRun([done]), null)
})
```

Add this test to `test/unit-ci/ai-chat-layout.spec.js`:

```js
test('AI prompt updates reuse scoped history and keep the history subtree memoized', () => {
  const aiChat = read('src/client/components/ai/ai-chat.jsx')
  const history = read('src/client/components/ai/ai-chat-history.jsx')

  assert.match(
    aiChat,
    /const visibleHistory = useMemo\(\s*\(\) => getAIChatHistoryForScope\([\s\S]*?props\.aiChatHistory,[\s\S]*?conversationScopeId[\s\S]*?\),\s*\[props\.aiChatHistory, conversationScopeId\]\s*\)/
  )
  assert.match(aiChat, /getActiveAIChatRun\(visibleHistory\)/)
  assert.match(aiChat, /<AiChatHistory[\s\S]*?history=\{visibleHistory\}[\s\S]*?config=\{props\.config\}/)
  assert.match(history, /auto\(function AIChatHistory \(\{\s*history,\s*agentRunning,\s*config = \{\}\s*\}\)/)
  assert.doesNotMatch(history, /window\.store\?\.config/)
})
```

Update the existing composer contract in the same file from `getActiveScopedAIChatRun(...)` to:

```js
assert.match(aiChatSource, /getActiveAIChatRun\(visibleHistory\)/)
```

Update the scoped-history assertion in `test/unit-ci/ai-conversation-safety.spec.js` to:

```js
assert.match(chat, /const\s+visibleHistory\s*=\s*useMemo\([\s\S]*?getAIChatHistoryForScope\(\s*props\.aiChatHistory,\s*conversationScopeId\s*\)[\s\S]*?\[props\.aiChatHistory,\s*conversationScopeId\]/)
```

Update the signature assertion in `test/unit-ci/agent-takeover-concurrency.spec.js` to:

```js
assert.match(history, /function AIChatHistory \(\{\s*history,\s*agentRunning,\s*config = \{\}\s*\}\)/)
```

- [ ] **Step 3: Create the browser-side interaction measurement helper**

Create `test/e2e/common/client-interaction-performance.js` with:

```js
function percentile (values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  if (!sorted.length) return 0
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  )
  return sorted[index]
}

async function measureInputLatency (page, {
  selector,
  text
}) {
  await page.evaluate(({ selector }) => {
    const input = document.querySelector(selector)
    if (!input) throw new Error(`Missing input: ${selector}`)
    const previous = window.__shellpilotInputLatencyProbe
    if (previous?.input && previous?.listener) {
      previous.input.removeEventListener('input', previous.listener, true)
    }
    const state = {
      input,
      listener: null,
      pending: 0,
      samples: []
    }
    state.listener = () => {
      const started = performance.now()
      state.pending += 1
      requestAnimationFrame(() => {
        const presentedAt = performance.now()
        requestAnimationFrame(() => {
          state.samples.push(presentedAt - started)
          state.pending -= 1
        })
      })
    }
    input.addEventListener('input', state.listener, true)
    window.__shellpilotInputLatencyProbe = state
  }, { selector })

  const input = page.locator(selector)
  await input.pressSequentially(text)
  await page.waitForFunction(({ expected }) => {
    const state = window.__shellpilotInputLatencyProbe
    return state?.samples?.length === expected && state.pending === 0
  }, { expected: text.length })

  return page.evaluate(({ selector }) => {
    const state = window.__shellpilotInputLatencyProbe
    const input = document.querySelector(selector)
    return {
      samples: [...state.samples],
      value: input?.value || ''
    }
  }, { selector })
}

async function measureStoreInteraction (page, {
  action,
  selector,
  timeoutMs = 3000
}) {
  return page.evaluate(async ({ action, selector, timeoutMs }) => {
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
    const started = performance.now()
    if (action === 'open-ai') window.store.handleOpenAIPanel()
    else if (action === 'switch-ai') window.store.handleOpenAIPanel()
    else if (action === 'open-settings') window.store.openSetting()
    else throw new Error(`Unsupported interaction action: ${action}`)

    while (!visible(document.querySelector(selector))) {
      if (performance.now() - started > timeoutMs) {
        throw new Error(`Interaction timed out: ${action}`)
      }
      await waitFrame()
    }
    await waitFrame()
    await waitFrame()
    return performance.now() - started
  }, { action, selector, timeoutMs })
}

module.exports = {
  measureInputLatency,
  measureStoreInteraction,
  percentile
}
```

- [ ] **Step 4: Create the real Electron interaction-budget test**

Create `test/e2e/038.client-interaction-performance.spec.js` with:

```js
const { _electron: electron, expect, test } = require('@playwright/test')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')
const {
  measureInputLatency,
  measureStoreInteraction,
  percentile
} = require('./common/client-interaction-performance')

const BUDGETS = {
  aiInputP95Ms: Number(process.env.SHELLPILOT_BUDGET_AI_INPUT_P95_MS || 50),
  aiPanelOpenMs: Number(process.env.SHELLPILOT_BUDGET_AI_PANEL_OPEN_MS || 250),
  rightPanelSwitchMs: Number(process.env.SHELLPILOT_BUDGET_RIGHT_PANEL_SWITCH_MS || 250),
  settingsOpenMs: Number(process.env.SHELLPILOT_BUDGET_SETTINGS_OPEN_MS || 500)
}

test.setTimeout(120000)

test('enforces long-history typing and loaded client interaction budgets', async () => {
  let run
  let primaryError
  try {
    run = await launchQualityApp(electron)
    const page = run.page
    await page.evaluate(() => {
      const response = '# Historical response\n' + 'status: ok\n'.repeat(1400)
      const profile = {
        id: 'interaction-performance-ai',
        nameAI: 'Interaction Performance Model',
        baseURLAI: 'http://127.0.0.1:43434',
        apiPathAI: '/chat/completions',
        modelAI: 'interaction-performance-model',
        apiKeyAI: 'interaction-performance-token',
        authHeaderNameAI: 'Authorization: Bearer',
        roleAI: '',
        languageAI: 'Chinese'
      }
      window.store.aiChatHistory = Array.from({ length: 100 }, (_, index) => ({
        id: `interaction-history-${index}`,
        conversationScopeId: 'global',
        sourceTabId: 'global',
        prompt: `historical prompt ${index}`,
        displayPrompt: `historical prompt ${index}`,
        response,
        completionStatus: 'completed',
        pending: false,
        isStreaming: false,
        toolCalls: [],
        artifactIds: []
      }))
      window.store.setConfig({
        activeAIProfileId: profile.id,
        aiProfiles: [profile],
        ...profile
      })
      window.store.handleOpenAIPanel()
    })

    const input = page.locator('.ai-chat-textarea')
    await expect(input).toBeVisible({ timeout: 20000 })
    await expect(page.locator('.chat-history-item')).toHaveCount(24, {
      timeout: 20000
    })
    const historyCount = await page.locator('.chat-history-item').count()
    await input.evaluate(element => {
      element.focus()
      element.dispatchEvent(new window.CompositionEvent('compositionstart', {
        bubbles: true,
        data: ''
      }))
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      ).set
      setter.call(element, '检查中文输入法组合输入')
      element.dispatchEvent(new window.InputEvent('input', {
        bubbles: true,
        data: '检查中文输入法组合输入',
        inputType: 'insertCompositionText',
        isComposing: true
      }))
      element.dispatchEvent(new window.CompositionEvent('compositionend', {
        bubbles: true,
        data: '检查中文输入法组合输入'
      }))
    })
    await expect(input).toHaveValue('检查中文输入法组合输入')
    await expect(page.locator('.chat-history-item')).toHaveCount(historyCount)
    await input.fill('shift-enter-line')
    await input.press('Shift+Enter')
    await expect(input).toHaveValue('shift-enter-line\n')
    await expect(page.locator('.chat-history-item')).toHaveCount(historyCount)
    await input.fill('')

    const typed = 'shellpilot-input-latency-0123456789-abcdef'
    const inputResult = await measureInputLatency(page, {
      selector: '.ai-chat-textarea',
      text: typed
    })
    const inputP95Ms = percentile(inputResult.samples, 0.95)
    expect(inputResult.value).toBe(typed)
    expect(inputP95Ms).toBeLessThanOrEqual(BUDGETS.aiInputP95Ms)

    await page.evaluate(() => {
      window.store.rightPanelVisible = false
      window.store.rightPanelAutoExpanded = false
    })
    await expect(page.locator('.right-side-panel')).toHaveCount(0)
    const aiPanelOpenMs = await measureStoreInteraction(page, {
      action: 'open-ai',
      selector: '.right-side-panel.right-side-panel-ai .ai-chat-container'
    })
    expect(aiPanelOpenMs).toBeLessThanOrEqual(BUDGETS.aiPanelOpenMs)

    await page.evaluate(() => window.store.openInfoPanel())
    await expect(page.locator('.right-side-panel.right-side-panel-ai')).toHaveCount(0)
    const rightPanelSwitchMs = await measureStoreInteraction(page, {
      action: 'switch-ai',
      selector: '.right-side-panel.right-side-panel-ai .ai-chat-container'
    })
    expect(rightPanelSwitchMs).toBeLessThanOrEqual(BUDGETS.rightPanelSwitchMs)

    await page.evaluate(() => window.store.hideSettingModal())
    await expect(page.locator('.setting-wrap')).toHaveCount(0)
    const settingsOpenMs = await measureStoreInteraction(page, {
      action: 'open-settings',
      selector: '.setting-wrap .setting-tabs'
    })
    expect(settingsOpenMs).toBeLessThanOrEqual(BUDGETS.settingsOpenMs)

    const metrics = {
      budgets: BUDGETS,
      measured: {
        aiInputP50Ms: percentile(inputResult.samples, 0.5),
        aiInputP95Ms: inputP95Ms,
        aiInputMaxMs: Math.max(...inputResult.samples),
        aiPanelOpenMs,
        rightPanelSwitchMs,
        settingsOpenMs
      },
      historyItems: 100,
      historyCharacters: 100 * ('# Historical response\n'.length + 'status: ok\n'.length * 1400)
    }
    await test.info().attach('client-interaction-performance.json', {
      body: Buffer.from(JSON.stringify(metrics, null, 2)),
      contentType: 'application/json'
    })
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (run) {
      await cleanupQualityApp(run.electronApp, run.profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    }
  }
})
```

- [ ] **Step 5: Add the interaction scenario to the performance command**

Replace the existing `test-performance-e2e` script in `package.json` with:

```json
"test-performance-e2e": "playwright test test/e2e/029.performance-baseline.spec.js test/e2e/038.client-interaction-performance.spec.js --workers=1"
```

- [ ] **Step 6: Run the focused unit tests and verify RED**

Run:

```powershell
node --test test/unit-ci/ai-chat-actions.spec.js test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/ai-chat-layout.spec.js test/unit-ci/ai-conversation-safety.spec.js test/unit-ci/agent-takeover-concurrency.spec.js
```

Expected: FAIL because `removeAIChatHistoryEntry` and `getActiveAIChatRun` do not exist, scoped selection rebuilds message objects, and `AIChat` does not memoize scoped history.

- [ ] **Step 7: Build the unoptimized baseline and verify the interaction test is RED**

Run:

```powershell
npm run compile
npx playwright test test/e2e/038.client-interaction-performance.spec.js --workers=1
```

Expected: build succeeds from the 0.4.35-or-newer isolated branch; the Playwright test FAILS the 50ms long-history typing budget. Record the measured P50, P95, and maximum from the test attachment or assertion output. Do not weaken the budget.

## Task 2: Preserve trusted history identities at every mutation boundary

**Files:**

- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-actions.js`
- Modify: `apps/electerm-agent/src/client/store/common.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-chat-actions.spec.js`

- [ ] **Step 1: Make scoped selection identity-preserving**

Replace `getAIChatHistoryForScope()` with:

```js
export function getAIChatHistoryForScope (history, scopeId) {
  const scope = String(scopeId || 'global')
  return (Array.isArray(history) ? history : [])
    .filter(item => isLegacyAIChatEntry(item) || getAIChatScopeId(item) === scope)
}
```

- [ ] **Step 2: Add immutable single-entry removal**

Add this function immediately after `clearAIChatContext()`:

```js
export function removeAIChatHistoryEntry (store, id) {
  if (!store || !id) return false
  const history = Array.isArray(store.aiChatHistory) ? store.aiChatHistory : []
  const next = history.filter(item => item?.id !== id)
  if (next.length === history.length) return false
  store.aiChatHistory = next
  return true
}
```

In `src/client/store/common.js`, add:

```js
import { removeAIChatHistoryEntry } from '../components/ai/ai-chat-actions'
```

Replace `Store.prototype.removeAiHistory` with:

```js
Store.prototype.removeAiHistory = function (id) {
  return removeAIChatHistoryEntry(window.store, id)
}
```

- [ ] **Step 3: Normalize only the appended entry**

Replace `appendAIChatHistory()` with:

```js
export function appendAIChatHistory (store, entry, maxHistory = 100) {
  if (!store || !entry) return
  const safeEntry = normalizeAIChatHistoryForStorage([entry])[0]
  if (!safeEntry) return
  const history = [
    ...(Array.isArray(store.aiChatHistory) ? store.aiChatHistory : []),
    safeEntry
  ]
  const entryScope = getAIChatScopeId(safeEntry)
  const matchingIndexes = history.reduce((indexes, item, index) => {
    if (getAIChatScopeId(item) === entryScope) indexes.push(index)
    return indexes
  }, [])
  const overflow = matchingIndexes.length - maxHistory
  let retainedHistory = history
  if (overflow > 0) {
    const removable = matchingIndexes.filter(index => (
      index !== history.length - 1 && !isActiveAIChatEntry(history[index])
    ))
    const removed = new Set(removable.slice(0, overflow))
    retainedHistory = history.filter((item, index) => !removed.has(index))
  }
  const globalLimit = Math.max(maxHistory, maxHistory * 5)
  const globalOverflow = retainedHistory.length - globalLimit
  if (globalOverflow > 0) {
    const removable = retainedHistory.reduce((indexes, item, index) => {
      if (!isActiveAIChatEntry(item)) indexes.push(index)
      return indexes
    }, [])
    const removed = new Set(removable.slice(0, globalOverflow))
    retainedHistory = retainedHistory.filter((item, index) => !removed.has(index))
  }
  store.aiChatHistory = retainedHistory
}
```

- [ ] **Step 4: Stop rebuilding untouched traced messages during updates and clears**

At the end of `updateAIChatHistoryEntry()`, keep normalization on the changed entry and assign the prepared array directly:

```js
next[index] = normalizeAIChatHistoryItem(merged)
store.aiChatHistory = next
return true
```

In the scoped branch of `clearAIChatContext()`, preserve retained objects by removing the final `.map(normalizeAIChatTraceStorage)`:

```js
store.aiChatHistory = (Array.isArray(store.aiChatHistory)
  ? store.aiChatHistory
  : []
).filter(item => getAIChatScopeId(item) !== scope)
```

- [ ] **Step 5: Run the history tests and verify GREEN**

Run:

```powershell
node --test test/unit-ci/ai-chat-actions.spec.js
```

Expected: PASS, including startup sanitization, scope retention, active-run retention, update sanitization, identity preservation, and immutable removal.

- [ ] **Step 6: Commit the identity-preserving data path**

Run:

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-chat-actions.js apps/electerm-agent/src/client/store/common.js apps/electerm-agent/test/unit-ci/ai-chat-actions.spec.js
git commit -m "perf(ai): preserve chat history identity"
```

Expected: one commit containing only the trusted-history data-path change and its green unit tests. Leave Task 1's render and E2E files unstaged until Task 3.

## Task 3: Isolate prompt updates from AI history rendering

**Files:**

- Modify: `apps/electerm-agent/src/client/components/ai/ai-run-cancellation.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-history.jsx`
- Test: `apps/electerm-agent/test/unit-ci/ai-run-cancellation.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-chat-layout.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-conversation-safety.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/agent-takeover-concurrency.spec.js`

- [ ] **Step 1: Derive active state from an already-scoped array**

In `ai-run-cancellation.js`, add and reuse this function:

```js
export function getActiveAIChatRun (history) {
  const active = (Array.isArray(history) ? history : []).filter(isActiveRun)
  return active.at(-1) || null
}

export function getActiveScopedAIChatRun (history, scopeId) {
  return getActiveAIChatRun(getAIChatHistoryForScope(history, scopeId))
}
```

- [ ] **Step 2: Memoize scope selection and active-run lookup**

Change the cancellation import in `ai-chat.jsx` to:

```js
import {
  cancelScopedAIChatRun,
  getActiveAIChatRun
} from './ai-run-cancellation.js'
```

Replace the eager selection block with:

```js
const visibleHistory = useMemo(
  () => getAIChatHistoryForScope(
    props.aiChatHistory,
    conversationScopeId
  ),
  [props.aiChatHistory, conversationScopeId]
)
const activeRun = useMemo(
  () => getActiveAIChatRun(visibleHistory),
  [visibleHistory]
)
```

Pass explicit configuration into the history subtree:

```jsx
<AiChatHistory
  history={visibleHistory}
  agentRunning={agentRunning}
  config={props.config}
/>
```

- [ ] **Step 3: Remove the hidden history config dependency**

Change the history component signature and config assignment in `ai-chat-history.jsx` to:

```js
export default auto(function AIChatHistory ({
  history,
  agentRunning,
  config = {}
}) {
```

Delete this line:

```js
const config = window.store?.config || {}
```

Keep the existing `configRevisionKey` calculation and pass both `config` and `configRevisionKey` to each `AIChatHistoryItem`. `auto()` already returns a React `memo()` wrapper in manate 2.0.3, so no second wrapper is required.

- [ ] **Step 4: Run the focused renderer and lifecycle tests**

Run:

```powershell
node --test test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/ai-chat-layout.spec.js test/unit-ci/ai-conversation-safety.spec.js test/unit-ci/agent-takeover-concurrency.spec.js test/unit-ci/ai-chat-actions.spec.js test/unit-ci/ai-chat-stability-matrix.spec.js
```

Expected: PASS. The scoped selector and active-run helper retain the same message object; the source contracts prove that prompt updates reuse the memoized history array and explicit config dependency.

- [ ] **Step 5: Rebuild and verify the interaction test turns GREEN**

Run:

```powershell
npm run compile
npx playwright test test/e2e/038.client-interaction-performance.spec.js --workers=1
```

Expected: PASS with 100 history items and approximately 1.54 million history characters; AI input P95 is at most 50ms, loaded AI open and right-panel switch are at most 250ms, and Settings open is at most 500ms. Save the attached JSON metrics for final comparison.

- [ ] **Step 6: Commit render isolation and interaction gates**

Run:

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-run-cancellation.js apps/electerm-agent/src/client/components/ai/ai-chat.jsx apps/electerm-agent/src/client/components/ai/ai-chat-history.jsx apps/electerm-agent/test/unit-ci/ai-run-cancellation.spec.js apps/electerm-agent/test/unit-ci/ai-chat-layout.spec.js apps/electerm-agent/test/unit-ci/ai-conversation-safety.spec.js apps/electerm-agent/test/unit-ci/agent-takeover-concurrency.spec.js apps/electerm-agent/test/e2e/common/client-interaction-performance.js apps/electerm-agent/test/e2e/038.client-interaction-performance.spec.js apps/electerm-agent/package.json
git commit -m "perf(client): isolate AI typing from history rendering"
```

Expected: one commit containing the render isolation, deterministic interaction test, and performance-script wiring.

## Task 4: Verify AI behavior and complete-client performance gates

**Files:**

- Verify: `apps/electerm-agent/src/client/components/ai/ai-chat-actions.js`
- Verify: `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`
- Verify: `apps/electerm-agent/src/client/components/ai/ai-chat-history.jsx`
- Verify: `apps/electerm-agent/test/e2e/029.performance-baseline.spec.js`
- Verify: `apps/electerm-agent/test/e2e/038.client-interaction-performance.spec.js`

- [ ] **Step 1: Run formatting and focused AI tests**

Run:

```powershell
npm run lint
node --test test/unit-ci/ai-chat-*.spec.js test/unit-ci/ai-conversation-*.spec.js test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/agent-takeover-concurrency.spec.js test/unit-ci/agent-takeover-performance.spec.js test/unit-ci/shellpilot-client-ux-performance.spec.js
```

Expected: both commands exit 0 with no StandardJS errors and no focused test failures.

- [ ] **Step 2: Run the full Node regression suite**

Run:

```powershell
npm run test-unit-ci
```

Expected: exit 0; environment-dependent skips are allowed only when they are reported as skips, not failures.

- [ ] **Step 3: Build the production client from the current release baseline**

Run:

```powershell
npm run b
```

Expected: exit 0; the release baseline reports 0.4.35 or newer and `origin/master` is an ancestor of the implementation branch. Existing dependency-heavy chunk warnings may remain, but there must be no new build error.

- [ ] **Step 4: Run the complete performance command**

Run:

```powershell
npm run test-performance-e2e
```

Expected: both the existing startup/terminal/memory/AI request scenario and the new interaction scenario pass without changing any budget.

- [ ] **Step 5: Run the existing AI desktop journey**

Run:

```powershell
npx playwright test test/e2e/006.ai-chat.spec.js --workers=1
```

Expected: exit 0; submit, streaming, stop, history, configuration, and artifact presentation remain compatible.

- [ ] **Step 6: Audit requirements against fresh evidence**

Read the two Playwright reports and verify all of the following before claiming completion:

```text
AI long-history input: 100 items, approximately 1.54 million characters, final text exact, P95 <= 50ms
Chinese IME composition and Shift+Enter: input remains local and history count is unchanged
Loaded AI panel open: <= 250ms
Right-panel switch to AI: <= 250ms
Settings open: <= 500ms
Existing app start, window interactive, terminal ready, memory, AI first token, and AI total budgets: PASS
Focused AI behavior, complete unit suite, lint, production build, and AI E2E: PASS
Primary checkout user changes: untouched
```

Expected: every row has direct command or report evidence. If any row lacks evidence, continue investigation rather than marking the task complete.

- [ ] **Step 7: Confirm the implementation branch is clean**

Run:

```powershell
git status --short --branch
git log -3 --oneline
```

Expected: no unstaged or uncommitted implementation files; the latest implementation commits are `perf(ai): preserve chat history identity` and `perf(client): isolate AI typing from history rendering` above the approved documentation commits.
