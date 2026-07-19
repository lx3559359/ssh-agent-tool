# ShellPilot UI Font Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a searchable 20-preset client UI font selector with availability detection, immediate preview, explicit apply/cancel persistence, and strict isolation from SSH terminal fonts.

**Architecture:** Define the fixed catalog and pure search/normalization functions in one common module, keep preview/apply/cancel transitions in a small store extension, inject one root UI font CSS variable from a dedicated React component, and render the picker inside the existing Interface and Language settings section. The terminal continues to use `config.fontFamily` and `terminalBackgroundTextFontFamily`; the new feature uses only `uiFontPresetId`.

**Tech Stack:** Electron 41, React 19, Manate store, Ant Design 6, Stylus, Canvas/font runtime detection, Node test runner, Playwright.

---

## Execution context and file map

Execute after the light-depth plan in the same isolated `codex/ui-modernization` worktree. Rebase or stop if the primary branch has moved in ways that conflict with settings/store files; never copy unrelated dirty files from the primary worktree.

Primary responsibilities:

- Create `src/client/common/ui-font-presets.js`: fixed catalog, normalization, search, stacks, and availability detection.
- Create `src/client/store/ui-font.js`: preview/apply/cancel state transitions.
- Create `src/client/components/main/ui-font.jsx`: set the global UI font variable.
- Create `src/client/components/setting-panel/ui-font-picker.jsx`: accessible grouped selector and preview card.
- Create `src/client/components/setting-panel/ui-font-picker.styl`: responsive picker layout.
- Modify `src/client/common/default-setting.js`: add the client default `uiFontPresetId`.
- Modify `src/app/common/default-setting.js`: add the main-process default `uiFontPresetId`.
- Modify `src/client/store/init-state.js`: add transient `previewUiFontPresetId`.
- Modify `src/client/store/store.js`: install the UI font store extension.
- Modify `src/client/store/sync.js`: include only the saved preset ID in configuration sync.
- Modify `src/client/components/setting-panel/setting-common.jsx`: mount the picker in Interface and Language.
- Modify `src/client/components/setting-panel/setting-modal.jsx`: cancel an unconfirmed font preview on close.
- Modify `src/client/components/main/main.jsx`: render `UiFont` with the effective preview/saved preset.
- Modify `src/client/css/basic.styl`: consume `--sp-ui-font-family` for non-terminal inherited UI text.
- Modify `src/client/common/shellpilot-i18n-overrides.js`: add bilingual picker copy.
- Create `test/unit-ci/ui-font-presets.spec.js`: catalog, search, availability, and fallback tests.
- Create `test/unit-ci/ui-font-store.spec.js`: state-transition and theme-independence tests.
- Modify `test/unit-ci/secondary-ui-contract.spec.js`: enforce terminal-font separation.
- Modify `test/e2e/022.secondary-ui-visual-matrix.spec.js`: verify preview/apply/cancel, missing fonts, widths, languages, themes, and terminal invariants.

### Task 1: Define and test the fixed 20-preset catalog

**Files:**
- Create: `apps/electerm-agent/test/unit-ci/ui-font-presets.spec.js`
- Create: `apps/electerm-agent/src/client/common/ui-font-presets.js`

- [ ] **Step 1: Write the failing catalog and search tests**

Create `test/unit-ci/ui-font-presets.spec.js` with the existing dynamic-import pattern:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/ui-font-presets.js'
)).href

test('exposes exactly twenty stable grouped UI font presets', async () => {
  const { uiFontPresets } = await import(moduleUrl)
  assert.equal(uiFontPresets.length, 20)
  assert.equal(new Set(uiFontPresets.map(item => item.id)).size, 20)
  assert.deepEqual(uiFontPresets.map(item => item.id), [
    'system', 'microsoft-yahei-ui', 'dengxian', 'noto-sans-sc', 'misan',
    'source-han-sans-sc', 'harmonyos-sans-sc', 'microsoft-jhenghei-ui',
    'segoe-ui', 'segoe-ui-variable', 'bahnschrift', 'calibri', 'arial',
    'tahoma', 'verdana', 'trebuchet-ms', 'corbel', 'candara', 'ebrima',
    'yu-gothic-ui'
  ])
  assert.equal(Object.isFrozen(uiFontPresets), true)
})

