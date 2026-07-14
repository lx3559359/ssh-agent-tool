# ShellPilot Secondary UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize ShellPilot settings, configuration forms, theme management, application context menus, and Simplified Chinese/English copy without changing SSH, SFTP, AI, sync, persistence, or menu action behavior.

**Architecture:** Add a semantic secondary-UI theme layer over the existing React 19, Ant Design 6, Stylus, and Manate architecture. Preserve existing store actions and form callbacks, isolate previews in temporary UI state, adapt old themes through pure helpers, and enforce a terminal-background invariant before every terminal theme reaches xterm.

**Tech Stack:** Electron 41, React 19, Ant Design 6, Stylus, Manate, Node.js test runner, StandardJS, Playwright.

**Scope guard:** Make no main-workbench layout changes. The top bar and primary sidebar may inherit existing global theme colors, but this plan does not reposition, resize, or redesign them. Informational help, update, and status dialogs remain out of scope unless they consume a shared component changed here.

**Execution directory:** Run Tasks 1–11 from `F:\SSH工具开发\apps\electerm-agent`; their `src/`, `test/`, and `git add` paths are relative to that directory. Task 12 includes an explicit `cd` before the combined verification commands.

---

## File structure and responsibility map

New focused files:

- `apps/electerm-agent/src/client/common/shellpilot-theme-constraints.js`: terminal-background invariant and terminal theme normalization.
- `apps/electerm-agent/src/client/common/ui-theme-tokens.js`: derive semantic secondary-UI tokens and build CSS variables.
- `apps/electerm-agent/src/client/common/shellpilot-ui-palettes.js`: five built-in ShellPilot palettes represented as normal theme records.
- `apps/electerm-agent/src/client/common/setting-search-index.js`: non-sensitive setting metadata and query matching.
- `apps/electerm-agent/src/client/common/theme-field-labels.js`: localized names for UI and terminal color variables.
- `apps/electerm-agent/src/client/components/setting-panel/setting-header.jsx`: search, language preview, save state, and close controls.
- `apps/electerm-agent/src/client/components/setting-panel/setting-section.jsx`: shared semantic card wrapper for settings and configuration groups.
- `apps/electerm-agent/src/client/components/theme/theme-gallery.jsx`: theme cards, filters, preview, and apply controls.
- `apps/electerm-agent/src/client/components/theme/theme-preview.jsx`: scoped preview of cards, menus, status colors, and the locked terminal.
- `apps/electerm-agent/src/client/css/includes/secondary-ui.styl`: global secondary-UI variables and Ant Design overlay styling.
- `apps/electerm-agent/test/unit-ci/shellpilot-theme-constraints.spec.js`: terminal lock and import normalization tests.
- `apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js`: old-theme compatibility and semantic token tests.
- `apps/electerm-agent/test/unit-ci/shellpilot-ui-palettes.spec.js`: built-in palette contract tests.
- `apps/electerm-agent/test/unit-ci/setting-search-index.spec.js`: search navigation and sensitive-value exclusion tests.
- `apps/electerm-agent/test/unit-ci/theme-field-labels.spec.js`: bilingual advanced editor label tests.
- `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`: responsive, context-menu, i18n, and no-main-layout-regression source contracts.

Existing files remain responsible for business behavior. The plan changes their presentation or delegates pure transformations to the new files; it does not duplicate store actions.

---

### Task 1: Lock the terminal background invariant

**Files:**
- Create: `apps/electerm-agent/src/client/common/shellpilot-theme-constraints.js`
- Create: `apps/electerm-agent/test/unit-ci/shellpilot-theme-constraints.spec.js`
- Modify: `apps/electerm-agent/src/client/common/theme-defaults.js`
- Modify: `apps/electerm-agent/src/client/common/terminal-theme.js`
- Modify: `apps/electerm-agent/src/client/store/terminal-theme.js`
- Modify: `apps/electerm-agent/src/client/components/theme/theme-form.jsx`
- Modify: `apps/electerm-agent/src/app/upgrade/db-defaults.js`
- Modify: `apps/electerm-agent/test/unit-ci/theme-defaults.spec.js`

- [ ] **Step 1: Write failing invariant tests**

Create `test/unit-ci/shellpilot-theme-constraints.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const constraintsUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/shellpilot-theme-constraints.js'
)).href
const terminalThemeUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/terminal-theme.js'
)).href

test('normalizes every terminal theme to the ShellPilot near-black background', async () => {
  const {
    shellPilotTerminalBackground,
    normalizeTerminalThemeConfig
  } = await import(constraintsUrl)

  assert.equal(shellPilotTerminalBackground, '#0E0F12')
  assert.deepEqual(
    normalizeTerminalThemeConfig({ background: '#ffffff', foreground: '#eeeeee' }),
    { background: '#0E0F12', foreground: '#eeeeee' }
  )
})

test('locks imported theme text before it reaches the store', async () => {
  const { convertTheme } = await import(terminalThemeUrl)
  const theme = convertTheme([
    'main=#ffffff',
    'terminal:background=#fafafa',
    'terminal:foreground=#222222'
  ].join('\n'))

  assert.equal(theme.themeConfig.background, '#0E0F12')
  assert.equal(theme.themeConfig.foreground, '#222222')
})

test('theme save and database defaults cannot restore a light terminal background', () => {
  const form = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/theme/theme-form.jsx'), 'utf8')
  const defaults = fs.readFileSync(path.resolve(__dirname, '../../src/app/upgrade/db-defaults.js'), 'utf8')
  assert.match(form, /normalizeTerminalThemeConfig/)
  assert.doesNotMatch(form, /themeConfig\.background\s*=\s*converted\.uiThemeConfig\.main/)
  assert.match(defaults, /background=#0E0F12/)
  assert.match(defaults, /background:\s*'#0E0F12'/)
})
```

Replace the existing light-theme assertion in `test/unit-ci/theme-defaults.spec.js` with:

```js
test('default light UI still uses the locked near-black terminal background', async () => {
  const { defaultThemeLight } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/common/theme-defaults.js'
  )))
  const theme = defaultThemeLight()

  assert.equal(theme.themeConfig.background, '#0E0F12')
  assert.equal(theme.themeConfig.foreground, '#1f2937')
  assert.equal(theme.themeConfig.cursor, '#2563eb')
})
```

- [ ] **Step 2: Run the tests and verify the expected failures**

Run:

```powershell
cd F:\SSH工具开发\apps\electerm-agent
node --test test/unit-ci/shellpilot-theme-constraints.spec.js test/unit-ci/theme-defaults.spec.js
```

Expected: FAIL because `shellpilot-theme-constraints.js` does not exist and the default light background is still `#f7f8fa`.

- [ ] **Step 3: Add the pure terminal constraint helper**

Create `src/client/common/shellpilot-theme-constraints.js`:

```js
export const shellPilotTerminalBackground = '#0E0F12'

export function normalizeTerminalThemeConfig (themeConfig = {}) {
  return {
    ...themeConfig,
    background: shellPilotTerminalBackground
  }
}
```

- [ ] **Step 4: Apply the helper at defaults, import, and runtime read boundaries**

In `src/client/common/theme-defaults.js`, import the helper and wrap both terminal defaults:

```js
import { normalizeTerminalThemeConfig } from './shellpilot-theme-constraints'

export function defaultTheme () {
  return {
    id: 'default',
    name: 'default',
    themeConfig: normalizeTerminalThemeConfig(defaultThemeDarkTerminal()),
    uiThemeConfig: defaultThemeDark()
  }
}

export function defaultThemeLight () {
  return {
    id: 'defaultLight',
    name: 'default light',
    themeConfig: normalizeTerminalThemeConfig(defaultThemeLightTerminal()),
    uiThemeConfig: defaultThemeLightFunc()
  }
}
```

In `src/client/common/terminal-theme.js`, import the helper and return a normalized parse result:

```js
import { normalizeTerminalThemeConfig } from './shellpilot-theme-constraints'

export const convertTheme = (themeTxt) => {
  const parsed = themeTxt.split('\n').reduce((prev, line) => {
    let [key = '', value = ''] = line.split('=')
    key = key.trim()
    value = value.trim()
    if (!key || !value) return prev
    if (key === 'themeName') {
      prev.name = value.slice(0, 50)
      return prev
    }
    const isTerminal = key.startsWith(terminalPrefix)
    key = key.replace(terminalPrefix, '')
    if (key.includes('selection')) key = 'selectionBackground'
    const target = isTerminal ? prev.themeConfig : prev.uiThemeConfig
    target[key] = value
    return prev
  }, {
    themeConfig: {},
    uiThemeConfig: {}
  })
  parsed.themeConfig = normalizeTerminalThemeConfig(parsed.themeConfig)
  return parsed
}
```

In `src/client/store/terminal-theme.js`, normalize persisted themes when read:

```js
import { normalizeTerminalThemeConfig } from '../common/shellpilot-theme-constraints'

Store.prototype.getThemeConfig = function () {
  const { store } = window
  const all = store.getSidebarList(settingMap.terminalThemes)
  const selected = all.find(d => d.id === store.config.theme)
  return normalizeTerminalThemeConfig(selected?.themeConfig || {})
}
```

In `src/client/components/theme/theme-form.jsx`, import the helper and replace the UI-main/background coupling with:

```js
import { normalizeTerminalThemeConfig } from '../../common/shellpilot-theme-constraints'

const converted = convertTheme(themeText)
converted.themeConfig = normalizeTerminalThemeConfig(converted.themeConfig)
```

In `src/app/upgrade/db-defaults.js`, set the `background` entry in both `defaultThemeLightTerminal` and `defaultThemeTerminal` to:

```js
background: '#0E0F12'
```

For the parsed light-theme text block, use:

```text
background=#0E0F12
```

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
node --test test/unit-ci/shellpilot-theme-constraints.spec.js test/unit-ci/theme-defaults.spec.js
```

Expected: 3 tests PASS.

- [ ] **Step 6: Commit the invariant**

```powershell
git add src/client/common/shellpilot-theme-constraints.js src/client/common/theme-defaults.js src/client/common/terminal-theme.js src/client/store/terminal-theme.js src/client/components/theme/theme-form.jsx src/app/upgrade/db-defaults.js test/unit-ci/shellpilot-theme-constraints.spec.js test/unit-ci/theme-defaults.spec.js
git commit -m "fix: lock ShellPilot terminal background"
```

---

### Task 2: Add semantic secondary-UI theme tokens

**Files:**
- Create: `apps/electerm-agent/src/client/common/ui-theme-tokens.js`
- Create: `apps/electerm-agent/src/client/css/includes/secondary-ui.styl`
- Create: `apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js`
- Modify: `apps/electerm-agent/src/client/components/main/ui-theme.jsx`
- Modify: `apps/electerm-agent/src/client/css/basic.styl`

- [ ] **Step 1: Write failing token derivation tests**

Create `test/unit-ci/ui-theme-tokens.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/ui-theme-tokens.js'
)).href

