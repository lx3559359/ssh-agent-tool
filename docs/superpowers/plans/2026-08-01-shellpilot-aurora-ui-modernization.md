# ShellPilot Aurora UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Aurora Pop Workbench visual language to every current ShellPilot page and panel while preserving all functionality, routes, data, state, ordering, labels, keyboard behavior, and terminal/SFTP/AI/operations semantics.

**Architecture:** Extend the existing semantic UI token adapter and five built-in ShellPilot palettes, then restyle the current DOM through existing Stylus selectors. Keep the current React tree and all event handlers untouched. Reuse the existing depth classes, responsive geometry, accessibility contracts, and Playwright coverage; add style-contract assertions and visual proof for the eleven approved surfaces.

**Tech Stack:** Electron 41, React 19, Ant Design 6, Stylus 0.64, Manate, Node.js test runner, StandardJS, Playwright.

**Approved design:** `docs/superpowers/specs/2026-08-01-shellpilot-aurora-ui-modernization-design.md`

**Execution directory:** Run Tasks 1–9 from `F:\SSH工具开发\apps\electerm-agent`. Paths beginning with `src/` or `test/` are relative to that directory. Run repository-level Git and screenshot checks from `F:\SSH工具开发` where explicitly stated.

**Non-negotiable UI-only guard:** Production changes are limited to `src/client/common/ui-theme-tokens.js`, `src/client/common/shellpilot-ui-palettes.js`, and the Stylus files named in this plan. Do not modify React/JSX components, Store methods, state models, translations, visible copy, routes, menu definitions, IPC, persistence, SSH, terminal input, SFTP operations, AI behavior, safety checks, task execution, rollback, updates, or release logic. If an existing selector cannot express a visual treatment, leave that treatment out and record it in the verification notes; do not add a wrapper or alter a component tree without a new user decision.

---

## File structure and responsibility map

Theme foundation:

- `apps/electerm-agent/src/client/common/ui-theme-tokens.js`: compatibility-safe semantic color, radius, highlight, motion, and depth tokens.
- `apps/electerm-agent/src/client/common/shellpilot-ui-palettes.js`: existing palette IDs, names, order, persistence shape, and Aurora light/dark values for Cloud Indigo and Graphite Night.
- `apps/electerm-agent/src/client/css/includes/secondary-ui.styl`: shared L0-L3 surfaces, scoped Ant Design controls, focus states, reduced motion, and compatibility aliases.

Global shell and shared panels:

- `apps/electerm-agent/src/client/components/main/aigshell-topbar.styl`: top bar spacing, icon containers, selection, and depth.
- `apps/electerm-agent/src/client/components/sidebar/sidebar.styl`: left rail, active entry, bookmarks/history side-panel shell.
- `apps/electerm-agent/src/client/components/tree-list/tree-list.styl`: server tree rows, groups, selection, and action affordances.
- `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel.styl`: AI side-panel shell and header.
- `apps/electerm-agent/src/client/components/ai/ai.styl`: AI bubbles, tool cards, attachments, and composer.
- `apps/electerm-agent/src/client/components/common/modal.styl`: existing custom modal surface and controls.

Primary workspaces:

- `apps/electerm-agent/src/client/components/tabs/no-session.styl`: connection workbench.
- `apps/electerm-agent/src/client/components/fleet-status/fleet-status.styl`: fleet status workspace.
- `apps/electerm-agent/src/client/components/fleet-status/fleet-service-selector.styl`: existing service drawer, toolbar, and flat results table.
- `apps/electerm-agent/src/client/components/artifacts/artifacts.styl`: AI artifacts workspace.
- `apps/electerm-agent/src/client/components/terminal/terminal.styl`: terminal workspace frame only; xterm rendering remains protected.
- `apps/electerm-agent/src/client/components/tabs/tabs.styl`: existing terminal tabs.
- `apps/electerm-agent/src/client/components/footer/footer.styl`: existing terminal status/footer bar.
- `apps/electerm-agent/src/client/components/sftp/sftp.styl`: local/remote file panels and flat file rows.
- `apps/electerm-agent/src/client/components/sidebar/transfer.styl`: transfer queue/history surface.
- `apps/electerm-agent/src/client/components/operations-toolkit/workspace/operations-workspace.styl`: operations toolkit workspace.

Settings and informational surfaces:

- `apps/electerm-agent/src/client/components/setting-panel/setting-wrap.styl`: settings shell, header, category rail, and tabs.
- `apps/electerm-agent/src/client/components/setting-panel/setting.styl`: setting groups, fields, password manager, and shared forms.
- `apps/electerm-agent/src/client/components/setting-panel/list.styl`: setting list selection and actions.
- `apps/electerm-agent/src/client/components/sidebar/info.styl`: current logs/about modal content presentation.

Tests and evidence:

- `apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js`: exact token contract and contrast.
- `apps/electerm-agent/test/unit-ci/shellpilot-ui-palettes.spec.js`: palette identity, exact Aurora values, and readability.
- `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`: shared depth, shell, protected terminal, focus, and no-layout-shift contracts.
- `apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js`: page-by-page style ownership and Stylus compilation.
- Existing focused unit and Playwright tests remain the behavior regression authority; no test should weaken an interaction assertion to make visual changes pass.
- `release-verification/aurora-ui-2026-08-01/`: generated, uncommitted implementation screenshots for the eleven approved surfaces.

No production JSX file is part of this plan.

---

### Task 1: Extend the existing semantic token and palette contract

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-ui-palettes.spec.js`
- Modify: `apps/electerm-agent/src/client/common/ui-theme-tokens.js`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-ui-palettes.js`

- [ ] **Step 1: Write failing token tests for the approved Aurora contract**

In `test/unit-ci/ui-theme-tokens.spec.js`, replace `tokenKeys` with this ordered compatibility contract and teach `toCssVariable` the one numeric alias:

```js
const tokenKeys = [
  'page',
  'canvas',
  'surface',
  'surfaceSubtle',
  'surfaceSoft',
  'surfaceInset',
  'surfaceElevated',
  'highlightTop',
  'highlight',
  'text',
  'textMuted',
  'textDisabled',
  'border',
  'borderStrong',
  'primary',
  'primaryAlt',
  'primarySoft',
  'cyan',
  'success',
  'info',
  'warning',
  'danger',
  'radiusSmall',
  'radiusControl',
  'radiusToolbar',
  'radiusCard',
  'radiusPanel',
  'radiusOverlay',
  'shadowSm',
  'shadowMd',
  'shadowLg',
  'shadowFocus',
  'shadowControl',
  'shadowCard',
  'shadowOverlay',
  'motionFast',
  'motionNormal'
]

function toCssVariable (key) {
  if (key === 'primaryAlt') return '--sp-primary-2'
  const cssKey = key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)
  return `--sp-${cssKey}`
}
```

Extend `colorTokenKeys` with `canvas`, `surfaceSoft`, `primaryAlt`, and `cyan`. Replace the existing restrained-depth assertion with exact light/dark checks:

```js
test('derives Aurora light and dark depth without changing compatibility aliases', async () => {
  const { deriveSecondaryThemeTokens } = await import(moduleUrl)
  const light = deriveSecondaryThemeTokens({
    main: '#F6F7FF',
    'main-light': '#FFFFFF',
    'surface-soft': '#F0F2FF',
    text: '#111B3F',
    'text-dark': '#69708E',
    primary: '#4D46F5',
    'primary-alt': '#6C63FF',
    cyan: '#149BD7',
    success: '#20B66A',
    warn: '#F2A11D',
    error: '#E5484D',
    border: '#DDE1F3'
  })
  const dark = deriveSecondaryThemeTokens({
    main: '#0B1020',
    'main-light': '#11182A',
    'surface-soft': '#171F35',
    text: '#EDF1FF',
    'text-dark': '#9CA6C4',
    primary: '#746DFF',
    'primary-alt': '#8A82FF',
    cyan: '#2CB7EB',
    success: '#32D583',
    warn: '#F7B84B',
    error: '#FF6B70',
    border: '#28334F'
  })

  assert.deepEqual(
    [light.canvas, light.surface, light.surfaceSoft, light.text, light.textMuted, light.primary, light.primaryAlt, light.cyan, light.success, light.warning, light.danger, light.border],
    ['#F6F7FF', '#FFFFFF', '#F0F2FF', '#111B3F', '#69708E', '#4D46F5', '#6C63FF', '#149BD7', '#20B66A', '#F2A11D', '#E5484D', '#DDE1F3']
  )
  assert.deepEqual(
    [dark.canvas, dark.surface, dark.surfaceSoft, dark.text, dark.textMuted, dark.primary, dark.primaryAlt, dark.cyan, dark.success, dark.warning, dark.danger, dark.border],
    ['#0B1020', '#11182A', '#171F35', '#EDF1FF', '#9CA6C4', '#746DFF', '#8A82FF', '#2CB7EB', '#32D583', '#F7B84B', '#FF6B70', '#28334F']
  )
  assert.deepEqual(
    [light.radiusSmall, light.radiusControl, light.radiusToolbar, light.radiusPanel],
    ['8px', '10px', '14px', '18px']
  )
  assert.equal(light.shadowControl, light.shadowSm)
  assert.equal(light.shadowCard, light.shadowMd)
  assert.equal(light.shadowOverlay, light.shadowLg)
  assert.equal(light.highlightTop, light.highlight)
  assert.notEqual(light.shadowLg, dark.shadowLg)
})
```

Rename the serialization test so it no longer hardcodes twenty-five tokens, and assert `variables.length === tokenKeys.length` plus the exact variables `--sp-canvas`, `--sp-surface-soft`, `--sp-primary-2`, and `--sp-shadow-focus`.

- [ ] **Step 2: Write failing palette identity and exact-value tests**

In `test/unit-ci/shellpilot-ui-palettes.spec.js`, keep the existing five IDs, names, order, readonly flags, and terminal-background assertions. Update only the expected `shellpilot-indigo` and `shellpilot-graphite` UI fields to the approved values, then add:

```js
test('maps the approved Aurora light and dark palettes without changing theme identity', async () => {
  const { buildShellPilotBuiltInThemes } = await import(paletteModuleUrl)
  const themes = buildShellPilotBuiltInThemes({ foreground: '#dddddd' })
  const identity = themes.map(({ id, name, nameKey, mode }) => ({ id, name, nameKey, mode }))
  assert.deepEqual(identity, expectedPalettes.map(({ id, name, nameKey, mode }) => ({ id, name, nameKey, mode })))

  const indigo = themes.find(theme => theme.id === 'shellpilot-indigo').uiThemeConfig
  const graphite = themes.find(theme => theme.id === 'shellpilot-graphite').uiThemeConfig
  assert.deepEqual(indigo, {
    main: '#F6F7FF',
    'main-light': '#FFFFFF',
    'main-dark': '#DDE1F3',
    'surface-soft': '#F0F2FF',
    text: '#111B3F',
    'text-light': '#111B3F',
    'text-dark': '#69708E',
    'text-disabled': '#858CA8',
    primary: '#4D46F5',
    'primary-alt': '#6C63FF',
    cyan: '#149BD7',
    border: '#DDE1F3',
    info: '#149BD7',
    success: '#20B66A',
    error: '#E5484D',
    warn: '#F2A11D'
  })
  assert.deepEqual(graphite, {
    main: '#0B1020',
    'main-light': '#11182A',
    'main-dark': '#070B16',
    'surface-soft': '#171F35',
    text: '#EDF1FF',
    'text-light': '#EDF1FF',
    'text-dark': '#9CA6C4',
    'text-disabled': '#727E9E',
    primary: '#746DFF',
    'primary-alt': '#8A82FF',
    cyan: '#2CB7EB',
    border: '#28334F',
    info: '#2CB7EB',
    success: '#32D583',
    error: '#FF6B70',
    warn: '#F7B84B'
  })
})
```

- [ ] **Step 3: Run the focused tests and verify the expected failures**

Run:

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js
```

Expected: FAIL because the new aliases, radii, shadows, and exact Aurora palette fields are not yet returned.

- [ ] **Step 4: Implement the token aliases and approved depth values**

In `src/client/common/ui-theme-tokens.js`, derive optional palette fields before the return object:

```js
const surfaceSoft = expandHex(theme['surface-soft'], mix(surface, page, 0.55))
const primaryAlt = expandHex(
  theme['primary-alt'],
  mix(primary, '#FFFFFF', darkSurface ? 0.18 : 0.12)
)
const cyan = expandHex(theme.cyan, darkSurface ? '#2CB7EB' : '#149BD7')
const border = expandHex(theme.border, mix(text, surface, 0.84))
const highlight = darkSurface
  ? 'rgba(255, 255, 255, 0.08)'
  : 'rgba(255, 255, 255, 0.82)'
const shadowSm = darkSurface
  ? '0 4px 10px rgba(0, 0, 0, 0.24), 0 0 0 1px rgba(116, 109, 255, 0.10)'
  : '0 4px 10px rgba(62, 58, 160, 0.10)'
const shadowMd = darkSurface
  ? '0 10px 24px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(116, 109, 255, 0.12)'
  : '0 10px 24px rgba(73, 66, 196, 0.16)'
const shadowLg = darkSurface
  ? '0 18px 42px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(116, 109, 255, 0.14)'
  : '0 18px 42px rgba(75, 66, 202, 0.22)'
const shadowFocus = darkSurface
  ? '0 8px 18px rgba(116, 109, 255, 0.30)'
  : '0 8px 18px rgba(77, 70, 245, 0.28)'