test('normalizes unknown values and searches Chinese English and aliases', async () => {
  const { normalizeUiFontPresetId, searchUiFontPresets } = await import(moduleUrl)
  assert.equal(normalizeUiFontPresetId('segoe-ui'), 'segoe-ui')
  assert.equal(normalizeUiFontPresetId('missing-font'), 'system')
  assert.deepEqual(searchUiFontPresets('雅黑').map(item => item.id), ['microsoft-yahei-ui'])
  assert.deepEqual(searchUiFontPresets('trebuchet').map(item => item.id), ['trebuchet-ms'])
  assert.deepEqual(searchUiFontPresets('system').map(item => item.id), ['system'])
})

test('reports available unavailable and unknown font detection states', async () => {
  const { getUiFontAvailability } = await import(moduleUrl)
  assert.equal(getUiFontAvailability({ id: 'system' }), 'available')
  assert.equal(getUiFontAvailability(
    { id: 'known', family: 'Known UI' },
    { measure: family => family.includes('Known UI') ? 120 : 100 }
  ), 'available')
  assert.equal(getUiFontAvailability(
    { id: 'missing', family: 'Missing UI' },
    { measure: () => 100 }
  ), 'unavailable')
  assert.equal(getUiFontAvailability(
    { id: 'broken', family: 'Broken UI' },
    { measure: () => { throw new Error('canvas unavailable') } }
  ), 'unknown')
})
```

- [ ] **Step 2: Run the new test and verify failure**

```powershell
node --test test/unit-ci/ui-font-presets.spec.js
```

Expected: FAIL because `ui-font-presets.js` does not exist.

- [ ] **Step 3: Implement the fixed catalog and pure helpers**

Create `src/client/common/ui-font-presets.js`. Use this exact catalog shape; every candidate stack must end in the system stack and `sans-serif`:

```js
export const systemUiFontStack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei UI', Arial, sans-serif"

const preset = (id, zh, en, family, group, aliases = []) => Object.freeze({
  id, zh, en, family, group, aliases: Object.freeze(aliases),
  stack: family ? `'${family}', ${systemUiFontStack}` : systemUiFontStack
})

export const uiFontPresets = Object.freeze([
  preset('system', '跟随系统', 'System Default', '', 'recommended', ['系统', 'default']),
  preset('microsoft-yahei-ui', '微软雅黑 UI', 'Microsoft YaHei UI', 'Microsoft YaHei UI', 'recommended', ['雅黑', 'yahei']),
  preset('dengxian', '等线', 'DengXian', 'DengXian', 'recommended'),
  preset('noto-sans-sc', 'Noto Sans SC', 'Noto Sans SC', 'Noto Sans SC', 'recommended'),
  preset('misan', 'MiSans', 'MiSans', 'MiSans', 'recommended'),
  preset('source-han-sans-sc', '思源黑体', 'Source Han Sans SC', 'Source Han Sans SC', 'recommended', ['思源']),
  preset('harmonyos-sans-sc', 'HarmonyOS Sans', 'HarmonyOS Sans', 'HarmonyOS Sans SC', 'recommended'),
  preset('microsoft-jhenghei-ui', '微软正黑体 UI', 'Microsoft JhengHei UI', 'Microsoft JhengHei UI', 'recommended', ['正黑']),
  preset('segoe-ui', 'Segoe UI', 'Segoe UI', 'Segoe UI', 'modern'),
  preset('segoe-ui-variable', 'Segoe UI Variable', 'Segoe UI Variable', 'Segoe UI Variable', 'modern'),
  preset('bahnschrift', 'Bahnschrift', 'Bahnschrift', 'Bahnschrift', 'modern'),
  preset('calibri', 'Calibri', 'Calibri', 'Calibri', 'modern'),
  preset('arial', 'Arial', 'Arial', 'Arial', 'modern'),
  preset('tahoma', 'Tahoma', 'Tahoma', 'Tahoma', 'modern'),
  preset('verdana', 'Verdana', 'Verdana', 'Verdana', 'modern'),
  preset('trebuchet-ms', 'Trebuchet MS', 'Trebuchet MS', 'Trebuchet MS', 'modern'),
  preset('corbel', 'Corbel', 'Corbel', 'Corbel', 'more'),
  preset('candara', 'Candara', 'Candara', 'Candara', 'more'),
  preset('ebrima', 'Ebrima', 'Ebrima', 'Ebrima', 'more'),
  preset('yu-gothic-ui', '游ゴシック UI', 'Yu Gothic UI', 'Yu Gothic UI', 'more', ['游黑'])
])

export function normalizeUiFontPresetId (value) {
  return uiFontPresets.some(item => item.id === value) ? value : 'system'
}