test('derives complete secondary tokens from a legacy UI theme', async () => {
  const { deriveSecondaryThemeTokens } = await import(moduleUrl)
  const tokens = deriveSecondaryThemeTokens({
    main: '#ededed',
    'main-light': '#fefefe',
    'main-dark': '#cccccc',
    text: '#555555',
    'text-dark': '#444444',
    'text-disabled': '#888888',
    primary: '#0088cc',
    success: '#06D6A0',
    error: '#EF476F',
    warn: '#E55934',
    info: '#FFD166'
  })

  assert.equal(tokens.page, '#ededed')
  assert.equal(tokens.surface, '#fefefe')
  assert.equal(tokens.primary, '#0088cc')
  assert.match(tokens.border, /^#/)
  assert.match(tokens.primarySoft, /^#/)
  assert.equal(tokens.radiusCard, '10px')
})

test('builds stable CSS custom properties for the secondary UI', async () => {
  const { buildUiThemeCss } = await import(moduleUrl)
  const css = buildUiThemeCss({ main: '#111111', text: '#eeeeee', primary: '#2878e6' })

  assert.match(css, /--sp-page:/)
  assert.match(css, /--sp-surface:/)
  assert.match(css, /--sp-primary: #2878E6/)
  assert.match(css, /--sp-radius-card: 10px/)
})
```

- [ ] **Step 2: Run the tests and verify they fail**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js
```

Expected: FAIL because `ui-theme-tokens.js` does not exist.

- [ ] **Step 3: Implement color derivation and CSS serialization**

Create `src/client/common/ui-theme-tokens.js`:

```js
function expandHex (value, fallback) {
  const source = /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback
  return source.toUpperCase()
}

function mix (left, right, ratio) {
  const values = [left, right].map(value => value.slice(1).match(/.{2}/g).map(hex => parseInt(hex, 16)))
  const rgb = values[0].map((value, index) => Math.round(value * (1 - ratio) + values[1][index] * ratio))
  return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

export function deriveSecondaryThemeTokens (theme = {}) {
  const page = expandHex(theme.main, '#F3F6FA')
  const surface = expandHex(theme['main-light'], mix(page, '#FFFFFF', 0.84))
  const text = expandHex(theme.text, '#253249')
  const primary = expandHex(theme.primary, '#2878E6')
  return {
    page,
    surface,
    surfaceSubtle: mix(surface, page, 0.55),
    surfaceElevated: surface,
    text,
    textMuted: expandHex(theme['text-dark'], mix(text, page, 0.52)),
    textDisabled: expandHex(theme['text-disabled'], mix(text, page, 0.64)),
    border: mix(text, surface, 0.84),
    borderStrong: mix(text, surface, 0.72),
    primary,
    primarySoft: mix(primary, surface, 0.88),
    success: expandHex(theme.success, '#168A74'),
    info: expandHex(theme.info, '#2878E6'),
    warning: expandHex(theme.warn, '#C56A20'),
    danger: expandHex(theme.error, '#CF3F50'),
    radiusControl: '7px',
    radiusCard: '10px',
    radiusOverlay: '9px',
    shadowCard: '0 3px 12px rgba(30, 58, 95, 0.08)',
    shadowOverlay: '0 13px 30px rgba(30, 41, 59, 0.18)'
  }
}

export function buildUiThemeCss (theme) {
  const tokens = deriveSecondaryThemeTokens(theme)
  const variables = Object.entries(tokens).map(([key, value]) => {
    const cssKey = key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)
    return `--sp-${cssKey}: ${value};`
  }).join('\n')
  return `:root {\n${variables}\n}`
}
```

- [ ] **Step 4: Wire semantic variables into the existing theme injector**

In `src/client/components/main/ui-theme.jsx`, import `buildUiThemeCss` and append its output inside the existing `buildTheme` function:

```js
import { buildUiThemeCss } from '../../common/ui-theme-tokens'

function buildTheme (themeConfig) {
  const keys = Object.keys(themeConfig || {})
  const legacyVariables = keys.map(key => {
    const value = themeConfig[key]
    if (key === 'primary') {
      const contrast = isColorDark(value) ? '#fff' : '#000'
      return `--${key}-contrast: ${contrast};\n--${key}: ${value};`
    }
    if (key === 'main') {
      return `--${key}-darker: ${darker(value, 0.3)};\n--${key}-lighter: ${darker(value, -0.3)};\n--${key}: ${value};`
    }
    return `--${key}: ${value};`
  }).join('\n')
  return Promise.resolve(`:root {\n${legacyVariables}\n}\n${buildUiThemeCss(themeConfig)}\n`)
}
```

- [ ] **Step 5: Add global secondary-UI primitives**

Create `src/client/css/includes/secondary-ui.styl`:

```stylus
.sp-secondary-page
  background var(--sp-page)
  color var(--sp-text)

.sp-card
  background var(--sp-surface)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-card)
  box-shadow var(--sp-shadow-card)

.sp-muted
  color var(--sp-text-muted)

.sp-focusable:focus-visible
  outline 2px solid var(--sp-primary)
  outline-offset 2px

.sp-danger
  color var(--sp-danger)
```

Add the following line to `src/client/css/basic.styl` after the existing include requirements:

```stylus
@require './includes/secondary-ui'
```

- [ ] **Step 6: Run focused tests and lint**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js
npx.cmd standard src/client/common/ui-theme-tokens.js src/client/components/main/ui-theme.jsx test/unit-ci/ui-theme-tokens.spec.js
```

Expected: tests PASS and StandardJS exits 0.

- [ ] **Step 7: Commit semantic theme tokens**

```powershell
git add src/client/common/ui-theme-tokens.js src/client/components/main/ui-theme.jsx src/client/css/basic.styl src/client/css/includes/secondary-ui.styl test/unit-ci/ui-theme-tokens.spec.js
git commit -m "feat: add secondary UI theme tokens"
```

---

### Task 3: Add five built-in ShellPilot UI palettes

**Files:**
- Create: `apps/electerm-agent/src/client/common/shellpilot-ui-palettes.js`
- Create: `apps/electerm-agent/test/unit-ci/shellpilot-ui-palettes.spec.js`
- Modify: `apps/electerm-agent/src/client/store/terminal-theme.js`
- Modify: `apps/electerm-agent/src/client/components/theme/theme-list-item.jsx`

- [ ] **Step 1: Write failing palette contract tests**

Create `test/unit-ci/shellpilot-ui-palettes.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/shellpilot-ui-palettes.js'
)).href

test('ships five named ShellPilot palettes with locked terminal backgrounds', async () => {
  const { buildShellPilotBuiltInThemes } = await import(moduleUrl)
  const themes = buildShellPilotBuiltInThemes({ foreground: '#dddddd', background: '#ffffff' })

  assert.deepEqual(themes.map(theme => theme.id), [
    'shellpilot-ocean',
    'shellpilot-jade',
    'shellpilot-indigo',
    'shellpilot-amber',
    'shellpilot-graphite'
  ])
  assert.deepEqual(themes.map(theme => theme.mode), ['light', 'light', 'light', 'light', 'dark'])
  assert.deepEqual(themes.map(theme => theme.name), [
    'Ocean Blue', 'Jade Green', 'Cloud Indigo', 'Warm Amber', 'Graphite Night'
  ])
  assert.equal(themes.every(theme => theme.themeConfig.background === '#0E0F12'), true)
  assert.equal(themes.every(theme => theme.readonly === true), true)
})
```

- [ ] **Step 2: Run the palette test and verify it fails**

```powershell
node --test test/unit-ci/shellpilot-ui-palettes.spec.js
```

Expected: FAIL because `shellpilot-ui-palettes.js` does not exist.

- [ ] **Step 3: Implement palette records**

Create `src/client/common/shellpilot-ui-palettes.js`:

```js
import { normalizeTerminalThemeConfig } from './shellpilot-theme-constraints'

const palettes = [
  ['ocean', 'Ocean Blue', 'shellpilotThemeOcean', 'shellpilotThemeOceanDesc', 'light', '#F3F6FB', '#FFFFFF', '#253249', '#2878E6'],
  ['jade', 'Jade Green', 'shellpilotThemeJade', 'shellpilotThemeJadeDesc', 'light', '#EFF7F5', '#FFFFFF', '#203A36', '#168A74'],
  ['indigo', 'Cloud Indigo', 'shellpilotThemeIndigo', 'shellpilotThemeIndigoDesc', 'light', '#F4F2FA', '#FFFFFF', '#302C45', '#6D55D9'],
  ['amber', 'Warm Amber', 'shellpilotThemeAmber', 'shellpilotThemeAmberDesc', 'light', '#F7F3EB', '#FFFDFA', '#3D3528', '#C56A20'],
  ['graphite', 'Graphite Night', 'shellpilotThemeGraphite', 'shellpilotThemeGraphiteDesc', 'dark', '#10161F', '#19212C', '#DBE4EF', '#55A8FF']
]

export function buildShellPilotBuiltInThemes (baseTerminalTheme = {}) {
  return palettes.map(([key, name, nameKey, descriptionKey, mode, main, mainLight, text, primary]) => ({
    id: `shellpilot-${key}`,
    name,
    nameKey,
    descriptionKey,
    mode,
    readonly: true,
    type: 'shellpilot',
    uiThemeConfig: {
      main,
      'main-light': mainLight,
      'main-dark': mode === 'dark' ? '#0B1018' : '#DDE5EF',
      text,
      'text-light': mode === 'dark' ? '#FFFFFF' : '#526176',
      'text-dark': mode === 'dark' ? '#91A0B5' : '#667489',
      'text-disabled': mode === 'dark' ? '#66758A' : '#98A3B3',
      primary,
      info: '#2878E6',
      success: '#168A74',
      error: '#CF3F50',
      warn: '#C56A20'
    },
    themeConfig: normalizeTerminalThemeConfig(baseTerminalTheme)
  }))
}
```

- [ ] **Step 4: Add built-ins to the existing theme store without persisting duplicates**

In `src/client/store/terminal-theme.js`, import the builder and replace `getTerminalThemes`:

```js
import { buildShellPilotBuiltInThemes } from '../common/shellpilot-ui-palettes'

Store.prototype.getTerminalThemes = function () {
  const t1 = defaultTheme()
  const t2 = defaultThemeLight()
  const builtIns = buildShellPilotBuiltInThemes(t1.themeConfig)
  const reserved = new Set([t1.id, t2.id, ...builtIns.map(theme => theme.id)])
  const userThemes = window.store.getItems(settingMap.terminalThemes)
    .filter(theme => theme && !reserved.has(theme.id))
  return [t1, t2, ...builtIns, ...userThemes]
}
```

In `src/client/components/theme/theme-list-item.jsx`, localize records that carry `nameKey`:

```js
const localizedName = item.nameKey ? e(item.nameKey) : ''
let title = item.nameKey
  ? localizedName === item.nameKey ? name : localizedName
  : id === defaultTheme().id
    ? e(id)
    : name
```

This readable English `name` is an intentional compatibility fallback: Task 3 remains usable before Task 4 installs the ShellPilot locale catalog, while Task 4 localizes the same records through `nameKey`.

- [ ] **Step 5: Run palette and existing theme tests**

```powershell
node --test test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/shellpilot-theme-constraints.spec.js test/unit-ci/theme-defaults.spec.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit built-in themes**

```powershell
git add src/client/common/shellpilot-ui-palettes.js src/client/store/terminal-theme.js src/client/components/theme/theme-list-item.jsx test/unit-ci/shellpilot-ui-palettes.spec.js
git commit -m "feat: add ShellPilot UI palettes"
```

---

### Task 4: Build a Simplified Chinese and English ShellPilot locale layer

**Files:**
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/src/client/entry/basic.js`
- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-i18n-overrides.spec.js`

- [ ] **Step 1: Replace the current locale test with bilingual fallback coverage**

Use this body in `test/unit-ci/shellpilot-i18n-overrides.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/shellpilot-i18n-overrides.js'
)).href

test('provides complete ShellPilot labels in Simplified Chinese and English', async () => {
  const { getShellPilotTranslation } = await import(moduleUrl)
  assert.equal(getShellPilotTranslation('settingsCenter', 'zh_cn'), '设置中心')
  assert.equal(getShellPilotTranslation('settingsCenter', 'en_us'), 'Settings Center')
  assert.equal(getShellPilotTranslation('shellpilotThemeOcean', 'zh_cn'), '海湾蓝')
  assert.equal(getShellPilotTranslation('shellpilotThemeOcean', 'en_us'), 'Ocean Blue')
})

test('falls back through current locale, English, and readable default copy', async () => {
  const { resolveShellPilotTranslation } = await import(moduleUrl)
  assert.equal(resolveShellPilotTranslation('bookmarks', 'zh_cn', '上游书签', 'Bookmarks'), '书签')
  assert.equal(resolveShellPilotTranslation('unknown', 'zh_cn', '上游文案', 'English fallback'), '上游文案')
  assert.equal(resolveShellPilotTranslation('unknown', 'fr_fr', undefined, 'English fallback'), 'English fallback')
  assert.equal(resolveShellPilotTranslation('unknown', 'fr_fr', undefined, undefined, 'Readable default'), 'Readable default')
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test test/unit-ci/shellpilot-i18n-overrides.spec.js
```

Expected: FAIL because the current override file has only five Chinese entries and no English fallback.

- [ ] **Step 3: Implement bilingual catalogs and deterministic fallback**

Replace `src/client/common/shellpilot-i18n-overrides.js` with:

```js
const catalogs = {
  zh_cn: {
    bookmarks: '书签', history: '历史', ssh: '终端', sftp: 'SFTP', widgets: '工具中心',
    settingsCenter: '设置中心', searchSettings: '搜索设置、选项或功能', autoSaved: '已自动保存',
    generalSettings: '常规设置', generalSettingsDescription: '配置 ShellPilot 的启动、连接、网络与显示行为',
    startupAndConnection: '启动与连接', startupAndConnectionDescription: '配置启动会话、连接超时和保活行为',
    networkAndUpdates: '网络与更新', networkAndUpdatesDescription: '配置代理、更新通道和更新来源',
    interfaceAndLanguage: '界面与语言', interfaceAndLanguageDescription: '配置界面主题、透明度和自定义样式',
    advancedSettings: '高级设置', advancedSettingsDescription: '配置外部程序、二次验证和兼容选项',
    terminalSettings: '终端设置', aiAndModels: 'AI 与模型',
    syncAndBackup: '同步与备份', keyboardShortcuts: '快捷键', passwordManager: '密码管理',
    themeLibrary: '主题库', themePreview: '实时预览', advancedColorEditor: '高级颜色编辑',
    shellpilotThemeOcean: '海湾蓝', shellpilotThemeOceanDesc: '专业清晰，适合日常服务器管理。',
    shellpilotThemeJade: '翡翠绿', shellpilotThemeJadeDesc: '舒缓稳重，状态色更加自然。',
    shellpilotThemeIndigo: '云境紫', shellpilotThemeIndigoDesc: '具有 AI 产品感和品牌辨识度。',
    shellpilotThemeAmber: '暖砂橙', shellpilotThemeAmberDesc: '温暖低压，弱化工具软件的冰冷感。',
    shellpilotThemeGraphite: '石墨夜', shellpilotThemeGraphiteDesc: '夜间使用，配置卡片仍保持清晰。',
    terminalBackgroundLocked: '终端背景已锁定为近黑色', restorePageDefaults: '恢复本页默认值',
    themeNameRequired: '请输入主题名称', themeMaxChars: '主题名称不能超过 30 个字符',
    themeConfigRequired: '请输入主题配置', themeMissingProperty: '主题配置缺少必需属性',
    themeInvalidColor: '颜色格式无效', themeUnsupportedProperty: '不支持的主题属性',
    testConfiguration: '测试配置', connectionHealthy: '连接正常', moveToSafeTrash: '移到安全回收站'
  },
  en_us: {
    bookmarks: 'Bookmarks', history: 'History', ssh: 'Terminal', sftp: 'SFTP', widgets: 'Tool Center',
    settingsCenter: 'Settings Center', searchSettings: 'Search settings, options, or features', autoSaved: 'Automatically saved',
    generalSettings: 'General', generalSettingsDescription: 'Configure ShellPilot startup, connection, network, and display behavior.',
    startupAndConnection: 'Startup and Connection', startupAndConnectionDescription: 'Configure startup sessions, connection timeouts, and keepalive behavior.',
    networkAndUpdates: 'Network and Updates', networkAndUpdatesDescription: 'Configure proxies, update channels, and update sources.',
    interfaceAndLanguage: 'Interface and Language', interfaceAndLanguageDescription: 'Configure UI themes, opacity, and custom styles.',
    advancedSettings: 'Advanced Settings', advancedSettingsDescription: 'Configure external programs, two-factor prompts, and compatibility options.',
    terminalSettings: 'Terminal', aiAndModels: 'AI and Models',
    syncAndBackup: 'Sync and Backup', keyboardShortcuts: 'Keyboard Shortcuts', passwordManager: 'Password Manager',
    themeLibrary: 'Theme Library', themePreview: 'Live Preview', advancedColorEditor: 'Advanced Color Editor',
    shellpilotThemeOcean: 'Ocean Blue', shellpilotThemeOceanDesc: 'Clear and professional for daily server administration.',
    shellpilotThemeJade: 'Jade Green', shellpilotThemeJadeDesc: 'Calm and stable with natural status colors.',
    shellpilotThemeIndigo: 'Cloud Indigo', shellpilotThemeIndigoDesc: 'A distinctive palette suited to AI-assisted workflows.',
    shellpilotThemeAmber: 'Warm Amber', shellpilotThemeAmberDesc: 'A warmer, lower-pressure interface for long sessions.',
    shellpilotThemeGraphite: 'Graphite Night', shellpilotThemeGraphiteDesc: 'A dark palette with clear configuration hierarchy.',
    terminalBackgroundLocked: 'Terminal background is locked to near-black', restorePageDefaults: 'Restore page defaults',
    themeNameRequired: 'Theme name is required', themeMaxChars: 'Theme name cannot exceed 30 characters',
    themeConfigRequired: 'Theme configuration is required', themeMissingProperty: 'Theme configuration is missing a required property',
    themeInvalidColor: 'Invalid color format', themeUnsupportedProperty: 'Unsupported theme property',
    testConfiguration: 'Test Configuration', connectionHealthy: 'Connection healthy', moveToSafeTrash: 'Move to Safe Trash'
  }
}

export function getShellPilotTranslation (key, langId = 'zh_cn') {
  return catalogs[langId]?.[key]
}

export function resolveShellPilotTranslation (key, langId = 'zh_cn', localeValue, englishValue, readableDefault) {
  return getShellPilotTranslation(key, langId) || localeValue ||
    getShellPilotTranslation(key, 'en_us') || englishValue || readableDefault
}
```

- [ ] **Step 4: Pass the upstream English value into the resolver**

In `src/client/entry/basic.js`, replace `window.translate` with:

```js
window.translate = txt => {
  const langId = window.store?.previewLanguage || window.store?.config.language || 'zh_cn'
  const lang = window.getLang(langId)
  const english = window.getLang('en_us')
  const value = resolveShellPilotTranslation(
    txt,
    langId,
    _get(lang, `[${txt}]`),
    _get(english, `[${txt}]`),
    txt
  )
  return window.capitalizeFirstLetter(value)
}
```

- [ ] **Step 5: Run tests and lint**

```powershell
node --test test/unit-ci/shellpilot-i18n-overrides.spec.js
npx.cmd standard src/client/common/shellpilot-i18n-overrides.js src/client/entry/basic.js test/unit-ci/shellpilot-i18n-overrides.spec.js
```

Expected: tests PASS and StandardJS exits 0.

- [ ] **Step 6: Commit the locale layer**

```powershell
git add src/client/common/shellpilot-i18n-overrides.js src/client/entry/basic.js test/unit-ci/shellpilot-i18n-overrides.spec.js
git commit -m "feat: add ShellPilot bilingual locale layer"
```

---

### Task 5: Add non-sensitive settings search and language preview state

**Files:**
- Create: `apps/electerm-agent/src/client/common/setting-search-index.js`
- Create: `apps/electerm-agent/src/client/components/setting-panel/setting-header.jsx`
- Create: `apps/electerm-agent/test/unit-ci/setting-search-index.spec.js`
- Modify: `apps/electerm-agent/src/client/store/init-state.js`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-modal.jsx`

- [ ] **Step 1: Write failing search-index tests**

Create `test/unit-ci/setting-search-index.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/setting-search-index.js'
)).href