```

Return the new fields in `tokenKeys` order. Keep compatibility fields as aliases:

```js
page,
canvas: page,
surface,
surfaceSubtle: surfaceSoft,
surfaceSoft,
surfaceInset,
surfaceElevated,
highlightTop: highlight,
highlight,
text,
textMuted,
textDisabled,
border,
borderStrong: mix(text, surface, 0.72),
primary,
primaryAlt,
primarySoft: mix(primary, surface, 0.88),
cyan,
success: expandHex(theme.success, '#168A74'),
info: expandHex(theme.info, cyan),
warning: expandHex(theme.warn, '#C56A20'),
danger,
radiusSmall: '8px',
radiusControl: '10px',
radiusToolbar: '14px',
radiusCard: '18px',
radiusPanel: '18px',
radiusOverlay: '18px',
shadowSm,
shadowMd,
shadowLg,
shadowFocus,
shadowControl: shadowSm,
shadowCard: shadowMd,
shadowOverlay: shadowLg,
motionFast: '120ms',
motionNormal: '180ms'
```

In `buildUiThemeCss`, map `primaryAlt` to `primary-2` before serializing:

```js
const cssKey = key === 'primaryAlt'
  ? 'primary-2'
  : key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)
```

- [ ] **Step 5: Update only the two Aurora reference palette values**

In `src/client/common/shellpilot-ui-palettes.js`, give the `indigo` and `graphite` records the exact values asserted in Step 2. Add optional fields to `uiThemeConfig` only when present:

```js
...(palette.surfaceSoft ? { 'surface-soft': palette.surfaceSoft } : {}),
...(palette.primaryAlt ? { 'primary-alt': palette.primaryAlt } : {}),
...(palette.cyan ? { cyan: palette.cyan } : {}),
...(palette.border ? { border: palette.border } : {})
```

Use `palette.mainDark || currentFallback`, palette-specific `textLight`, `textMuted`, `textDisabled`, and `{ ...currentStatusColors, ...palette.statusColors }` when supplied; preserve the current fallback values for Ocean Blue, Jade Green, and Warm Amber. Do not add, remove, rename, reorder, or auto-select a theme.

- [ ] **Step 6: Run the focused tests and lint**

Run:

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js
npx standard src/client/common/ui-theme-tokens.js src/client/common/shellpilot-ui-palettes.js test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js
```

Expected: PASS. The terminal decoupling test must still report `#0E0F12` for ShellPilot terminal backgrounds.

- [ ] **Step 7: Commit the theme foundation**

```powershell
git add src/client/common/ui-theme-tokens.js src/client/common/shellpilot-ui-palettes.js test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js
git commit -m "style: add Aurora semantic UI tokens"
```

---

### Task 2: Upgrade shared elevation primitives and application chrome

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`
- Modify: `apps/electerm-agent/src/client/css/includes/secondary-ui.styl`
- Modify: `apps/electerm-agent/src/client/components/main/aigshell-topbar.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/sidebar.styl`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel.styl`
- Modify: `apps/electerm-agent/src/client/components/footer/footer.styl`
- Modify: `apps/electerm-agent/src/client/components/common/modal.styl`

- [ ] **Step 1: Change the shell contract tests before the styles**

In `test/unit-ci/secondary-ui-contract.spec.js`, update the compiled-rule expectations to the approved aliases:

```js
assertCssRule(topbarBlocks, '.aigshell-topbar', {
  background: 'var(--sp-surface-elevated)',
  'border-bottom': '1px solid var(--sp-border)',
  'box-shadow': 'inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-md)'
})
assertCssRule(sidebarBlocks, '.sidebar .control-icon-wrap.active', {
  background: 'linear-gradient(145deg, var(--sp-primary-soft), var(--sp-surface-elevated))',
  'box-shadow': 'var(--sp-shadow-focus)'
})
assertCssRule(panelBlocks, '.right-side-panel', {
  background: 'var(--sp-surface)',
  'border-left': '1px solid var(--sp-border)',
  'box-shadow': 'var(--sp-shadow-lg)'
})
```

Update `assertUiElevationContracts` so L1 expects `--sp-shadow-sm`, L2 expects `--sp-shadow-md`, and L3 expects `--sp-shadow-lg`. Update the mutation test to swap `var(--sp-shadow-sm)` and `var(--sp-shadow-lg)`; it must still prove that the validator rejects depth tokens assigned to the wrong level.

Add a regression test that hover does not move layout:

```js
test('Aurora hover depth never translates layout boxes', () => {
  const files = [
    'css/includes/secondary-ui.styl',
    'components/main/aigshell-topbar.styl',
    'components/sidebar/sidebar.styl',
    'components/side-panel-r/right-side-panel.styl',
    'components/common/modal.styl'
  ]
  for (const file of files) {
    assert.doesNotMatch(readClient(file), /transform\s+translate[XY]?\(/, file)
  }
})
```

Keep the existing protected-terminal assertions unchanged. They must continue rejecting semantic shadows on `.xterm`, `.xterm-screen`, `.xterm-viewport`, `.terms-box`, and `.term-wrap`.

- [ ] **Step 2: Run the shell contract and verify it fails on old shadows and hover transform**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js
```

Expected: FAIL because the shell still uses compatibility shadow names and `.sp-lift-interactive` still translates on hover.

- [ ] **Step 3: Replace the shared L1-L3 declarations and interaction behavior**

In `src/client/css/includes/secondary-ui.styl`, make the depth primitives use the approved hierarchy:

```stylus
.sp-level-1
  color var(--sp-text)
  background var(--sp-surface)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-small)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-sm)

.sp-level-2,
.sp-card
  color var(--sp-text)
  background var(--sp-surface-elevated)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-card)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-md)

.sp-level-3
  color var(--sp-text)
  background var(--sp-surface-elevated)
  border 1px solid var(--sp-border-strong)
  border-radius var(--sp-radius-overlay)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-lg)

.sp-lift-interactive
  transition background-color var(--sp-motion-fast) ease, border-color var(--sp-motion-fast) ease, box-shadow var(--sp-motion-fast) ease, opacity var(--sp-motion-fast) ease
  &:hover
    box-shadow var(--sp-shadow-md)
  &:active
    box-shadow inset 0 2px 5px rgba(17, 27, 63, .16), var(--sp-shadow-sm)
```

Keep the current reduced-motion block and remove its obsolete transform declarations. Scope Ant Design input, select, button, tab, drawer, dropdown, and tooltip styling under current ShellPilot surfaces so the terminal canvas is never selected.

- [ ] **Step 4: Apply the same shell hierarchy without changing geometry**

Update only visual properties in the named Stylus files:

```stylus
.aigshell-topbar
  background var(--sp-surface-elevated)
  border-bottom 1px solid var(--sp-border)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-md)

.sidebar
  background var(--sp-surface)
  border-right 1px solid var(--sp-border)
  box-shadow var(--sp-shadow-sm)

.sidebar .control-icon-wrap
  border-radius var(--sp-radius-control)
  transition background-color var(--sp-motion-fast) ease, box-shadow var(--sp-motion-fast) ease, color var(--sp-motion-fast) ease
  &:hover
    background var(--sp-surface-elevated)
    box-shadow var(--sp-shadow-md)
  &.active
    background linear-gradient(145deg, var(--sp-primary-soft), var(--sp-surface-elevated))
    box-shadow var(--sp-shadow-focus)

.right-side-panel
  background var(--sp-surface)
  border-left 1px solid var(--sp-border)
  border-radius var(--sp-radius-panel) 0 0 var(--sp-radius-panel)
  box-shadow var(--sp-shadow-lg)

.right-panel-title
  background var(--sp-surface)
  border-bottom 1px solid var(--sp-border)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-sm)