export function getUiFontPreset (value) {
  const id = normalizeUiFontPresetId(value)
  return uiFontPresets.find(item => item.id === id)
}

export function searchUiFontPresets (query = '') {
  const needle = String(query).trim().toLocaleLowerCase()
  if (!needle) return uiFontPresets
  return uiFontPresets.filter(item => {
    return [item.zh, item.en, item.family, ...item.aliases]
      .some(value => value.toLocaleLowerCase().includes(needle))
  })
}
```

Implement availability detection against only these fixed candidates:

```js
function browserMeasure (family, fallback = 'monospace') {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  context.font = `72px '${family}', ${fallback}`
  return context.measureText('mmmmmmmmmmWWWWWW1234567890').width
}

export function getUiFontAvailability (item, options = {}) {
  if (!item || item.id === 'system' || !item.family) return 'available'
  const measure = options.measure || browserMeasure
  try {
    const baselines = ['monospace', 'sans-serif']
    const differs = baselines.some(fallback => {
      return measure(item.family, fallback) !== measure(fallback, fallback)
    })
    return differs ? 'available' : 'unavailable'
  } catch {
    return 'unknown'
  }
}
```

- [ ] **Step 4: Run the catalog tests**

```powershell
node --test test/unit-ci/ui-font-presets.spec.js
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the catalog**

```powershell
git add src/client/common/ui-font-presets.js test/unit-ci/ui-font-presets.spec.js
git commit -m "feat: define fixed UI font presets"
```

### Task 2: Add preview/apply/cancel store state

**Files:**
- Create: `apps/electerm-agent/src/client/store/ui-font.js`
- Create: `apps/electerm-agent/test/unit-ci/ui-font-store.spec.js`
- Modify: `apps/electerm-agent/src/client/store/init-state.js`
- Modify: `apps/electerm-agent/src/client/store/store.js`
- Modify: `apps/electerm-agent/src/client/common/default-setting.js`
- Modify: `apps/electerm-agent/src/app/common/default-setting.js`
- Modify: `apps/electerm-agent/src/client/store/sync.js`

- [ ] **Step 1: Write failing state-transition tests**

Create a small fake Store, apply the extension, and assert these transitions:

```js
test('previews applies cancels and normalizes UI font independently', async () => {
  const { default: extend } = await import(storeModuleUrl)
  class Store {
    constructor () {
      this._config = { uiFontPresetId: 'system', theme: 'shellpilot-ocean', fontFamily: 'Maple Mono' }
      this.previewUiFontPresetId = ''
    }
    get config () { return { ...this._config } }
    setConfig (value) { Object.assign(this._config, value) }
  }
  extend(Store)
  const store = new Store()
  global.window = { store }

  assert.equal(store.previewUiFontPreset('segoe-ui'), true)
  assert.equal(store.getUiFontPresetId(), 'segoe-ui')
  store.cancelUiFontPreview()
  assert.equal(store.getUiFontPresetId(), 'system')
  store.previewUiFontPreset('microsoft-yahei-ui')
  store.applyUiFontPreset()
  assert.equal(store.config.uiFontPresetId, 'microsoft-yahei-ui')
  assert.equal(store.config.theme, 'shellpilot-ocean')
  assert.equal(store.config.fontFamily, 'Maple Mono')
  assert.equal(store.previewUiFontPreset('not-a-preset'), false)
})
```

- [ ] **Step 2: Run the store test and verify failure**

```powershell
node --test test/unit-ci/ui-font-store.spec.js
```

Expected: FAIL because the store extension and transient field do not exist.

- [ ] **Step 3: Implement the store extension**

Create `src/client/store/ui-font.js` with consistent public methods:

```js
import { normalizeUiFontPresetId, uiFontPresets } from '../common/ui-font-presets.js'

export default Store => {
  Store.prototype.getUiFontPresetId = function () {
    const { store } = window
    return normalizeUiFontPresetId(
      store.previewUiFontPresetId || store.config.uiFontPresetId
    )
  }
  Store.prototype.previewUiFontPreset = function (id) {
    const { store } = window
    if (!uiFontPresets.some(item => item.id === id)) return false
    store.previewUiFontPresetId = id
    return true
  }
  Store.prototype.applyUiFontPreset = function () {
    const { store } = window
    const id = normalizeUiFontPresetId(store.previewUiFontPresetId || store.config.uiFontPresetId)
    store.setConfig({ uiFontPresetId: id })
    store.previewUiFontPresetId = ''
    return id
  }
  Store.prototype.cancelUiFontPreview = function () {
    window.store.previewUiFontPresetId = ''
  }
}
```