test('finds settings by Chinese and English metadata', async () => {
  const { searchSettings } = await import(moduleUrl)
  assert.equal(searchSettings('终端')[0].itemId, 'setting-terminal')
  assert.equal(searchSettings('model')[0].itemId, 'setting-ai')
  assert.equal(searchSettings('backup')[0].itemId, 'setting-sync')
})

test('contains metadata only and never accepts current config values', async () => {
  const { settingSearchEntries, searchSettings } = await import(moduleUrl)
  const serialized = JSON.stringify(settingSearchEntries)
  assert.equal(settingSearchEntries.some(entry => Object.hasOwn(entry, 'value')), false)
  assert.doesNotMatch(serialized, /sk-secret-value|10\.0\.0\.8/)
  assert.equal(searchSettings('sk-secret-value').length, 0)
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test test/unit-ci/setting-search-index.spec.js
```

Expected: FAIL because `setting-search-index.js` does not exist.

- [ ] **Step 3: Implement a static metadata index**

Create `src/client/common/setting-search-index.js`:

```js
import {
  settingMap,
  settingCommonId,
  settingTerminalId,
  settingAiId,
  settingSyncId,
  settingShortcutsId,
  settingPasswordsId
} from './constants'

export const settingSearchEntries = [
  { tab: settingMap.bookmarks, itemId: '', labelKey: 'bookmarks', terms: ['书签', '连接', 'bookmark', 'connection', 'server'] },
  { tab: settingMap.setting, itemId: settingCommonId, labelKey: 'generalSettings', terms: ['常规', 'general', 'startup', 'proxy', 'language', 'update'] },
  { tab: settingMap.setting, itemId: settingTerminalId, labelKey: 'terminalSettings', terms: ['终端', 'terminal', 'font', 'cursor', 'encoding'] },
  { tab: settingMap.setting, itemId: settingAiId, labelKey: 'aiAndModels', terms: ['模型', 'model', 'ai', 'mcp', 'agent', 'provider'] },
  { tab: settingMap.setting, itemId: settingSyncId, labelKey: 'syncAndBackup', terms: ['同步', '备份', 'sync', 'backup', 'webdav', 'gist'] },
  { tab: settingMap.setting, itemId: settingShortcutsId, labelKey: 'keyboardShortcuts', terms: ['快捷键', 'shortcut', 'keyboard', 'hotkey'] },
  { tab: settingMap.setting, itemId: settingPasswordsId, labelKey: 'passwordManager', terms: ['密码管理', 'credential manager', 'saved passwords'] },
  { tab: settingMap.terminalThemes, itemId: '', labelKey: 'themeLibrary', terms: ['主题', 'theme', 'palette', 'appearance'] },
  { tab: settingMap.quickCommands, itemId: '', labelKey: 'quickCommands', terms: ['快捷命令', 'quick command', 'command preset'] },
  { tab: settingMap.profiles, itemId: '', labelKey: 'profiles', terms: ['配置模板', 'profile', 'connection profile'] },
  { tab: settingMap.widgets, itemId: '', labelKey: 'widgets', terms: ['工具中心', 'tool center', 'widget'] }
]

function normalize (value) {
  return String(value || '').trim().toLocaleLowerCase()
}

export function searchSettings (query) {
  const needle = normalize(query)
  if (!needle) return []
  return settingSearchEntries.filter(entry => entry.terms.some(term => normalize(term).includes(needle)))
}
```

- [ ] **Step 4: Add temporary language state without changing persisted config**

Add this property to the object returned by `src/client/store/init-state.js`:

```js
previewLanguage: '',
```

Create `src/client/components/setting-panel/setting-header.jsx`:

```jsx
import { Input, Select, Button } from 'antd'
import { SearchOutlined, CloseOutlined } from '@ant-design/icons'

const e = window.translate

export default function SettingHeader ({ query, onQueryChange, onSearch, store, onClose }) {
  const currentLanguage = store.previewLanguage || store.config.language || 'zh_cn'
  const previewLanguage = value => { store.previewLanguage = value }
  const applyLanguage = () => {
    if (!store.previewLanguage) return
    store.setConfig({ language: store.previewLanguage })
    store.previewLanguage = ''
  }
  const cancelPreview = () => { store.previewLanguage = '' }
  return (
    <header className='sp-setting-header'>
      <h1>{e('settingsCenter')}</h1>
      <Input
        allowClear
        prefix={<SearchOutlined />}
        value={query}
        onChange={event => onQueryChange(event.target.value)}
        onPressEnter={onSearch}
        placeholder={e('searchSettings')}
      />
      <span className='sp-setting-save-state'>{e('autoSaved')}</span>
      <Select
        value={currentLanguage}
        onChange={previewLanguage}
        options={[
          { value: 'zh_cn', label: '简体中文' },
          { value: 'en_us', label: 'English' }
        ]}
      />
      {store.previewLanguage ? <Button onClick={applyLanguage}>{e('apply')}</Button> : null}
      {store.previewLanguage ? <Button onClick={cancelPreview}>{e('cancel')}</Button> : null}
      <Button type='text' icon={<CloseOutlined />} onClick={onClose} aria-label={e('close')} />
    </header>
  )
}
```

- [ ] **Step 5: Integrate search navigation and force preview-language rerendering**

In `src/client/components/setting-panel/setting-modal.jsx`, add `useState`, `SettingHeader`, and `searchSettings` imports. Inside `SettingModalWrap`, add:

```jsx
const { store } = props
const [query, setQuery] = useState('')

const openSearchResult = () => {
  const result = searchSettings(query)[0]
  if (!result) return
  store.handleChangeSettingTab(result.tab)
  if (result.itemId) {
    const item = store.settingSidebarList.find(candidate => candidate.id === result.itemId)
    if (item) store.setSettingItem(item)
  }
}
```

Render the header before `<Tabs>` and key the panel tree by the preview language:

```jsx
<SettingHeader
  query={query}
  onQueryChange={setQuery}
  onSearch={openSearchResult}
  store={store}
  onClose={store.hideSettingModal}
/>
<Tabs {...tabsProps} />
<div key={store.previewLanguage || store.config.language} className='sp-setting-localized-content'>
  <Suspense fallback={<Loading />}>
    <TabQuickCommands
      listProps={props0}
      settingItem={settingItem}
      formProps={formProps}
      store={store}
      settingTab={settingTab}
    />
    <TabBookmarks
      treeProps={treeProps}
      settingItem={settingItem}
      formProps={formProps}
      settingTab={settingTab}
    />
    <TabSettings
      listProps={props0}
      settingItem={settingItem}
      settingTab={settingTab}
      store={store}
    />
    <TabThemes
      listProps={props0}
      settingItem={settingItem}
      formProps={formProps}
      store={store}
      settingTab={settingTab}
    />
    <TabProfiles
      listProps={props0}
      settingItem={settingItem}
      formProps={formProps}
      store={store}
      settingTab={settingTab}
    />
    <TabWidgets
      listProps={props0}
      settingItem={settingItem}
      formProps={formProps}
      store={store}
      settingTab={settingTab}
    />
  </Suspense>
</div>
```

- [ ] **Step 6: Run focused tests and lint**

```powershell
node --test test/unit-ci/setting-search-index.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
npx.cmd standard src/client/common/setting-search-index.js src/client/components/setting-panel/setting-header.jsx src/client/components/setting-panel/setting-modal.jsx src/client/store/init-state.js test/unit-ci/setting-search-index.spec.js
```

Expected: tests PASS and StandardJS exits 0.

- [ ] **Step 7: Commit search and preview state**

```powershell
git add src/client/common/setting-search-index.js src/client/components/setting-panel/setting-header.jsx src/client/components/setting-panel/setting-modal.jsx src/client/store/init-state.js test/unit-ci/setting-search-index.spec.js
git commit -m "feat: add settings search and language preview"
```

---

### Task 6: Modernize the settings shell and prevent text compression

**Files:**
- Create: `apps/electerm-agent/src/client/components/setting-panel/setting-section.jsx`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-wrap.jsx`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-wrap.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/list.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-common.jsx`
- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-ui-responsive.spec.js`

- [ ] **Step 1: Add failing responsive contracts**

Append to `test/unit-ci/shellpilot-ui-responsive.spec.js`:

```js
test('settings use semantic cards and protect long bilingual copy', () => {
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const setting = readClient('components/setting-panel/setting.styl')
  const section = readClient('components/setting-panel/setting-section.jsx')

  assert.match(wrap, /@media \(max-width: 820px\)/)
  assert.match(wrap, /@media \(max-width: 680px\)/)
  assert.match(wrap, /overflow-x auto/)
  assert.match(setting, /overflow-wrap break-word/)
  assert.match(setting, /min-width 0/)
  assert.match(section, /sp-setting-section/)
})
```

- [ ] **Step 2: Run the responsive test and verify it fails**

```powershell
node --test test/unit-ci/shellpilot-ui-responsive.spec.js
```

Expected: FAIL because `setting-section.jsx` and the new breakpoints do not exist.

- [ ] **Step 3: Add the semantic section component**

Create `src/client/components/setting-panel/setting-section.jsx`:

```jsx
export default function SettingSection ({ title, description, children, className = '' }) {
  return (
    <section className={`sp-card sp-setting-section ${className}`.trim()}>
      <header className='sp-setting-section-header'>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      <div className='sp-setting-section-body'>{children}</div>
    </section>
  )
}
```

- [ ] **Step 4: Group the common settings page without changing handlers**

Import `SettingSection` in `src/client/components/setting-panel/setting-common.jsx`. Replace the top-level render body with sections that call the existing render methods:

```jsx
<div className='form-wrap sp-settings-form'>
  <div className='sp-settings-page-title'>
    <h2>{e('generalSettings')}</h2>
    <p>{e('generalSettingsDescription')}</p>
  </div>
  <SettingSection title={e('startupAndConnection')} description={e('startupAndConnectionDescription')}>
    <HotkeySetting {...hotkeyProps} />
    <div className='sp-setting-field'>
      <div className='sp-setting-field-label'>{e('onStartBookmarks')}</div>
      <StartSession {...pops} />
    </div>
    {this.renderNumber('sshReadyTimeout', { step: 200, min: 100, cls: 'timeout-desc' }, e('timeoutDesc'))}
    {this.renderNumber('keepaliveInterval', { step: 1000, min: 0, max: 20000000, cls: 'keepalive-interval-desc', extraDesc: '(ms)' }, e('keepaliveIntervalDesc'))}
  </SettingSection>
  <SettingSection title={e('networkAndUpdates')} description={e('networkAndUpdatesDescription')}>
    {this.renderProxy()}
    {this.renderUpdateChannel()}
    {this.renderUpdateSource()}
  </SettingSection>
  <SettingSection title={e('interfaceAndLanguage')} description={e('interfaceAndLanguageDescription')}>
    {this.renderNumber('opacity', { step: 0.05, min: 0, max: 1, cls: 'opacity' }, e('opacity'))}
    {this.renderAppearanceFields(terminalThemes, theme, customCss)}
  </SettingSection>
  <SettingSection title={e('advancedSettings')} description={e('advancedSettingsDescription')}>
    {this.renderAdvancedFields()}
    {window.et.isWebApp ? null : <DeepLinkControl />}
    {this.renderLoginPass()}
    {this.renderReset()}
  </SettingSection>
</div>
```

Extract `renderAppearanceFields` and `renderAdvancedFields` by moving the existing theme, custom CSS, language, executable, 2FA, and switch JSX unchanged; do not alter their callbacks or configuration keys.

Add these two methods to `SettingCommon` so every reference in the new render body is defined:

```jsx
renderAppearanceFields = (terminalThemes, theme, customCss) => (
  <>
    <div className='sp-setting-field'>
      <div className='sp-setting-field-label'>{e('uiThemes')}</div>
      <Select onChange={this.handleChangeTerminalTheme} value={theme} popupMatchSelectWidth={false}>
        {terminalThemes.filter(item => item.id && item.name && item.uiThemeConfig).map(item => (
          <Option key={item.id} value={item.id}>{item.nameKey ? e(item.nameKey) : item.name}</Option>
        ))}
      </Select>
    </div>
    <div className='sp-setting-field'>
      <div className='sp-setting-field-label'>{e('customCss')}</div>
      <TextareaConfirm onChange={this.handleCustomCss} value={customCss} rows={3} />
    </div>
  </>
)

renderAdvancedFields = () => (
  <>
    {['execWindows', 'execMac', 'execLinux'].map(name => (
      <div className='sp-setting-field' key={name}>
        <div className='sp-setting-field-label'>{e('default')} {e(name)}</div>
        {this.renderTextExec(name)}
      </div>
    ))}
    <div className='sp-setting-field'>
      <div className='sp-setting-field-label'>{e('keyword2FA')}</div>
      {this.renderText('keyword2FA')}
    </div>
    {[
      'autoRefreshWhenSwitchToSftp', 'showHiddenFilesOnSftpStart', 'screenReaderMode',
      'initDefaultTabOnStart', 'disableConnectionHistory', 'disableTransferHistory',
      'checkUpdateOnStart', 'useSystemTitleBar', 'confirmBeforeExit', 'hideIP',
      'allowMultiInstance', 'disableDeveloperTool', 'debug'
    ].map(this.renderToggle)}
  </>
)
```

Remove the old inline language selector and its now-unused `language` and `langs` locals from `SettingCommon.render`; `SettingHeader` is the single language preview and apply entry.

- [ ] **Step 5: Replace fixed-position settings layout with grid and breakpoints**

In `src/client/components/setting-panel/setting-wrap.jsx`, remove the two legacy close icons because `SettingHeader` now owns the only close action. Keep the drawer and drag region:

```jsx
return (
  <Drawer {...pops}>
    {this.props.useSystemTitleBar ? null : <AppDrag />}
    {this.props.children}
  </Drawer>
)
```

In `src/client/components/setting-panel/setting-wrap.styl`, replace the fixed column declarations with:

```stylus
.setting-wrap
  background var(--sp-page)
  color var(--sp-text)

.sp-setting-header
  position sticky
  top 0
  z-index 10
  min-height 48px
  display grid
  grid-template-columns auto minmax(220px, 420px) 1fr auto auto auto
  align-items center
  gap 10px
  padding 8px 18px
  background var(--sp-surface)
  border-bottom 1px solid var(--sp-border)

.setting-tabs
  position sticky
  top 48px
  z-index 9
  padding 8px 18px 0
  background var(--sp-surface)
  border-bottom 1px solid var(--sp-border)

.setting-col
  display grid
  grid-template-columns 226px minmax(0, 1fr)
  min-height calc(100vh - 112px)

.setting-row
  position static
  min-width 0

.setting-row-left
  padding 16px 12px
  background var(--sp-surface-subtle)
  border-right 1px solid var(--sp-border)

.setting-row-right
  padding 20px 24px
  overflow auto

@media (max-width: 820px)
  .sp-setting-header
    grid-template-columns auto 1fr auto
    h1
      grid-column 1
    .ant-input-affix-wrapper
      grid-column 2
    .sp-setting-save-state
      display none
  .setting-col
    display block
  .setting-row-left
    border-right 0
    border-bottom 1px solid var(--sp-border)
    overflow-x auto
    white-space nowrap
  .setting-row-right
    padding 14px

@media (max-width: 680px)
  .sp-setting-header
    .ant-input-affix-wrapper
      width 36px
      input
        display none
  .setting-tabs .ant-tabs-nav-wrap
    overflow-x auto
```

- [ ] **Step 6: Add card and long-copy styling**

In `src/client/components/setting-panel/setting.styl`, add:

```stylus
.sp-settings-form
  max-width 1120px
  margin 0 auto
  min-width 0

.sp-settings-page-title
  margin-bottom 16px
  h2
    margin 0
  p
    color var(--sp-text-muted)
    overflow-wrap break-word

.sp-setting-section
  min-width 0
  padding 16px 18px
  margin-bottom 14px

.sp-setting-section-header
  border-bottom 1px solid var(--sp-border)
  margin-bottom 12px
  h2
    font-size 14px
    margin 0
    overflow-wrap break-word
  p
    color var(--sp-text-muted)
    overflow-wrap break-word

.sp-setting-section-body
  min-width 0
  .ant-form-item-label
  .ant-form-item-control
  .ant-space
    min-width 0

@media (max-width: 820px)
  .sp-setting-section
    padding 14px
  .sp-setting-field
    display block
```

Update `src/client/components/setting-panel/list.styl` so list rows use `var(--sp-primary-soft)` and `var(--sp-text)` instead of filling the full row with the strong primary color.

- [ ] **Step 7: Run responsive tests and lint**

```powershell
node --test test/unit-ci/shellpilot-ui-responsive.spec.js
npx.cmd standard src/client/components/setting-panel/setting-section.jsx src/client/components/setting-panel/setting-common.jsx test/unit-ci/shellpilot-ui-responsive.spec.js
```

Expected: tests PASS and StandardJS exits 0.

- [ ] **Step 8: Commit the settings shell**

```powershell
git add src/client/components/setting-panel/setting-section.jsx src/client/components/setting-panel/setting-wrap.jsx src/client/components/setting-panel/setting-wrap.styl src/client/components/setting-panel/list.styl src/client/components/setting-panel/setting.styl src/client/components/setting-panel/setting-common.jsx test/unit-ci/shellpilot-ui-responsive.spec.js
git commit -m "feat: modernize ShellPilot settings layout"
```

---

### Task 7: Replace theme list preview writes with a scoped theme gallery

**Files:**
- Create: `apps/electerm-agent/src/client/components/theme/theme-gallery.jsx`
- Create: `apps/electerm-agent/src/client/components/theme/theme-preview.jsx`
- Create: `apps/electerm-agent/src/client/components/theme/theme-gallery.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/tab-themes.jsx`
- Modify: `apps/electerm-agent/src/client/components/theme/theme-list-item.jsx`
- Create: `apps/electerm-agent/test/unit-ci/theme-preview.spec.js`

- [ ] **Step 1: Write failing preview-isolation tests**

Create `test/unit-ci/theme-preview.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function read (file) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', file), 'utf8')
}

test('theme preview is scoped and only apply writes the selected theme', () => {
  const gallery = read('components/theme/theme-gallery.jsx')
  const preview = read('components/theme/theme-preview.jsx')
  const tab = read('components/setting-panel/tab-themes.jsx')

  assert.match(gallery, /onPreview\(item\.id\)/)
  assert.match(gallery, /onApply\(item\.id\)/)
  assert.doesNotMatch(gallery, /store\.setTheme/)
  assert.match(tab, /store\.setTheme\(themeId\)/)
  assert.match(preview, /shellPilotTerminalBackground/)
  assert.match(preview, /sp-theme-preview-scope/)
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test test/unit-ci/theme-preview.spec.js
```

Expected: FAIL because gallery and preview components do not exist.

- [ ] **Step 3: Add theme cards with explicit preview and apply callbacks**

Create `src/client/components/theme/theme-gallery.jsx`:

```jsx
import { Button, Input, Segmented, Tag } from 'antd'
import { useMemo, useState } from 'react'
import isColorDark from '../../common/is-color-dark'
import './theme-gallery.styl'

const e = window.translate

export default function ThemeGallery ({ themes, currentThemeId, previewThemeId, onPreview, onApply, onSelectForEdit }) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('all')
  const visible = useMemo(() => themes.filter(item => {
    const title = item.nameKey ? e(item.nameKey) : item.name
    const matchesQuery = title.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    const themeMode = item.mode || (isColorDark(item.uiThemeConfig?.main) ? 'dark' : 'light')
    return matchesQuery && (mode === 'all' || mode === themeMode)
  }), [themes, query, mode])

  return (
    <section className='sp-theme-gallery'>
      <div className='sp-theme-gallery-toolbar'>
        <Input allowClear value={query} onChange={event => setQuery(event.target.value)} placeholder={e('search')} />
        <Segmented value={mode} onChange={setMode} options={[
          { value: 'all', label: e('all') },
          { value: 'light', label: e('light') },
          { value: 'dark', label: e('dark') }
        ]} />
      </div>
      <div className='sp-theme-card-grid'>
        {visible.map(item => {
          const title = item.nameKey ? e(item.nameKey) : item.name
          const description = item.descriptionKey ? e(item.descriptionKey) : ''
          const active = item.id === currentThemeId
          const previewing = item.id === previewThemeId
          return (
            <article key={item.id} className={`sp-theme-card ${active ? 'active' : ''}`}>
              <button type='button' className='sp-theme-palette' onClick={() => onSelectForEdit(item)} aria-label={title}>
                {['main', 'main-light', 'primary', 'text'].map(key => <i key={key} style={{ background: item.uiThemeConfig[key] }} />)}
              </button>
              <div className='sp-theme-card-title'><strong>{title}</strong><Tag>{item.mode || 'custom'}</Tag></div>
              {description ? <p>{description}</p> : null}
              <div className='sp-theme-card-actions'>
                <Button type={previewing ? 'primary' : 'default'} onClick={() => onPreview(item.id)}>{e('preview')}</Button>
                <Button type={active ? 'default' : 'primary'} onClick={() => onApply(item.id)}>{e('apply')}</Button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Add the isolated preview panel**

Create `src/client/components/theme/theme-preview.jsx`:

```jsx
import { deriveSecondaryThemeTokens } from '../../common/ui-theme-tokens'
import { shellPilotTerminalBackground } from '../../common/shellpilot-theme-constraints'

const e = window.translate

export default function ThemePreview ({ theme }) {
  if (!theme) return null
  const tokens = deriveSecondaryThemeTokens(theme.uiThemeConfig)
  const style = Object.entries(tokens).reduce((result, [key, value]) => {
    const cssKey = key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)
    result[`--sp-${cssKey}`] = value
    return result
  }, {})
  return (
    <aside className='sp-theme-preview-scope' style={style}>
      <h3>{e('themePreview')}</h3>
      <div className='sp-card sp-theme-preview-card'>
        <strong>{e('generalSettings')}</strong>
        <div className='sp-theme-preview-field'><span>{e('language')}</span><i /></div>
        <div className='sp-theme-preview-field'><span>{e('updateChannel')}</span><i /></div>
      </div>
      <div className='sp-theme-preview-terminal' style={{ background: shellPilotTerminalBackground }}>
        <strong>{e('terminalBackgroundLocked')}</strong>
        <code>root@server:~# systemctl status nginx</code>
      </div>
    </aside>
  )
}
```

- [ ] **Step 5: Hold preview ID locally and persist only on apply**

Replace `src/client/components/setting-panel/tab-themes.jsx` with a component that retains the existing editor but uses local preview state:

```jsx
import { useMemo, useState } from 'react'
import SettingCol from './col'
import TerminalThemeForm from '../theme/theme-form'
import ThemeGallery from '../theme/theme-gallery'
import ThemePreview from '../theme/theme-preview'
import { settingMap } from '../../common/constants'
import './setting-wrap.styl'

export default function TabThemes ({ settingTab, settingItem, formProps, store }) {
  const [previewThemeId, setPreviewThemeId] = useState('')
  const themes = store.getTerminalThemes()
  const previewTheme = useMemo(() => themes.find(theme => theme.id === previewThemeId) || themes.find(theme => theme.id === store.config.theme), [themes, previewThemeId, store.config.theme])
  if (settingTab !== settingMap.terminalThemes) return null
  const applyTheme = themeId => {
    store.setTheme(themeId)
    setPreviewThemeId('')
  }
  const selectForEdit = item => store.setSettingItem(item)
  return (
    <div className='setting-tabs-terminal-themes sp-theme-center'>
      <SettingCol>
        <ThemeGallery
          themes={themes}
          currentThemeId={store.config.theme}
          previewThemeId={previewThemeId}
          onPreview={setPreviewThemeId}
          onApply={applyTheme}
          onSelectForEdit={selectForEdit}
        />
        <div className='sp-theme-editor-column'>
          <ThemePreview theme={previewTheme} />
          <TerminalThemeForm {...formProps} key={settingItem.id} />
        </div>
      </SettingCol>
    </div>
  )
}
```

- [ ] **Step 6: Add responsive gallery styles**

Create `src/client/components/theme/theme-gallery.styl` and import it from `theme-gallery.jsx`:

```stylus
.sp-theme-card-grid
  display grid
  grid-template-columns repeat(2, minmax(0, 1fr))
  gap 12px

.sp-theme-card
  min-width 0
  padding 12px
  background var(--sp-surface)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-card)
  &.active
    border-color var(--sp-primary)