.main-footer
  background var(--sp-surface-elevated)
  border-top 1px solid var(--sp-border)
  box-shadow 0 -4px 12px rgba(73, 66, 196, .12)

.custom-modal-content
  border-radius var(--sp-radius-overlay)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-lg)
```

Do not change absolute positions, top/left/right/bottom values, widths, heights, z-indexes, drag regions, panel pinning, or overflow behavior.

- [ ] **Step 5: Run shell, layout, and modal regressions**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/aigshell-layout.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
npx playwright test test/e2e/00181.layout.spec.js test/e2e/020.context-menu-ant6-layout.spec.js --workers=1
```

Expected: PASS with no new horizontal overflow and all existing focus/scroll checks intact.

- [ ] **Step 6: Commit the shared shell batch**

```powershell
git add src/client/css/includes/secondary-ui.styl src/client/components/main/aigshell-topbar.styl src/client/components/sidebar/sidebar.styl src/client/components/side-panel-r/right-side-panel.styl src/client/components/footer/footer.styl src/client/components/common/modal.styl test/unit-ci/secondary-ui-contract.spec.js
git commit -m "style: modernize ShellPilot application chrome"
```

---

### Task 3: Style the connection workbench, server/history panels, and AI assistant

**Files:**

- Create: `apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js`
- Modify: `apps/electerm-agent/src/client/components/tabs/no-session.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/sidebar.styl`
- Modify: `apps/electerm-agent/src/client/components/tree-list/tree-list.styl`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel.styl`
- Modify: `apps/electerm-agent/src/client/components/ai/ai.styl`

- [ ] **Step 1: Add a failing page-style contract**

Create `test/unit-ci/aurora-ui-style-contract.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const stylus = require('stylus')

const clientRoot = path.resolve(__dirname, '../../src/client')

function readClient (relativePath) {
  return fs.readFileSync(path.join(clientRoot, relativePath), 'utf8')
}