Add `previewUiFontPresetId: ''` to `init-state.js`, install `uiFontExtend(Store)` in `store.js`, add `uiFontPresetId: 'system'` next to UI-related defaults in both default-setting files, and add `'uiFontPresetId'` beside `'theme'` and `'language'` in the sync configuration list. Never add `previewUiFontPresetId` to persistence or sync.

- [ ] **Step 4: Run store/default/sync tests**

```powershell
node --test test/unit-ci/ui-font-store.spec.js test/unit-ci/build-copy.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js
```

Expected: PASS; theme and terminal font fields remain unchanged.

- [ ] **Step 5: Commit the state model**

```powershell
git add src/client/store/ui-font.js src/client/store/init-state.js src/client/store/store.js src/client/common/default-setting.js src/app/common/default-setting.js src/client/store/sync.js test/unit-ci/ui-font-store.spec.js
git commit -m "feat: add UI font preview state"
```

### Task 3: Inject the effective UI font without touching the terminal

**Files:**
- Create: `apps/electerm-agent/src/client/components/main/ui-font.jsx`
- Modify: `apps/electerm-agent/src/client/components/main/main.jsx`
- Modify: `apps/electerm-agent/src/client/css/basic.styl`
- Modify: `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`

- [ ] **Step 1: Write failing isolation assertions**

Add this contract:

```js
test('injects a UI-only font variable and leaves terminal font fields separate', () => {
  const main = readClient('components/main/main.jsx')
  const basic = readClient('css/basic.styl')
  const injector = readClient('components/main/ui-font.jsx')
  assert.match(main, /<UiFont presetId=\{effectiveUiFontPresetId\}/)
  assert.match(basic, /font-family var\(--sp-ui-font-family/)
  assert.match(injector, /--sp-ui-font-family/)
  assert.match(injector, /getUiFontAvailability/)
  assert.match(injector, /getUiFontPreset\('system'\)/)
  assert.doesNotMatch(injector, /fontFamily|terminalBackgroundTextFontFamily/)
  assert.doesNotMatch(basic, /\.xterm[\s\S]{0,120}--sp-ui-font-family/)
})
```

- [ ] **Step 2: Run the contract and verify failure**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js
```

Expected: FAIL because `UiFont` and the CSS variable do not exist.

- [ ] **Step 3: Implement the UI font injector**

Create `components/main/ui-font.jsx`. Resolve unavailable or undetectable saved presets to the system stack, issue one non-blocking warning per session, and never rewrite the user's saved preset ID so the font can become active again if installed later:

```jsx
import { useEffect } from 'react'
import { notification } from '../common/notification'
import {
  getUiFontAvailability,
  getUiFontPreset
} from '../../common/ui-font-presets.js'

const warnedPresetIds = new Set()