.sp-theme-palette
  width 100%
  height 52px
  display grid
  grid-template-columns 1.6fr 1fr 1fr 1fr
  padding 0
  overflow hidden
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-control)

.sp-theme-card-title
.sp-theme-card-actions
  display flex
  align-items center
  gap 8px
  min-width 0

.sp-theme-card-title strong
  overflow-wrap break-word

@media (max-width: 680px)
  .sp-theme-card-grid
    grid-template-columns 1fr
```

Delete the store-writing preview logic and `window.originalTheme` use from `theme-list-item.jsx`; the legacy component may remain for compatibility until all callers move to `ThemeGallery`.

Remove `useState`, `EyeOutlined`, `CheckCircleOutlined`, `Tooltip`, `Button`, and `Space` from `theme-list-item.jsx` when their preview/apply code is deleted. Keep `SunOutlined`, `MoonOutlined`, `Tag`, item selection, deletion, and title highlighting.

- [ ] **Step 7: Run preview tests and lint**

```powershell
node --test test/unit-ci/theme-preview.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js
npx.cmd standard src/client/components/theme/theme-gallery.jsx src/client/components/theme/theme-preview.jsx src/client/components/setting-panel/tab-themes.jsx src/client/components/theme/theme-list-item.jsx test/unit-ci/theme-preview.spec.js
```

Expected: tests PASS and StandardJS exits 0.

- [ ] **Step 8: Commit the theme center**

```powershell
git add src/client/components/theme/theme-gallery.jsx src/client/components/theme/theme-preview.jsx src/client/components/theme/theme-gallery.styl src/client/components/setting-panel/tab-themes.jsx src/client/components/theme/theme-list-item.jsx test/unit-ci/theme-preview.spec.js
git commit -m "feat: add scoped ShellPilot theme preview"
```

---

### Task 8: Localize and lock the advanced theme editor

**Files:**
- Create: `apps/electerm-agent/src/client/common/theme-field-labels.js`
- Create: `apps/electerm-agent/test/unit-ci/theme-field-labels.spec.js`
- Modify: `apps/electerm-agent/src/client/components/theme/theme-editor.jsx`
- Modify: `apps/electerm-agent/src/client/components/theme/theme-edit-slot.jsx`
- Modify: `apps/electerm-agent/src/client/components/theme/theme-form.jsx`

- [ ] **Step 1: Write failing bilingual label tests**

Create `test/unit-ci/theme-field-labels.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/theme-field-labels.js'
)).href