function compileStylus (relativePath) {
  const filename = path.join(clientRoot, relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  return new Promise((resolve, reject) => {
    stylus(source).set('filename', filename).render((error, css) => {
      if (error) reject(error)
      else resolve(css)
    })
  })
}

const styleFiles = [
  'components/tabs/no-session.styl',
  'components/sidebar/sidebar.styl',
  'components/tree-list/tree-list.styl',
  'components/side-panel-r/right-side-panel.styl',
  'components/ai/ai.styl',
  'components/terminal/terminal.styl',
  'components/tabs/tabs.styl',
  'components/footer/footer.styl',
  'components/sftp/sftp.styl',
  'components/sidebar/transfer.styl',
  'components/fleet-status/fleet-status.styl',
  'components/fleet-status/fleet-service-selector.styl',
  'components/artifacts/artifacts.styl',
  'components/setting-panel/setting-wrap.styl',
  'components/setting-panel/setting.styl',
  'components/setting-panel/list.styl',
  'components/sidebar/info.styl',
  'components/operations-toolkit/workspace/operations-workspace.styl'
]

test('all Aurora-owned Stylus files compile', async () => {
  for (const file of styleFiles) {
    assert.ok((await compileStylus(file)).length > 0, file)
  }
})

test('connection server history and AI surfaces use semantic Aurora depth', () => {
  const home = readClient('components/tabs/no-session.styl')
  const sidebar = readClient('components/sidebar/sidebar.styl')
  const tree = readClient('components/tree-list/tree-list.styl')
  const ai = readClient('components/ai/ai.styl')
  assert.match(home, /\.no-session-action[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(home, /\.no-session-recents[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(sidebar, /\.sidebar-panel[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(tree, /\.tree-item[\s\S]*var\(--sp-primary-soft\)/)
  assert.doesNotMatch(tree, /background\s+#000\b/)
  assert.match(ai, /\.chat-history-item[\s\S]*var\(--sp-shadow-sm\)/)
  assert.match(ai, /\.ai-chat-input[\s\S]*var\(--sp-shadow-md\)/)
})
```

- [ ] **Step 2: Run the new contract and verify it fails**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js
```

Expected: the compilation test passes, while the semantic depth assertions fail against the current styles.

- [ ] **Step 3: Restyle the existing connection workbench DOM**

In `src/client/components/tabs/no-session.styl`:

- Keep the four `.no-session-action` entries, their order, dimensions, and current responsive grid.
- Change `.no-session-mark` to a primary gradient with `var(--sp-shadow-focus)`.
- Give normal action cards `var(--sp-radius-toolbar)` and `var(--sp-shadow-sm)`.
- Give `.no-session-action-primary` a `linear-gradient(135deg, var(--sp-primary), var(--sp-primary-2))`, readable white text, and `var(--sp-shadow-focus)`.
- On hover, change only background, border, and shadow; do not translate or resize.
- Give `.no-session-recents` `var(--sp-radius-panel)` and `var(--sp-shadow-lg)` while keeping each history row flat with only its divider.
- Keep the recent-connections source and empty state untouched.

Use these central declarations:

```stylus
.no-session-action.ant-btn,
.no-session-quick-connect
  border-radius var(--sp-radius-toolbar)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-sm)
  transition background-color var(--sp-motion-fast) ease, border-color var(--sp-motion-fast) ease, box-shadow var(--sp-motion-fast) ease

.no-session-action.ant-btn:hover,
.no-session-action.ant-btn:focus-visible
  border-color var(--sp-primary)
  box-shadow var(--sp-shadow-md)

.no-session-action-primary.ant-btn
  color #FFFFFF
  border-color transparent
  background linear-gradient(135deg, var(--sp-primary), var(--sp-primary-2))
  box-shadow var(--sp-shadow-focus)

.no-session-recents
  border-radius var(--sp-radius-panel)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-lg)
```

- [ ] **Step 4: Restyle the existing server and history side panels**

In `sidebar.styl` and `tree-list.styl`, keep the side panels in their current overlay/pinned container. Add strong depth to `.sidebar-panel`, but keep `.tree-item`, `.item-list-unit`, and history rows flat. Replace the hardcoded black selected/hover tree background with semantic states:

```stylus
.sidebar-panel
  background var(--sp-surface)
  border-right 1px solid var(--sp-border)
  box-shadow var(--sp-shadow-lg)

.tree-item
  border-radius var(--sp-radius-small)
  transition background-color var(--sp-motion-fast) ease, color var(--sp-motion-fast) ease
  &.selected,
  &.item-dragover,
  &:hover
    color var(--sp-text)
    background var(--sp-primary-soft)

.history-body .item-list-unit
  border-bottom 1px solid var(--sp-border)
  box-shadow none
```

Do not convert either panel into a route or full-page workspace.

- [ ] **Step 5: Restyle the current AI assistant shell, messages, tools, and composer**

In `right-side-panel.styl` and `ai.styl`:

```stylus
.chat-history-item > .mg1y .ant-alert
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-toolbar)
  background var(--sp-surface-elevated)
  box-shadow var(--sp-shadow-sm)

.agent-tool-call-card,
.agent-tool-readonly-card
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-toolbar)
  background var(--sp-surface-soft)
  box-shadow var(--sp-shadow-sm)

.ai-chat-input .ant-input
  border-color var(--sp-border)
  border-radius var(--sp-radius-toolbar)
  background var(--sp-surface-elevated)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-md)

.ai-context-action,
.ai-attachment-chip,
.ai-generated-artifact
  border-radius var(--sp-radius-control)
  background var(--sp-surface-soft)
  border-color var(--sp-border)
```

Preserve panel width, pinning, model/profile selectors, context references, attachments, settings, history, send/stop behavior, safety states, and tool-call content.

- [ ] **Step 6: Run style and behavior regressions**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/ai-chat-layout.spec.js test/unit-ci/connection-wizard-and-layout.spec.js
npx playwright test test/e2e/008.basic-terminal.spec.js test/e2e/021.secondary-ui-state.spec.js --workers=1
```

Expected: PASS. `008.basic-terminal.spec.js` must still find the same home heading, four action area, primary action, and recent-connections section.

- [ ] **Step 7: Commit the workbench and side-panel batch**

```powershell
git add src/client/components/tabs/no-session.styl src/client/components/sidebar/sidebar.styl src/client/components/tree-list/tree-list.styl src/client/components/side-panel-r/right-side-panel.styl src/client/components/ai/ai.styl test/unit-ci/aurora-ui-style-contract.spec.js
git commit -m "style: apply Aurora to workbench and side panels"
```

---

### Task 4: Style terminal chrome and SFTP without touching terminal or file behavior

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal.styl`
- Modify: `apps/electerm-agent/src/client/components/tabs/tabs.styl`
- Modify: `apps/electerm-agent/src/client/components/footer/footer.styl`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/transfer.styl`

- [ ] **Step 1: Add failing terminal-frame and SFTP contracts**

Append to `test/unit-ci/aurora-ui-style-contract.spec.js`:

```js
test('terminal frame and SFTP panels use depth while rendered rows stay flat', () => {
  const terminal = readClient('components/terminal/terminal.styl')
  const sftp = readClient('components/sftp/sftp.styl')
  const transfer = readClient('components/sidebar/transfer.styl')
  assert.match(terminal, /\.terminal-workspace-layer[\s\S]*var\(--sp-shadow-lg\)/)
  assert.doesNotMatch(terminal, /\.(?:xterm|xterm-screen|xterm-viewport)[^{\n]*[\s\S]{0,180}box-shadow/)
  assert.match(sftp, /\.sftp-section[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(sftp, /\.sftp-item[\s\S]*box-shadow none/)
  assert.match(transfer, /\.transfer-list-card[\s\S]*var\(--sp-shadow-lg\)/)
})
```

In `secondary-ui-contract.spec.js`, explicitly allow the outer `.terminal-workspace-layer` frame while retaining the existing rejection list for all rendered terminal layers.

- [ ] **Step 2: Run the contracts and verify they fail**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js
```

Expected: FAIL because the outer frame and SFTP depth rules are absent.

- [ ] **Step 3: Style only the terminal workspace frame and chrome**

In `terminal.styl`, add the outer frame selector, excluding non-terminal workspaces:

```stylus
.terminal-workspace-layer:not(.fleet-status-active):not(.artifacts-active)
  background var(--shellpilot-terminal-background)
  box-shadow inset 0 0 0 1px var(--sp-border-strong), var(--sp-shadow-lg)
```

In `tabs.styl`, keep `--shellpilot-terminal-background` for the tabs and active tab. Use `var(--sp-primary)` only for the active indicator and `var(--sp-shadow-sm)` on tab controls. In `footer.styl`, keep existing status data and geometry while using semantic surfaces and the existing green online dot.

Never add `text-shadow`, `filter`, semantic backgrounds, or semantic box shadows to `.xterm`, `.xterm-screen`, `.xterm-viewport`, `.terms-box`, or `.term-wrap`. Do not change terminal background, font, font size, cursor, selection, renderer, input, search, reconnect, split, or focus behavior.

- [ ] **Step 4: Style SFTP containers and leave file rows flat**

In `sftp.styl` and `transfer.styl`:

```stylus
.sftp-section
  background var(--sp-surface)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-panel)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-md)

.sftp-title-wrap,
.sftp-file-table-header
  background var(--sp-surface-soft)
  border-bottom 1px solid var(--sp-border)

.sftp-item
  border-bottom 1px solid var(--sp-border)
  box-shadow none
  &:hover
    background var(--sp-surface-soft)
  &.selected
    background var(--sp-primary-soft)

.transfer-list-card.shellpilot-context-menu.shellpilot-transfer-history-popover
  border-radius var(--sp-radius-overlay)
  box-shadow var(--sp-shadow-lg)
```

Keep local/remote layout, address bars, navigation, sort, selection, upload/download, double-click, right-click, drag/drop, multi-select, keyboard shortcuts, transfer progress, and transaction behavior unchanged.

- [ ] **Step 5: Run terminal and SFTP regressions**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js test/unit-ci/sftp-navigation-ui.spec.js
npx playwright test test/e2e/008.basic-terminal.spec.js test/e2e/008.basic.file-manager.spec.js test/e2e/009.basic.themes.spec.js --workers=1
```

Expected: PASS. The terminal color invariant remains `#0E0F12`, and all SFTP navigation assertions remain unchanged.

- [ ] **Step 6: Commit the terminal and SFTP batch**

```powershell
git add src/client/components/terminal/terminal.styl src/client/components/tabs/tabs.styl src/client/components/footer/footer.styl src/client/components/sftp/sftp.styl src/client/components/sidebar/transfer.styl test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js
git commit -m "style: add Aurora depth to terminal and SFTP chrome"
```

---

### Task 5: Style Fleet Status and AI Artifacts

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/fleet-status-ui.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-artifact-ui.spec.js`
- Modify: `apps/electerm-agent/src/client/components/fleet-status/fleet-status.styl`
- Modify: `apps/electerm-agent/src/client/components/fleet-status/fleet-service-selector.styl`
- Modify: `apps/electerm-agent/src/client/components/artifacts/artifacts.styl`

- [ ] **Step 1: Replace obsolete small-radius assertions with Aurora hierarchy assertions**

In `test/unit-ci/fleet-status-ui.spec.js`, retain every overflow, sticky-header, table-column, selector, focus, and interaction assertion. Replace only the two rules that reject radii above 8px with explicit hierarchy assertions for both the workspace and service drawer:

```js
assert.match(styles, /\.fleet-status-toolbar[\s\S]*border-radius\s+var\(--sp-radius-toolbar\)/)
assert.match(styles, /\.fleet-status-table-scroll[\s\S]*border-radius\s+var\(--sp-radius-panel\)/)
assert.match(styles, /\.fleet-status-table-scroll[\s\S]*box-shadow\s+var\(--sp-shadow-lg\)/)
```

For the service-selector style source, assert:

```js
assert.match(styles, /\.ant-drawer-content[\s\S]*border-radius\s+var\(--sp-radius-panel\)/)
assert.match(styles, /\.ant-drawer-content[\s\S]*box-shadow\s+var\(--sp-shadow-lg\)/)
assert.match(styles, /\.fleet-service-selector-toolbar[\s\S]*box-shadow\s+var\(--sp-shadow-md\)/)
```

In `test/unit-ci/ai-artifact-ui.spec.js`, append:

```js
assert.match(styles, /\.artifact-list-panel[\s\S]*var\(--sp-shadow-lg\)/)
assert.match(styles, /\.artifact-preview[\s\S]*var\(--sp-shadow-lg\)/)
assert.match(styles, /\.artifact-list-item\.active[\s\S]*var\(--sp-shadow-focus\)/)
```

Append a matching page-level test to `aurora-ui-style-contract.spec.js` and assert that normal table/list rows do not receive `var(--sp-shadow-lg)`.

- [ ] **Step 2: Run focused tests and verify the style assertions fail**

```powershell
node --test test/unit-ci/fleet-status-ui.spec.js test/unit-ci/ai-artifact-ui.spec.js test/unit-ci/aurora-ui-style-contract.spec.js
```

Expected: FAIL only on the new Aurora visual contracts.

- [ ] **Step 3: Apply hierarchy to Fleet Status**

In `fleet-status.styl`:

```stylus
.fleet-status-workspace
  background var(--sp-canvas)
  color var(--sp-text)

.fleet-status-heading h1
  color var(--sp-text)
  font-size 28px

.fleet-status-toolbar
  background var(--sp-surface-elevated)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-toolbar)
  box-shadow var(--sp-shadow-md)

.fleet-status-table-scroll
  background var(--sp-surface)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-panel)
  box-shadow var(--sp-shadow-lg)

.fleet-status-table tbody tr
  box-shadow none

.fleet-status-table tbody tr:hover td
  background var(--sp-surface-soft)
```

Use `var(--sp-primary-soft)` and `var(--sp-shadow-focus)` only for selected rows/batch selection. Keep the current columns, filters, saved-server count, refresh/cancel, check-services, AI diagnosis, empty states, sticky columns, and horizontal scrolling.

In `fleet-service-selector.styl`, retain the 1180px width cap, short-window scrolling, sticky table header, and status contrast variables while styling the existing drawer shell:

```stylus
.fleet-service-selector-drawer
  .ant-drawer-content
    background var(--sp-surface)
    border 1px solid var(--sp-border-strong)
    border-radius var(--sp-radius-panel) 0 0 var(--sp-radius-panel)
    box-shadow var(--sp-shadow-lg)
  .ant-drawer-header
    background var(--sp-surface-elevated)
    border-bottom 1px solid var(--sp-border)

.fleet-service-selector-toolbar
  background var(--sp-surface-elevated)
  box-shadow var(--sp-shadow-md)

.fleet-service-selector-table tbody tr
  box-shadow none
```

- [ ] **Step 4: Apply hierarchy to AI Artifacts**

In `artifacts.styl`:

```stylus
.artifact-workspace
  background var(--sp-canvas)
  color var(--sp-text)

.artifact-list-panel,
.artifact-preview
  background var(--sp-surface)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-panel)
  box-shadow var(--sp-shadow-lg)

.artifact-list-filters,
.artifact-preview-header,
.artifact-editor-toolbar,
.artifact-spreadsheet-toolbar
  background var(--sp-surface-soft)

.artifact-list-item
  box-shadow none
  border-bottom 1px solid var(--sp-border)
  &.active
    background linear-gradient(145deg, var(--sp-primary-soft), var(--sp-surface-elevated))
    box-shadow var(--sp-shadow-focus)
```

Keep search, server/format filters, list selection, document/spreadsheet previews, edit, save, external open, upload, refresh, close, autosave, and version behavior unchanged.

- [ ] **Step 5: Run Fleet and Artifacts behavior regressions**

```powershell
node --test test/unit-ci/fleet-status-ui.spec.js test/unit-ci/ai-artifact-ui.spec.js test/unit-ci/ai-artifact-preview-ui.spec.js test/unit-ci/aurora-ui-style-contract.spec.js
npx playwright test test/e2e/023.fleet-status.spec.js test/e2e/025.fleet-service-selector.spec.js --workers=1
```

Expected: PASS with the existing table row counts, filtering, focus restoration, selector dialog, and artifact capabilities intact.

- [ ] **Step 6: Commit the data-workspace batch**

```powershell
git add src/client/components/fleet-status/fleet-status.styl src/client/components/fleet-status/fleet-service-selector.styl src/client/components/artifacts/artifacts.styl test/unit-ci/fleet-status-ui.spec.js test/unit-ci/ai-artifact-ui.spec.js test/unit-ci/aurora-ui-style-contract.spec.js
git commit -m "style: modernize Fleet and AI artifact workspaces"
```

---

### Task 6: Style Settings, Password Management, and Logs

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/secondary-config-ui.spec.js`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-wrap.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/list.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/info.styl`

- [ ] **Step 1: Add failing grouped-settings, password-table, and log-surface assertions**

Append to `test/unit-ci/aurora-ui-style-contract.spec.js`:

```js
test('settings passwords and logs use grouped surfaces instead of per-field cards', () => {
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const setting = readClient('components/setting-panel/setting.styl')
  const info = readClient('components/sidebar/info.styl')
  assert.match(wrap, /\.setting-header[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(setting, /\.sp-setting-section[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(setting, /\.setting-passwords[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(info, /\.info-modal[\s\S]*var\(--sp-shadow-lg\)/)
  assert.doesNotMatch(setting, /\.sp-setting-field[\s\S]{0,180}box-shadow/)
})
```

In `test/unit-ci/secondary-config-ui.spec.js`, retain all field, search, language preview, autosave, disabled, focus, and responsive assertions. Add exact checks for the settings header radius, grouped section radius, and password table overflow.

- [ ] **Step 2: Run the focused tests and verify the new assertions fail**

```powershell
node --test test/unit-ci/secondary-config-ui.spec.js test/unit-ci/aurora-ui-style-contract.spec.js
```

Expected: FAIL because password and info surfaces do not yet have Aurora ownership.

- [ ] **Step 3: Style the settings shell and grouped sections**

In `setting-wrap.styl`, preserve sticky header/tabs and current scroll containers:

```stylus
.setting-header
  background var(--sp-surface-elevated)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-toolbar)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-md)

.setting-row-left
  background var(--sp-surface-soft)
  border-right 1px solid var(--sp-border)

.setting-tabs .ant-tabs-tab-active
  background linear-gradient(145deg, var(--sp-primary-soft), var(--sp-surface-elevated))
  border-radius var(--sp-radius-control)
  box-shadow var(--sp-shadow-sm)
```

In `setting.styl`, keep one visual card per existing `.sp-setting-section`; do not card every field:

```stylus
.sp-setting-section
  background var(--sp-surface-elevated)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-panel)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-md)

.sp-setting-field
  box-shadow none
```

Keep current field order, settings categories, search, autosave, language preview/apply, close behavior, and every conditionally visible control.

- [ ] **Step 4: Style Password Management through existing classes**

Add to `setting.styl`:

```stylus
.setting-passwords
  min-width 0
  padding 20px
  background var(--sp-surface)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-panel)
  box-shadow var(--sp-shadow-lg)

.setting-passwords-header
  margin-bottom 16px
  color var(--sp-text)

.setting-passwords .ant-table-wrapper
  max-width 100%
  overflow-x auto

.setting-passwords .ant-table-row
  box-shadow none

.password-edit-form,
.affected-bookmarks
  color var(--sp-text)
```

Do not change grouping, masked display, search, counts, associated hosts, copy, edit, pagination, or bookmark updates.

- [ ] **Step 5: Style the current logs/about modal without changing its content source**

Replace the unused decorative-only content in `sidebar/info.styl` with scoped presentation rules while leaving `.morph-shape` available if still referenced:

```stylus
.info-modal .custom-modal-content
  background var(--sp-surface-elevated)
  border-color var(--sp-border-strong)
  border-radius var(--sp-radius-overlay)
  box-shadow var(--sp-shadow-lg)

.info-modal .about-wrap
  color var(--sp-text)

.info-modal pre
  max-width 100%
  overflow auto
  padding 14px
  color var(--sp-text)
  background var(--sp-surface-inset)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-toolbar)
  font-family var(--font-mono, monospace)
```

Do not add a new logs route, replace the data source, or change `infoTabs.log` behavior.

- [ ] **Step 6: Run settings, password, and compact-layout regressions**

```powershell
node --test test/unit-ci/secondary-config-ui.spec.js test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js
npx playwright test test/e2e/setting-bookmarks-compact-layout.spec.js test/e2e/setting-themes-compact-layout.spec.js test/e2e/021.secondary-ui-state.spec.js --workers=1
```

Expected: PASS. Settings remain reachable at narrow widths and language/theme previews preserve drafts and saved values.

- [ ] **Step 7: Commit the settings batch**

```powershell
git add src/client/components/setting-panel/setting-wrap.styl src/client/components/setting-panel/setting.styl src/client/components/setting-panel/list.styl src/client/components/sidebar/info.styl test/unit-ci/secondary-config-ui.spec.js test/unit-ci/aurora-ui-style-contract.spec.js
git commit -m "style: modernize settings passwords and logs"
```

---

### Task 7: Style the Operations Toolkit

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/operations-workspace-style.spec.js`
- Modify: `apps/electerm-agent/src/client/components/operations-toolkit/workspace/operations-workspace.styl`

- [ ] **Step 1: Add failing workspace hierarchy assertions**

In `test/unit-ci/operations-workspace-style.spec.js`, keep the existing primary-action contrast test and add a second test with its own `styles` read:

```js
test('uses Aurora depth on containers while keeping operations rows flat', () => {
  const styles = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/operations-toolkit/workspace/operations-workspace.styl'
  ), 'utf8')
  assert.match(styles, /\.operations-toolkit-workspace[\s\S]*border-radius\s+var\(--sp-radius-panel\)/)
  assert.match(styles, /\.operations-toolkit-workspace[\s\S]*box-shadow\s+var\(--sp-shadow-lg\)/)
  assert.match(styles, /\.operations-workspace-head[\s\S]*box-shadow\s+var\(--sp-shadow-md\)/)
  assert.match(styles, /\.operations-tool-list[\s\S]*box-shadow\s+none/)
})
```

Append corresponding assertions to `aurora-ui-style-contract.spec.js` and keep the compilation coverage.

- [ ] **Step 2: Run the focused tests and verify they fail**

```powershell
node --test test/unit-ci/operations-workspace-style.spec.js test/unit-ci/aurora-ui-style-contract.spec.js
```

Expected: FAIL on the new hierarchy assertions.

- [ ] **Step 3: Apply the approved Operations Toolkit hierarchy**

In `operations-workspace.styl`:

```stylus
.operations-toolkit-workspace
  background var(--sp-canvas)
  border 1px solid var(--sp-border-strong)
  border-radius var(--sp-radius-panel)
  box-shadow var(--sp-shadow-lg)

.operations-workspace-head
  background var(--sp-surface-elevated)
  border-bottom 1px solid var(--sp-border)
  box-shadow var(--sp-shadow-md)

.operations-recommended-flow,
.operations-tool-detail,
.operations-task-panel,
.operations-maintenance-safety
  background var(--sp-surface-elevated)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-toolbar)
  box-shadow var(--sp-shadow-md)

.operations-tool-list,
.operations-history article
  box-shadow none

.operations-tool-list button:hover,
.operations-history article:hover
  background var(--sp-surface-soft)

.operations-tool-list button.active
  background linear-gradient(145deg, var(--sp-primary-soft), var(--sp-surface-elevated))
  box-shadow var(--sp-shadow-focus)
```

Keep all five existing tabs and order, recommended flow, catalogs, search, categories, parameters, connection state, execution, tasks, results, cancellation, safety actions, and AI analysis handoff unchanged.

- [ ] **Step 4: Run Operations Toolkit behavior and layout regressions**

```powershell
node --test test/unit-ci/operations-workspace-style.spec.js test/unit-ci/aurora-ui-style-contract.spec.js
npx playwright test test/e2e/032.operations-toolkit.spec.js test/e2e/009.1.quick-commands.spec.js test/e2e/009.2.quick-command.spec.js --workers=1
```

Expected: PASS with the same tab labels, item counts, enabled states, safety-center action, and viewport bounds.

- [ ] **Step 5: Commit the Operations Toolkit batch**

```powershell
git add src/client/components/operations-toolkit/workspace/operations-workspace.styl test/unit-ci/operations-workspace-style.spec.js test/unit-ci/aurora-ui-style-contract.spec.js
git commit -m "style: apply Aurora to operations toolkit"
```

---

### Task 8: Validate responsive behavior, dark mode, accessibility, and every page preview

**Files:**

- Modify only if an assertion reveals a visual defect: the Stylus files already listed in Tasks 2–7.
- Generate, do not commit: `release-verification/aurora-ui-2026-08-01/*.png`

- [ ] **Step 1: Run the full semantic visual matrix in smoke mode first**

```powershell
$env:SHELLPILOT_VISUAL_MATRIX_SMOKE = '1'
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1
Remove-Item Env:SHELLPILOT_VISUAL_MATRIX_SMOKE
```

Expected: PASS with zero secondary overflow, focus failures, disabled-contrast failures, or terminal-invariant failures.

- [ ] **Step 2: Run targeted Aurora light, dark, compact, and 125% matrix cases**

Run each command separately:

```powershell
$env:SHELLPILOT_VISUAL_MATRIX_SIZE = '1600x900'
$env:SHELLPILOT_VISUAL_MATRIX_ZOOM = '1'
$env:SHELLPILOT_VISUAL_MATRIX_LANGUAGE = 'zh_cn'
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1

$env:SHELLPILOT_VISUAL_MATRIX_SIZE = '1100x700'
$env:SHELLPILOT_VISUAL_MATRIX_ZOOM = '1.25'
$env:SHELLPILOT_VISUAL_MATRIX_LANGUAGE = 'zh_cn'
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1

$env:SHELLPILOT_VISUAL_MATRIX_SIZE = '590x400'
$env:SHELLPILOT_VISUAL_MATRIX_ZOOM = '1'
$env:SHELLPILOT_VISUAL_MATRIX_LANGUAGE = 'en_us'
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1

Remove-Item Env:SHELLPILOT_VISUAL_MATRIX_SIZE
Remove-Item Env:SHELLPILOT_VISUAL_MATRIX_ZOOM
Remove-Item Env:SHELLPILOT_VISUAL_MATRIX_LANGUAGE
```

Expected: PASS for all five ShellPilot themes, including Cloud Indigo and Graphite Night.

- [ ] **Step 3: Capture implementation previews for all eleven approved surfaces**

Create the evidence directory from the repository root:

```powershell
New-Item -ItemType Directory -Force -Path F:\SSH工具开发\release-verification\aurora-ui-2026-08-01
```

In one terminal, launch the current app with:

```powershell
cd F:\SSH工具开发\apps\electerm-agent
npm run app
```

Select Cloud Indigo for light captures and Graphite Night for dark verification, then capture these exact files at 1600×900 and 100% zoom:

```text
01-connection-workbench.png
02-fleet-status.png
03-ai-artifacts.png
04-server-side-panel.png
05-terminal-workspace.png
06-sftp.png
07-history-side-panel.png
08-password-management.png
09-logs.png
10-settings.png
11-operations-toolkit.png
```

For each capture, use only real current controls and available fixture/current data. Do not seed preview-only actions, routes, fields, counters, recommendations, or sample records. Server and History must visibly remain side panels. Capture a second dark screenshot for terminal, SFTP, settings, and AI assistant, plus 125% screenshots for home, settings, terminal, SFTP, and AI assistant.

Use these exact supplemental names:

```text
05-terminal-workspace-dark.png
06-sftp-dark.png
10-settings-dark.png
12-ai-assistant-dark.png
01-connection-workbench-125.png
05-terminal-workspace-125.png
06-sftp-125.png
10-settings-125.png
12-ai-assistant-125.png
```

- [ ] **Step 4: Review every screenshot against the approved design and functional shell**

For each PNG, verify:

- Light lavender/white or dark navy canvas uses the approved semantic palette.
- Main workspaces, open side panels, and large overlays use strong depth once, not nested card stacks.
- Toolbars and selected items use medium/focus depth.
- Table, file, history, log, and ordinary list rows remain flat.
- Red appears only for existing danger/error states.
- Focus rings remain visible, disabled text remains readable, and hover causes no layout movement.
- All current visible entries, labels, buttons, tabs, menu items, setting fields, counts, and ordering match the pre-change application.
- Terminal characters have no glow and retain the current user font, size, cursor, colors, and background.

If a screenshot fails, adjust only the responsible Stylus file, rerun its focused unit and E2E tests, and recapture that PNG.

- [ ] **Step 5: Run the full visual matrix**

```powershell
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1
```

Expected: PASS across four sizes, three zoom factors, two languages, and all five themes.

- [ ] **Step 6: Commit any screenshot-review style corrections only**

Stage only named Stylus and test files that were actually corrected. Do not commit `release-verification/aurora-ui-2026-08-01/`.

```powershell
git diff --cached --name-only
git commit -m "style: polish Aurora responsive visual states"
```

Expected: the staged list contains no JSX, Store, IPC, data, or generated screenshot files.

---

### Task 9: Run the final UI-only scope audit and release verification

**Files:**

- No new files.
- Verify every file changed by Tasks 1–8.

- [ ] **Step 1: Audit the production diff before running the full suite**

From `F:\SSH工具开发`, run:

```powershell
git diff --name-only 4f3670c..HEAD
git diff --stat 4f3670c..HEAD
git diff 4f3670c..HEAD -- apps/electerm-agent/src/client
```

Expected production diff: only the two approved theme JavaScript files and the Stylus files named in the responsibility map. Tests and this plan may also appear. Existing unrelated dirty files must remain unstaged and unchanged.

Reject the batch if the diff contains production `.jsx`, Store, route, translation, IPC, persistence, SSH, SFTP behavior, AI behavior, safety, updater, or operations execution files.

- [ ] **Step 2: Prove visible feature inventory and behavior remained stable**

Run:

```powershell
cd F:\SSH工具开发\apps\electerm-agent
node --test test/unit-ci/aigshell-layout.spec.js test/unit-ci/connection-wizard-and-layout.spec.js test/unit-ci/sftp-navigation-ui.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js test/unit-ci/fleet-status-ui.spec.js test/unit-ci/ai-artifact-ui.spec.js test/unit-ci/ai-artifact-preview-ui.spec.js test/unit-ci/secondary-config-ui.spec.js test/unit-ci/operations-workspace-style.spec.js test/unit-ci/aurora-ui-style-contract.spec.js
```

Expected: PASS. No behavior assertion is removed, loosened, skipped, or marked expected-failure.

- [ ] **Step 3: Run all unit contracts, lint, and build**

```powershell
npm run test-unit-ci
npm run lint
npm run build
```

Expected: all commands exit 0. If lint reports unrelated pre-existing dirty files, run StandardJS on every file changed by this plan and record the unrelated path separately; do not modify unrelated work to obtain a green result.

- [ ] **Step 4: Run the primary end-to-end regression set**

```powershell
npx playwright test test/e2e/00181.layout.spec.js test/e2e/008.basic-terminal.spec.js test/e2e/008.basic.file-manager.spec.js test/e2e/009.1.quick-commands.spec.js test/e2e/009.2.quick-command.spec.js test/e2e/009.basic.themes.spec.js test/e2e/020.context-menu-ant6-layout.spec.js test/e2e/021.secondary-ui-state.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/023.fleet-status.spec.js test/e2e/025.fleet-service-selector.spec.js test/e2e/032.operations-toolkit.spec.js test/e2e/setting-bookmarks-compact-layout.spec.js test/e2e/setting-themes-compact-layout.spec.js --workers=1
```

Expected: PASS with no screenshots generated from preview-only fake features and no interaction regressions.

- [ ] **Step 5: Scan the implementation for unfinished markers and forbidden styling**

```powershell
$unfinishedPattern = @('TO' + 'DO', 'TB' + 'D', 'place' + 'holder', 'similar' + ' to') -join '|'
rg -n $unfinishedPattern docs/superpowers/plans/2026-08-01-shellpilot-aurora-ui-modernization.md apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js
rg -n "text-shadow|transform\s+translate|filter\s*:|filter\s+" apps/electerm-agent/src/client/components/terminal apps/electerm-agent/src/client/css/includes/secondary-ui.styl
```

Expected: the first command returns no unfinished plan/test markers. The second command returns no terminal glyph glow or hover translation introduced by this work; existing unrelated filters must be reviewed rather than mechanically removed.

- [ ] **Step 6: Perform the final staged-file check and commit**

```powershell
git status --short
git diff --cached --name-only
```

Stage only remaining plan-owned files. Commit only when the staged diff is non-empty:

```powershell
git diff --cached --quiet
if ($LASTEXITCODE -eq 1) {
  git commit -m "style: finalize ShellPilot Aurora UI"
}
```

Expected: unrelated user changes and generated screenshot evidence remain unstaged. Final handoff includes the eleven implementation PNG paths, test results, build result, and a statement that no production JSX or functionality file changed.