export default function UiFont ({ presetId }) {
  useEffect(() => {
    const preset = getUiFontPreset(presetId)
    const availability = getUiFontAvailability(preset)
    const applied = availability === 'available'
      ? preset
      : getUiFontPreset('system')
    document.documentElement.style.setProperty('--sp-ui-font-family', applied.stack)
    if (preset.id !== 'system' &&
        availability !== 'available' &&
        !warnedPresetIds.has(preset.id)) {
      warnedPresetIds.add(preset.id)
      notification.warning({ message: window.translate('uiFontFallbackNotice') })
    }
  }, [presetId])
  return null
}
```

In `main.jsx`, import it, read the observable preview field, and render it next to `UiTheme`:

```jsx
const effectiveUiFontPresetId = store.previewUiFontPresetId || config.uiFontPresetId || 'system'
// ...
<UiFont presetId={effectiveUiFontPresetId} />
```

Replace the hard-coded `body` font declaration in `basic.styl` with:

```stylus
font-family var(--sp-ui-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei UI', Arial, sans-serif)
```

Do not add the UI variable to `.xterm`, `.xterm-helper-textarea`, `.term-wrap`, terminal background pseudo-elements, or any terminal option object.

- [ ] **Step 4: Run isolation tests**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js test/unit-ci/shellpilot-theme-constraints.spec.js
```

Expected: PASS.

- [ ] **Step 5: Commit the injector**

```powershell
git add src/client/components/main/ui-font.jsx src/client/components/main/main.jsx src/client/css/basic.styl test/unit-ci/secondary-ui-contract.spec.js
git commit -m "feat: apply fonts to client UI only"
```

### Task 4: Build the searchable grouped font picker

**Files:**
- Create: `apps/electerm-agent/src/client/components/setting-panel/ui-font-picker.jsx`
- Create: `apps/electerm-agent/src/client/components/setting-panel/ui-font-picker.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-common.jsx`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-modal.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/ui-font-presets.spec.js`

- [ ] **Step 1: Add failing picker-source and catalog-copy tests**

Assert that the picker imports the fixed catalog, renders a searchbox/listbox, exposes disabled reasons, and has explicit apply/cancel controls. Add these keys to the expected bilingual catalog fixture:

```js
uiFont: ['UI 字体', 'UI Font'],
uiFontDescription: ['仅调整客户端界面；SSH 终端字体保持独立。', 'Changes the client interface only; SSH terminal fonts remain independent.'],
searchUiFonts: ['搜索 20 种预设字体', 'Search 20 preset fonts'],
fontGroupRecommended: ['推荐与中文', 'Recommended and Chinese'],
fontGroupModern: ['现代界面', 'Modern UI'],
fontGroupMore: ['更多样式', 'More styles'],
fontNotInstalled: ['系统未安装', 'Not installed on this system'],
fontDetectionUnavailable: ['无法检测字体', 'Font detection unavailable'],
uiFontPreview: ['即时预览', 'Live Preview'],
applyUiFont: ['应用字体', 'Apply Font'],
cancelUiFontPreview: ['取消并恢复', 'Cancel and Restore']
uiFontFallbackNotice: ['所选 UI 字体不可用，已临时恢复系统字体。', 'The selected UI font is unavailable. System Default is being used temporarily.']
```

- [ ] **Step 2: Run the focused tests and verify failure**

```powershell
node --test test/unit-ci/ui-font-presets.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
```

Expected: FAIL because picker copy and source are absent.

- [ ] **Step 3: Implement the picker component**

The component must use `searchUiFontPresets(query)`, compute availability once per mount, and render all matching presets grouped in `recommended`, `modern`, and `more`. Its interaction core must be:

```jsx
const selectedId = store.getUiFontPresetId()
const hasPreview = Boolean(store.previewUiFontPresetId)

function selectPreset (item) {
  if (availability[item.id] !== 'available') return
  store.previewUiFontPreset(item.id)
}

function applyPreset () {
  store.applyUiFontPreset()
}

function cancelPreview () {
  store.cancelUiFontPreview()
}
```

Use semantic markup:

```jsx
<Input.Search role='searchbox' aria-label={e('searchUiFonts')} />
<div role='listbox' aria-label={e('uiFont')}>
  <button
    type='button'
    role='option'
    aria-selected={selectedId === item.id}
    aria-disabled={status !== 'available'}
    disabled={status !== 'available'}
    style={status === 'available' ? { fontFamily: item.stack } : undefined}
  >
    <span>{language === 'en_us' ? item.en : item.zh}</span>
    {status === 'unavailable' ? <small>{e('fontNotInstalled')}</small> : null}
    {status === 'unknown' ? <small>{e('fontDetectionUnavailable')}</small> : null}
  </button>
</div>
```

The preview card must show `连接与终端设置`, `Connection and terminal preferences`, digits, symbols, and `C:\Server\Logs`. Show Apply and Cancel only when `hasPreview` is true. On picker unmount, call `store.cancelUiFontPreview()`.

Mount the picker inside `renderAppearanceFields` after the UI theme control. In `setting-modal.jsx`, call `store.cancelUiFontPreview()` in `handleClose` beside the existing language reset.

- [ ] **Step 4: Add responsive styles**

Use a two-column picker/preview layout above 820px, a single column below 820px, and an internally scrolling two-column list that becomes one column below 590px:

```stylus
.sp-ui-font-layout
  display grid
  grid-template-columns minmax(280px, 1fr) minmax(260px, 1fr)
  gap 16px
  min-width 0

.sp-ui-font-list
  display grid
  grid-template-columns repeat(2, minmax(0, 1fr))
  max-height 320px
  overflow-y auto
  overflow-x hidden

@media (max-width: 820px)
  .sp-ui-font-layout
    grid-template-columns minmax(0, 1fr)

@media (max-width: 590px)
  .sp-ui-font-list
    grid-template-columns minmax(0, 1fr)
```

All labels and reasons must wrap naturally; unavailable entries stay visible and disabled.

- [ ] **Step 5: Run picker tests**

```powershell
node --test test/unit-ci/ui-font-presets.spec.js test/unit-ci/ui-font-store.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit the picker**

```powershell
git add src/client/components/setting-panel/ui-font-picker.jsx src/client/components/setting-panel/ui-font-picker.styl src/client/components/setting-panel/setting-common.jsx src/client/components/setting-panel/setting-modal.jsx src/client/common/shellpilot-i18n-overrides.js test/unit-ci/ui-font-presets.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
git commit -m "feat: add searchable UI font picker"
```

### Task 5: Add end-to-end persistence and terminal-invariant coverage

**Files:**
- Modify: `apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js`

- [ ] **Step 1: Add the UI font lifecycle acceptance test**

Use the real settings modal and capture terminal options before preview:

```js
test('UI font preview applies cancels persists and leaves terminal unchanged', async ({ browserName }) => {
  await runWithIsolatedApp('ui-font-lifecycle', async electronApp => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true)
    const before = await page.evaluate(() => ({
      saved: window.store.config.uiFontPresetId || 'system',
      theme: window.store.config.theme,
      terminalFont: window.store.config.fontFamily,
      terminalBackgroundFont: window.store.config.terminalBackgroundTextFontFamily,
      terminalBackground: window.store.getThemeConfig().background
    }))

    await openSettings(page)
    await page.getByRole('option', { name: /Segoe UI$/ }).click()
    expect(await page.evaluate(() => window.store.previewUiFontPresetId)).toBe('segoe-ui')
    await page.getByRole('button', { name: 'Cancel and Restore' }).click()
    expect(await page.evaluate(() => window.store.previewUiFontPresetId)).toBe('')

    await page.getByRole('option', { name: /Segoe UI$/ }).click()
    await page.getByRole('button', { name: 'Apply Font' }).click()
    const after = await page.evaluate(() => ({
      saved: window.store.config.uiFontPresetId,
      theme: window.store.config.theme,
      terminalFont: window.store.config.fontFamily,
      terminalBackgroundFont: window.store.config.terminalBackgroundTextFontFamily,
      terminalBackground: window.store.getThemeConfig().background
    }))
    expect(after).toEqual({ ...before, saved: 'segoe-ui' })
    expect(after.terminalBackground).toBe('#0E0F12')
  })
})
```

Also assert the list contains 20 items before search, unavailable fixtures remain visible/disabled, the picker has no horizontal overflow at 590px, and changing the UI theme does not alter `uiFontPresetId`.

- [ ] **Step 2: Run the lifecycle acceptance test**

```powershell
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --grep "UI font preview" --workers=1
```

Expected: PASS. A failure must name the broken preview/apply/cancel, availability, responsive, persistence, theme-independence, or terminal-isolation assertion; investigate it with `superpowers:systematic-debugging` before changing code. If the evidence points at terminal-renderer changes, stop and re-check the boundary rather than editing terminal code.

- [ ] **Step 3: Run the full font and visual test set**

```powershell
node --test test/unit-ci/ui-font-presets.spec.js test/unit-ci/ui-font-store.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js test/unit-ci/shellpilot-theme-constraints.spec.js
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1
```

Expected: exit code 0; preview/apply/cancel and terminal invariants pass in both languages, all themes, widths, and zoom levels.

- [ ] **Step 4: Commit end-to-end coverage**

```powershell
git add test/e2e/022.secondary-ui-visual-matrix.spec.js
git commit -m "test: cover UI font lifecycle and isolation"
```

### Task 6: Run the UI font local gate

**Files:**
- Verify only.

- [ ] **Step 1: Run lint and subsystem tests**

```powershell
npx standard src/client/common/ui-font-presets.js src/client/store/ui-font.js src/client/components/main/ui-font.jsx src/client/components/setting-panel/ui-font-picker.jsx test/unit-ci/ui-font-presets.spec.js test/unit-ci/ui-font-store.spec.js
node --test test/unit-ci/ui-font-presets.spec.js test/unit-ci/ui-font-store.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js test/unit-ci/shellpilot-theme-constraints.spec.js
```

Expected: exit code 0 and zero failed tests.

- [ ] **Step 2: Verify the local client manually**

```powershell
npm run app
```

Check all 20 rows, Chinese/English search, installed/uninstalled states, each available preview, Apply, Cancel, modal close, settings-tab change, theme change, restart persistence, and a simulated missing saved font. In a connected SSH terminal, compare font family, font size, character widths, cursor placement, copy/paste, ANSI colors, and `#0E0F12` background before and after UI font changes.

- [ ] **Step 3: Stop at local validation**

Record evidence in the handoff. Do not publish an update or run release/upload commands.