test('describes advanced theme fields in Chinese and English', async () => {
  const { getThemeFieldLabel } = await import(moduleUrl)
  assert.equal(getThemeFieldLabel('primary', 'zh_cn'), '主色 / Primary (primary)')
  assert.equal(getThemeFieldLabel('primary', 'en_us'), 'Primary (primary)')
  assert.equal(getThemeFieldLabel('terminal:background', 'zh_cn'), '终端背景 / Terminal Background (terminal:background)')
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test test/unit-ci/theme-field-labels.spec.js
```

Expected: FAIL because `theme-field-labels.js` does not exist.

- [ ] **Step 3: Add stable labels for every editable field**

Create `src/client/common/theme-field-labels.js`:

```js
const labels = {
  main: ['页面背景', 'Page Background'],
  'main-dark': ['深色表面', 'Dark Surface'],
  'main-light': ['浅色表面', 'Light Surface'],
  text: ['主要文字', 'Primary Text'],
  'text-light': ['浅色文字', 'Light Text'],
  'text-dark': ['次要文字', 'Secondary Text'],
  'text-disabled': ['禁用文字', 'Disabled Text'],
  primary: ['主色', 'Primary'],
  info: ['信息色', 'Info'],
  success: ['成功色', 'Success'],
  error: ['错误色', 'Error'],
  warn: ['警告色', 'Warning'],
  'terminal:foreground': ['终端文字', 'Terminal Foreground'],
  'terminal:background': ['终端背景', 'Terminal Background'],
  'terminal:cursor': ['终端光标', 'Terminal Cursor'],
  'terminal:cursorAccent': ['光标反色', 'Cursor Accent'],
  'terminal:selectionBackground': ['终端选区', 'Terminal Selection']
}

const ansiNames = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
for (const name of ansiNames) {
  const title = name.charAt(0).toUpperCase() + name.slice(1)
  labels[`terminal:${name}`] = [`终端 ANSI ${title}`, `Terminal ANSI ${title}`]
  labels[`terminal:bright${title}`] = [`终端 ANSI Bright ${title}`, `Terminal ANSI Bright ${title}`]
}

export function getThemeFieldLabel (key, langId = 'zh_cn') {
  const [zh, en] = labels[key] || [key, key]
  return langId === 'zh_cn' ? `${zh} / ${en} (${key})` : `${en} (${key})`
}
```

- [ ] **Step 4: Show localized labels and disable the locked background control**

In `theme-editor.jsx`, pass label and locked state:

```jsx
import { getThemeFieldLabel } from '../../common/theme-field-labels'

<ThemeEditSlot
  key={k}
  name={k}
  label={getThemeFieldLabel(k, window.store?.previewLanguage || window.store?.config.language)}
  value={obj[k]}
  disabled={disabled || k === 'terminal:background'}
  locked={k === 'terminal:background'}
  onChange={onChange}
/>
```

In `theme-edit-slot.jsx`, render `props.label` as the visible label and add this locked hint:

```jsx
{props.locked ? <span className='sp-theme-field-lock'>{window.translate('terminalBackgroundLocked')}</span> : null}
```

In `theme-form.jsx`, retain the `normalizeTerminalThemeConfig` save boundary introduced in Task 1 and replace the English validation strings with translation keys resolved through `e`.

Replace the English validation strings with translation keys resolved through `e`, including `themeMaxChars`, `themeConfigRequired`, `themeMissingProperty`, `themeInvalidColor`, and `themeUnsupportedProperty`.

- [ ] **Step 5: Run editor tests and lint**

```powershell
node --test test/unit-ci/theme-field-labels.spec.js test/unit-ci/shellpilot-theme-constraints.spec.js
npx.cmd standard src/client/common/theme-field-labels.js src/client/components/theme/theme-editor.jsx src/client/components/theme/theme-edit-slot.jsx src/client/components/theme/theme-form.jsx test/unit-ci/theme-field-labels.spec.js
```

Expected: tests PASS and StandardJS exits 0.

- [ ] **Step 6: Commit advanced editor improvements**

```powershell
git add src/client/common/theme-field-labels.js src/client/components/theme/theme-editor.jsx src/client/components/theme/theme-edit-slot.jsx src/client/components/theme/theme-form.jsx test/unit-ci/theme-field-labels.spec.js
git commit -m "feat: localize advanced theme editing"
```

---

### Task 9: Apply the configuration-card system without changing callbacks

**Files:**
- Modify: `apps/electerm-agent/src/client/components/bookmark-form/form-renderer.jsx`
- Modify: `apps/electerm-agent/src/client/components/bookmark-form/bookmark-form.styl`
- Modify: `apps/electerm-agent/src/client/components/bookmark-form/common/submit-buttons.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-sync/setting-sync.jsx`
- Modify: `apps/electerm-agent/src/client/components/setting-sync/setting-sync-form.jsx`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting.styl`
- Create: `apps/electerm-agent/test/unit-ci/secondary-config-ui.spec.js`

- [ ] **Step 1: Write failing source-contract tests for preserved actions and new wrappers**

Create `test/unit-ci/secondary-config-ui.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function read (file) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', file), 'utf8')
}

test('bookmark form keeps all actions inside the new configuration shell', () => {
  const renderer = read('components/bookmark-form/form-renderer.jsx')
  const buttons = read('components/bookmark-form/common/submit-buttons.jsx')
  assert.match(renderer, /sp-configuration-form/)
  assert.match(renderer, /sp-configuration-tabs/)
  assert.match(buttons, /sp-configuration-actions/)
  for (const action of ['onSave', 'onSaveAndCreateNew', 'onConnect', 'onTestConnection']) {
    assert.match(buttons, new RegExp(action))
  }
})

test('AI and sync forms use scoped secondary UI classes', () => {
  assert.match(read('components/ai/ai-config.jsx'), /sp-ai-config-form/)
  assert.match(read('components/setting-sync/setting-sync.jsx'), /sp-sync-config/)
  assert.match(read('components/setting-sync/setting-sync-form.jsx'), /sp-sync-config-form/)
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test test/unit-ci/secondary-config-ui.spec.js
```

Expected: FAIL because the scoped classes have not been added.

- [ ] **Step 3: Add scoped form and tab classes while preserving the form state machine**

In `form-renderer.jsx`, keep `handleSubmit`, `save`, `saveAndCreateNew`, `testConnection`, `connect`, and `handleFinish` unchanged. Change only presentation wrappers:

```jsx
const renderFields = fields => (
  <div className='sp-card sp-configuration-section'>
    {fields.map((field, index) => renderFormItem(field, config.layout, form, ctxProps, index))}
  </div>
)

if (tabs.length <= 1) {
  content = renderFields(tabs.length === 1 ? (tabs[0].fields || []) : (config.fields || []))
} else {
  const items = tabs.map(tab => ({
    key: tab.key,
    label: tab.label,
    forceRender: true,
    children: renderFields(tab.fields || [])
  }))
  content = <Tabs className='sp-configuration-tabs' tabPosition='left' items={items} />
}

return (
  <Form
    className='sp-configuration-form'
    form={form}
    onFinish={handleFinish}
    initialValues={initialValues}
    name={formName}
  >
    {content}
    <SubmitButtons
      onSave={save}
      onSaveAndCreateNew={saveAndCreateNew}
      onConnect={connect}
      onTestConnection={testConnection}
    />
  </Form>
)
```

Add `className='sp-configuration-actions'` to the outer `FormItem` in `common/submit-buttons.jsx`; do not change button handlers, order, or titles.

- [ ] **Step 4: Add scoped classes to AI and sync forms**

Add `className='sp-ai-config-form'` to the outer AI `<Form>` in `ai-config.jsx`.

Wrap the existing sync tabs and data selector in `setting-sync.jsx`:

```jsx
<div className='sp-sync-config'>
  <Tabs {...tabsProps} />
  <DataSelect {...dataSelectProps} />
</div>
```

Add `className='sp-sync-config-form'` to the existing `<Form>` in `setting-sync-form.jsx`. Do not change upload, download, test, save, or encryption handlers.

- [ ] **Step 5: Add sticky actions and responsive form rules**

Append to `bookmark-form.styl`:

```stylus
.sp-configuration-form
  min-width 0
  padding-bottom 72px

.sp-configuration-section
  min-width 0
  padding 16px

.sp-configuration-tabs
  .ant-tabs-content-holder
    min-width 0

.sp-configuration-actions
  position sticky
  bottom 0
  z-index 5
  margin 0
  padding 10px 16px
  background var(--sp-surface)
  border-top 1px solid var(--sp-border)
  .ant-form-item-control-input-content
    display flex
    flex-wrap wrap
    gap 8px

@media (max-width: 760px)
  .sp-configuration-tabs
    display block
    .ant-tabs-nav
      width 100%
      overflow-x auto
    .ant-tabs-nav-list
      flex-direction row
    .ant-tabs-tab
      white-space nowrap
  .sp-configuration-section .ant-form-item
    display block
```

Add the following scoped rules to both `ai.styl` and `setting.styl` (each file keeps only the selector it owns):

```stylus
.sp-ai-config-form
.sp-sync-config-form
  min-width 0

  .ant-form-item
  .ant-form-item-control
  .ant-form-item-control-input
    min-width 0

  .ant-form-item-label
    white-space normal
    overflow-wrap break-word

  input
  textarea
    min-width 0

  .sp-long-value
    overflow-wrap anywhere
```

Use `.sp-ai-config-form` in `ai.styl` and `.sp-sync-config-form` in `setting.styl`; do not emit both selectors into both bundles.

- [ ] **Step 6: Run configuration tests and existing feature matrices**

```powershell
node --test test/unit-ci/secondary-config-ui.spec.js test/unit-ci/ai-model-api-config-matrix.spec.js test/unit-ci/ai-config-required.spec.js test/unit-ci/ai-config-presets.spec.js test/unit-ci/bookmark-management-matrix.spec.js
```

Expected: all tests PASS.

- [ ] **Step 7: Run lint and commit**

```powershell
npx.cmd standard src/client/components/bookmark-form/form-renderer.jsx src/client/components/bookmark-form/common/submit-buttons.jsx src/client/components/ai/ai-config.jsx src/client/components/setting-sync/setting-sync.jsx src/client/components/setting-sync/setting-sync-form.jsx test/unit-ci/secondary-config-ui.spec.js
git add src/client/components/bookmark-form/form-renderer.jsx src/client/components/bookmark-form/bookmark-form.styl src/client/components/bookmark-form/common/submit-buttons.jsx src/client/components/ai/ai-config.jsx src/client/components/ai/ai.styl src/client/components/setting-sync/setting-sync.jsx src/client/components/setting-sync/setting-sync-form.jsx src/client/components/setting-panel/setting.styl test/unit-ci/secondary-config-ui.spec.js
git commit -m "feat: modernize secondary configuration forms"
```

Expected: StandardJS exits 0 and the commit succeeds.

---

### Task 10: Unify application context menus while preserving action keys

**Files:**
- Create: `apps/electerm-agent/src/client/components/common/context-menu.styl`
- Modify: `apps/electerm-agent/src/client/css/basic.styl`
- Modify: `apps/electerm-agent/src/client/components/tree-list/bookmark-context-menu.js`
- Modify: `apps/electerm-agent/src/client/components/tree-list/tree-list-row.jsx`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal-context-menu.js`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal.jsx`
- Modify: `apps/electerm-agent/src/client/components/sftp/file-item.jsx`
- Modify: `apps/electerm-agent/src/client/components/sftp/list-table-ui.jsx`
- Modify: `apps/electerm-agent/src/client/components/sftp/file-table-header.jsx`
- Modify: `apps/electerm-agent/src/client/components/tabs/tab.jsx`
- Modify: `apps/electerm-agent/src/client/components/sidebar/transfer-list.jsx`
- Modify: `apps/electerm-agent/src/client/components/common/input-context-menu.jsx`
- Modify: `apps/electerm-agent/src/client/components/sys-menu/sys-menu.styl`
- Modify: `apps/electerm-agent/test/unit-ci/bookmark-context-menu.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/terminal-context-menu.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-context-menu.spec.js`

- [ ] **Step 1: Extend tests to require groups without changing action-key order**

In bookmark and terminal context-menu tests, derive action keys with:

```js
const actionKeys = items.filter(item => item.type !== 'divider').map(item => item.key)
```

Keep the current expected key arrays unchanged. Add assertions:

```js
assert.equal(items.some(item => item.type === 'divider'), true)
assert.equal(items.find(item => item.key === 'delete').danger, true)
```

For terminal items, assert `onDisconnect` carries `danger: true` and selection, reconnect, search, save-log, and recording action keys remain present.

Append this source-contract test to `sftp-context-menu.spec.js`:

```js
test('application context menus use the shared adaptive overlay class', () => {
  const files = [
    'components/tree-list/tree-list-row.jsx',
    'components/terminal/terminal.jsx',
    'components/sftp/file-item.jsx',
    'components/tabs/tab.jsx',
    'components/common/input-context-menu.jsx'
  ]
  for (const file of files) {
    const source = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/client', file), 'utf8')
    assert.match(source, /shellpilot-context-menu/)
  }
})
```

- [ ] **Step 2: Run context-menu tests and verify they fail**

```powershell
node --test test/unit-ci/bookmark-context-menu.spec.js test/unit-ci/terminal-context-menu.spec.js test/unit-ci/sftp-context-menu.spec.js
```

Expected: FAIL because groups, danger metadata, and the shared overlay class are missing.

- [ ] **Step 3: Add semantic dividers without altering action keys**

In `bookmark-context-menu.js`, return the same action items with divider records inserted before editing/info and before delete. Mark delete as dangerous:

```js
{ type: 'divider' },
{ key: 'delete', label: label('删除连接'), danger: true }
```

In `terminal-context-menu.js`, insert dividers after selection actions, after AI/path actions, and before connection actions. Mark disconnect as dangerous:

```js
function item ({ key, labelKey, labelText, iconKey, disabled, extra, danger = false }) {
  return { key, labelKey, labelText, iconKey, disabled: Boolean(disabled), extra, danger }
}

item({
  key: 'onDisconnect',
  iconKey: 'CloseCircleOutlined',
  labelKey: 'disconnect',
  danger: true
})
```

- [ ] **Step 4: Apply a shared Ant Design overlay class**

For every Ant Design `Dropdown` in the listed React files, add:

```jsx
overlayClassName='shellpilot-context-menu'
```

Where a file builds a props object, add:

```js
overlayClassName: 'shellpilot-context-menu'
```

Do not change `trigger`, `items`, `onClick`, `onOpenChange`, or action dispatch code.

- [ ] **Step 5: Add adaptive global menu styles**

Create `src/client/components/common/context-menu.styl`:

```stylus
.shellpilot-context-menu
  .ant-dropdown-menu
    min-width 220px
    width max-content
    max-width min(360px, calc(100vw - 16px))
    max-height calc(100vh - 16px)
    overflow-y auto
    padding 6px
    background var(--sp-surface-elevated)
    border 1px solid var(--sp-border)
    border-radius var(--sp-radius-overlay)
    box-shadow var(--sp-shadow-overlay)
  .ant-dropdown-menu-item
  .ant-dropdown-menu-submenu-title
    min-height 31px
    display grid
    grid-template-columns auto minmax(0, 1fr) auto
    gap 8px
    align-items center
    border-radius var(--sp-radius-control)
    white-space normal
    overflow-wrap break-word
  .ant-dropdown-menu-item-danger
    color var(--sp-danger)
  .ant-dropdown-menu-item-disabled
    color var(--sp-text-disabled)
  .ant-dropdown-menu-item-divider
    background var(--sp-border)
```

Import it from `src/client/css/basic.styl`:

```stylus
@require '../components/common/context-menu'
```

Update `sys-menu.styl` to replace fixed `width 280px`, hard-coded `#08c`, and ellipsis-only submenu rows with semantic variables, `min-width`, `max-width`, and `overflow-wrap break-word`.

- [ ] **Step 6: Run context-menu tests and lint**

```powershell
node --test test/unit-ci/bookmark-context-menu.spec.js test/unit-ci/terminal-context-menu.spec.js test/unit-ci/sftp-context-menu.spec.js
npx.cmd standard src/client/components/tree-list/bookmark-context-menu.js src/client/components/tree-list/tree-list-row.jsx src/client/components/terminal/terminal-context-menu.js src/client/components/terminal/terminal.jsx src/client/components/sftp/file-item.jsx src/client/components/sftp/list-table-ui.jsx src/client/components/sftp/file-table-header.jsx src/client/components/tabs/tab.jsx src/client/components/sidebar/transfer-list.jsx src/client/components/common/input-context-menu.jsx test/unit-ci/bookmark-context-menu.spec.js test/unit-ci/terminal-context-menu.spec.js test/unit-ci/sftp-context-menu.spec.js
```

Expected: tests PASS and StandardJS exits 0.

- [ ] **Step 7: Commit context-menu styling**

```powershell
git add src/client/components/common/context-menu.styl src/client/css/basic.styl src/client/components/tree-list/bookmark-context-menu.js src/client/components/tree-list/tree-list-row.jsx src/client/components/terminal/terminal-context-menu.js src/client/components/terminal/terminal.jsx src/client/components/sftp/file-item.jsx src/client/components/sftp/list-table-ui.jsx src/client/components/sftp/file-table-header.jsx src/client/components/tabs/tab.jsx src/client/components/sidebar/transfer-list.jsx src/client/components/common/input-context-menu.jsx src/client/components/sys-menu/sys-menu.styl test/unit-ci/bookmark-context-menu.spec.js test/unit-ci/terminal-context-menu.spec.js test/unit-ci/sftp-context-menu.spec.js
git commit -m "feat: unify ShellPilot context menus"
```

---

### Task 11: Complete the visible bilingual copy sweep and layout contract

**Files:**
- Create: `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-modal.jsx`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-common.jsx`
- Modify: `apps/electerm-agent/src/client/components/setting-sync/setting-sync-form.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- Modify: `apps/electerm-agent/src/client/components/bookmark-form/form-renderer.jsx`
- Modify: `apps/electerm-agent/src/client/components/bookmark-form/common/submit-buttons.jsx`
- Modify: `apps/electerm-agent/src/client/components/theme/theme-form.jsx`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal-context-menu.js`
- Modify: `apps/electerm-agent/src/client/components/tree-list/bookmark-context-menu.js`
- Modify: `apps/electerm-agent/src/client/components/sftp/context-menu-utils.js`
- Modify: `apps/electerm-agent/src/client/components/common/modal.jsx`

- [ ] **Step 1: Write a failing contract test for known untranslated copy and layout safeguards**

Create `test/unit-ci/secondary-ui-contract.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function read (file) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', file), 'utf8')
}

test('secondary UI routes visible copy through translation keys', () => {
  const files = [
    'components/setting-panel/setting-modal.jsx',
    'components/setting-sync/setting-sync-form.jsx',
    'components/ai/ai-config.jsx',
    'components/bookmark-form/form-renderer.jsx',
    'components/bookmark-form/common/submit-buttons.jsx',
    'components/theme/theme-form.jsx',
    'components/common/modal.jsx'
  ]
  const forbidden = [
    /message\.success\('OK'/,
    /message\.success\('Saved'/,
    /okText = 'OK'/,
    /cancelText = 'Cancel'/,
    /message: 'theme config required'/,
    /message: 'theme name required'/
  ]
  for (const file of files) {
    const source = read(file)
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file} contains ${pattern}`)
  }
})

test('secondary UI has explicit minimum-window and zoom-safe contracts', () => {
  const wrap = read('components/setting-panel/setting-wrap.styl')
  const menu = read('components/common/context-menu.styl')
  const form = read('components/bookmark-form/bookmark-form.styl')
  assert.match(wrap, /max-width: 820px/)
  assert.match(wrap, /max-width: 680px/)
  assert.match(menu, /calc\(100vw - 16px\)/)
  assert.match(form, /flex-wrap wrap/)
})

test('main workbench layout constants are not changed by secondary UI work', () => {
  const layout = read('components/main/aigshell-layout.js')
  assert.match(layout, /aigshellTopBarHeight = 44/)
  assert.match(layout, /minRightPanelWidth = 320/)
})
```

- [ ] **Step 2: Run the contract test and verify it fails on known strings**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js
```

Expected: FAIL on current hard-coded modal defaults, validation messages, and untranslated status text.

- [ ] **Step 3: Add explicit bilingual keys for the known strings**

Extend both locale catalogs with these keys and exact meanings:

```js
const zhSecondaryCopy = {
  connectionSucceeded: '连接成功',
  connectionFailed: '连接失败',
  sshAndSftpCannotBothBeDisabled: 'SSH 和 SFTP 不能同时禁用',
  saveAndConnect: '保存并连接',
  saveAndCreateNew: '保存并新建',
  temporaryConnection: '不保存，直接连接',
  themeNameRequired: '请输入主题名称',
  themeConfigRequired: '请输入主题配置',
  themeInvalidColor: '颜色格式无效',
  themeUnsupportedProperty: '不支持的主题属性',
  more: '更多', ok: '确定', cancel: '取消'
}

const enSecondaryCopy = {
  connectionSucceeded: 'Connection succeeded',
  connectionFailed: 'Connection failed',
  sshAndSftpCannotBothBeDisabled: 'SSH and SFTP cannot both be disabled',
  saveAndConnect: 'Save and Connect',
  saveAndCreateNew: 'Save and Create Another',
  temporaryConnection: 'Connect Without Saving',
  themeNameRequired: 'Theme name is required',
  themeConfigRequired: 'Theme configuration is required',
  themeInvalidColor: 'Invalid color format',
  themeUnsupportedProperty: 'Unsupported theme property',
  more: 'More', ok: 'OK', cancel: 'Cancel'
}
```

Merge `zhSecondaryCopy` into `catalogs.zh_cn` and `enSecondaryCopy` into `catalogs.en_us` in `shellpilot-i18n-overrides.js`.

- [ ] **Step 4: Replace hard-coded visible strings in the listed components**

Use `e('key')` for JSX labels and message calls. Examples that must be applied exactly:

```js
message.success(e('connectionSucceeded'))
message.error(`${e('connectionFailed')}${msg ? `: ${msg}` : ''}`)
message.warning(e('sshAndSftpCannotBothBeDisabled'))
```

In `common/modal.jsx`, initialize defaults at call time:

```js
const okText = options.okText || window.translate('ok')
const cancelText = options.cancelText || window.translate('cancel')
```

In `context-menu-utils.js`, replace the literal default with:

```js
moreLabel = window.translate ? window.translate('more') : 'More'
```

In menu builders, replace `labelText` literals with `labelKey` entries where an upstream or ShellPilot locale key exists. Keep internal action keys unchanged.

- [ ] **Step 5: Run locale, copy, responsive, and feature tests**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/visible-chinese-copy.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js test/unit-ci/bookmark-context-menu.spec.js test/unit-ci/terminal-context-menu.spec.js test/unit-ci/sftp-context-menu.spec.js
```

Expected: all tests PASS.

- [ ] **Step 6: Run targeted lint and commit**

```powershell
npx.cmd standard src/client/common/shellpilot-i18n-overrides.js src/client/components/setting-panel/setting-modal.jsx src/client/components/setting-panel/setting-common.jsx src/client/components/setting-sync/setting-sync-form.jsx src/client/components/ai/ai-config.jsx src/client/components/bookmark-form/form-renderer.jsx src/client/components/bookmark-form/common/submit-buttons.jsx src/client/components/theme/theme-form.jsx src/client/components/terminal/terminal-context-menu.js src/client/components/tree-list/bookmark-context-menu.js src/client/components/sftp/context-menu-utils.js src/client/components/common/modal.jsx test/unit-ci/secondary-ui-contract.spec.js
git add src/client/common/shellpilot-i18n-overrides.js src/client/components/setting-panel/setting-modal.jsx src/client/components/setting-panel/setting-common.jsx src/client/components/setting-sync/setting-sync-form.jsx src/client/components/ai/ai-config.jsx src/client/components/bookmark-form/form-renderer.jsx src/client/components/bookmark-form/common/submit-buttons.jsx src/client/components/theme/theme-form.jsx src/client/components/terminal/terminal-context-menu.js src/client/components/tree-list/bookmark-context-menu.js src/client/components/sftp/context-menu-utils.js src/client/components/common/modal.jsx test/unit-ci/secondary-ui-contract.spec.js
git commit -m "feat: complete secondary UI bilingual copy"
```

Expected: StandardJS exits 0 and the commit succeeds.

---

### Task 12: Run the full verification matrix and update user documentation

**Files:**
- Modify: `apps/electerm-agent/docs/USER_GUIDE_ZH.md`
- Modify: `apps/electerm-agent/README.md`

- [ ] **Step 1: Run all focused unit tests**

```powershell
cd F:\SSH工具开发\apps\electerm-agent
node --test test/unit-ci/shellpilot-theme-constraints.spec.js test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/setting-search-index.spec.js test/unit-ci/theme-field-labels.spec.js test/unit-ci/theme-preview.spec.js test/unit-ci/secondary-config-ui.spec.js test/unit-ci/bookmark-context-menu.spec.js test/unit-ci/terminal-context-menu.spec.js test/unit-ci/sftp-context-menu.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run the complete unit-CI suite**

```powershell
npm.cmd run test-unit-ci
```

Expected: exit code 0 with no failing test files.

- [ ] **Step 3: Run lint for all production and test files changed by this plan**

```powershell
npx.cmd standard src/client/common/shellpilot-theme-constraints.js src/client/common/ui-theme-tokens.js src/client/common/shellpilot-ui-palettes.js src/client/common/shellpilot-i18n-overrides.js src/client/common/setting-search-index.js src/client/common/theme-field-labels.js src/client/common/theme-defaults.js src/client/common/terminal-theme.js src/client/entry/basic.js src/client/store/init-state.js src/client/store/terminal-theme.js src/client/components/main/ui-theme.jsx src/client/components/setting-panel/setting-header.jsx src/client/components/setting-panel/setting-section.jsx src/client/components/setting-panel/setting-modal.jsx src/client/components/setting-panel/setting-common.jsx src/client/components/setting-panel/tab-themes.jsx src/client/components/theme/theme-gallery.jsx src/client/components/theme/theme-preview.jsx src/client/components/theme/theme-list-item.jsx src/client/components/theme/theme-editor.jsx src/client/components/theme/theme-edit-slot.jsx src/client/components/theme/theme-form.jsx src/client/components/bookmark-form/form-renderer.jsx src/client/components/bookmark-form/common/submit-buttons.jsx src/client/components/ai/ai-config.jsx src/client/components/setting-sync/setting-sync.jsx src/client/components/setting-sync/setting-sync-form.jsx src/client/components/tree-list/bookmark-context-menu.js src/client/components/tree-list/tree-list-row.jsx src/client/components/terminal/terminal-context-menu.js src/client/components/terminal/terminal.jsx src/client/components/sftp/context-menu-utils.js src/client/components/sftp/file-item.jsx src/client/components/sftp/list-table-ui.jsx src/client/components/sftp/file-table-header.jsx src/client/components/tabs/tab.jsx src/client/components/sidebar/transfer-list.jsx src/client/components/common/input-context-menu.jsx src/client/components/common/modal.jsx test/unit-ci/shellpilot-theme-constraints.spec.js test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/setting-search-index.spec.js test/unit-ci/theme-field-labels.spec.js test/unit-ci/theme-preview.spec.js test/unit-ci/secondary-config-ui.spec.js test/unit-ci/bookmark-context-menu.spec.js test/unit-ci/terminal-context-menu.spec.js test/unit-ci/sftp-context-menu.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
```

Expected: StandardJS exits 0.

- [ ] **Step 4: Run relevant Playwright regression tests**

```powershell
npx.cmd playwright test test/e2e/02.2.init.setting.spec.js test/e2e/02.03.profile.spec.js test/e2e/02.04.profile-use.spec.js test/e2e/009.basic.themes.spec.js test/e2e/007.basic.bookmarks.spec.js test/e2e/008.basic.file-manager.spec.js --workers=1
```

Expected: all selected end-to-end tests PASS.

- [ ] **Step 5: Complete the visual acceptance matrix**

Start the app with the existing local development scripts and inspect these combinations:

```text
Window sizes: 590×400, 820×600, 1100×700, 1600×900
Zoom: 100%, 125%, 150%
Languages: 简体中文, English
Themes: 海湾蓝, 翡翠绿, 云境紫, 暖砂橙, 石墨夜
Surfaces: settings shell, general settings, connection form, AI config, sync config, theme center, bookmark menu, terminal menu, SFTP menu, input menu
```

For every combination, verify: important labels and primary actions never ellipsize; Chinese wraps naturally; English wraps at word boundaries; there is no text overlap, clipped primary button, or page-level horizontal scroll; keyboard focus remains visible; disabled states remain readable; dangerous actions stay at the bottom; and the terminal background equals `#0E0F12`.

- [ ] **Step 6: Update documentation with exact user-visible behavior**

Add a “界面主题与语言” section to `docs/USER_GUIDE_ZH.md` containing:

```markdown
## 界面主题与语言

设置中心提供海湾蓝、翡翠绿、云境紫、暖砂橙和石墨夜五套内置界面主题，并保留自定义主题的导入、导出和高级编辑能力。主题预览不会立即保存，点击“应用”后才会替换当前主题。

无论选择哪套界面主题，终端标签区、终端画布和终端空白区域始终保持近黑色；终端文字、光标、选区和 ANSI 颜色仍可在高级编辑器中调整。

ShellPilot 完整支持简体中文和 English。语言选择可先在设置中心预览，确认应用后保存。
```

Add a matching English “UI themes and languages” section to `README.md` with the same facts and no release claims.

- [ ] **Step 7: Verify the final diff and commit documentation**

```powershell
git diff --check
git status --short
git add docs/USER_GUIDE_ZH.md README.md
git commit -m "docs: document ShellPilot UI themes"
```

Expected: `git diff --check` reports no whitespace errors; only intended files are staged; the documentation commit succeeds.

- [ ] **Step 8: Record final evidence before claiming completion**

Run:

```powershell
git status --short
git log --oneline -12
```

Expected: no uncommitted product changes remain. Local `.superpowers/` visual brainstorming artifacts may remain untracked and must not be added to product commits.
