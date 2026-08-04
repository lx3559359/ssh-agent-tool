# ShellPilot v0.4.31 Glacier Silver Card UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the complete ShellPilot v0.4.31 client with a default light Glacier Silver card system and a paired Graphite Silver dark mode while preserving the current layout, feature positions, workflows, data behavior, and dense terminal/table/log presentation.

**Architecture:** Add two first-class ShellPilot UI palettes and a tested light/dark pairing helper, extend the existing semantic token adapter with centralized page/topbar/control/card/panel/overlay/flat-surface roles, then adapt existing Stylus owners by workspace. Keep the current React tree and business state intact except for the minimum topbar theme-toggle wiring. Enforce complete coverage through compile/style contracts, protected dense-surface rules, Electron visual matrices, and a final file-scope audit.

**Tech Stack:** Electron 41, React 19, Ant Design 6, Stylus 0.64, Manate, Node.js test runner, StandardJS, Playwright 1.61.

**Approved design:** `docs/superpowers/specs/2026-08-04-shellpilot-v031-glacier-silver-card-ui-design.md`

**Source baseline:** ShellPilot `v0.4.31`, `master`, with the approved design commits already present. The inspected latest-client layout is the only structural reference; the supplied screenshot is material/style inspiration only.

**Execution directories:** Run app commands from `F:\SSH工具开发\apps\electerm-agent`. Run repository-level Git and evidence checks from the isolated implementation worktree root.

**Non-negotiable behavior guard:** Do not reorder, rename, remove, or move visible entries. Do not alter SSH, SFTP, terminal input, AI requests, safety transactions, rollback, update, sync, persistence, routing, keyboard behavior, focus restoration, or data models. JSX changes are limited to the topbar theme-pair call and a semantic class only if an existing DOM boundary cannot represent an approved surface.

**Material guard:** The Glacier Silver card must read as cool silver, not pure white and not a hard metallic plate. Use the approved diffuse two-layer gradient only through semantic tokens. Do not copy gradient constants into component styles. Do not apply card shadows to xterm canvases, SFTP/table/log rows, virtual-list rows, task output, code/diff bodies, or execution history rows.

**Dirty-worktree guard:** The source workspace currently contains unrelated user changes in `src/client/components/artifacts/artifact-card.jsx`, `test/e2e/006.ai-chat.spec.js`, `test/unit-ci/ai-artifact-chat-ui.spec.js`, and `src/client/components/artifacts/artifact-card-state.js`, plus unrelated audit artifacts. Do not edit, copy, stage, or commit them. `components/artifacts/artifacts.styl` is in scope; the dirty artifact JSX/state files are not.

---

## Responsibility map

Theme foundation and behavior:

- `apps/electerm-agent/src/app/common/config-default.js`: new-install UI theme default only.
- `apps/electerm-agent/src/client/common/shellpilot-ui-palettes.js`: the existing five palettes plus Glacier Silver and Graphite Silver.
- `apps/electerm-agent/src/client/common/ui-theme-tokens.js`: semantic colors, gradients, radii, shadows, focus, and motion.
- `apps/electerm-agent/src/client/common/ui-theme-pairing.js`: pure pairing and mode helpers.
- `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`: localized names/descriptions for the two new palettes.
- `apps/electerm-agent/src/client/components/main/aigshell-topbar.jsx`: call the tested pairing helper; no action/order/layout changes.
- `apps/electerm-agent/src/client/css/includes/secondary-ui.styl`: shared L0-L3 and flat-data surface contracts.

Global shell and shared chrome:

- `components/main/aigshell-topbar.styl`, `components/main/wrapper.styl`, `components/main/term-fullscreen.styl`
- `components/sidebar/sidebar.styl`, `components/side-panel-r/right-side-panel.styl`
- `components/tabs/tabs.styl`, `components/tabs/add-btn.styl`, `components/footer/footer.styl`, `components/layout/layout.styl`
- `components/common/modal.styl`, `drawer.styl`, `context-menu.styl`, `message.styl`, `notification.styl`, `input-confirm-common.styl`, `drag-handle.styl`, `remote-float-control.styl`, `lazy-module-boundary.styl`, `markdown.styl`
- `components/sys-menu/sys-menu.styl`

Connection and primary workspaces:

- `components/tabs/no-session.styl`, `components/tabs/quick-connect.styl`
- `components/bookmark-form/bookmark-form.styl`, `components/bookmark-form/common/bookmark-group-picker.styl`, `color-picker.styl`
- `components/tree-list/tree-list.styl`, `bookmark-import-strategy-dialog.styl`
- `components/session/session.styl`, `components/ssh-config/ssh-config.styl`
- `components/fleet-status/fleet-status.styl`, `fleet-service-selector.styl`
- `components/artifacts/artifacts.styl`, `components/incidents/incidents.styl`

Dense operation workspaces:

- `components/terminal/terminal.styl`, `terminal-command-safety-modal.styl`, `term-search.styl`
- `components/sftp/sftp.styl`, `address-bookmark.styl`, `transfer-tag.styl`
- `components/sidebar/transfer.styl`, `transfer-history.styl`, `components/file-transfer/transfer.styl`
- `components/operations-toolkit/workspace/operations-workspace.styl`
- `components/quick-commands/qm.styl`, `components/ssh-tunnel/ssh-tunnel-modal.styl`
- `components/server-status/server-status-modal.styl`, `components/main/safety-operation-center-modal.styl`, `safety-task-progress.styl`

AI, settings, support, and secondary clients:

- `components/ai/ai.styl`, `agent-skill-manager.styl`, `agent-task-runner.styl`, `ai-file-change-review-modal.styl`
- `components/setting-panel/setting-wrap.styl`, `setting.styl`, `list.styl`, `ui-font-picker.styl`
- `components/theme/theme-gallery.styl`, `theme-form.styl`, `terminal-theme-list.styl`
- `components/main/help-center-modal.styl`, `update-center-modal.styl`, `upgrade.styl`, `crash-recovery-notice.styl`
- `components/sidebar/info.styl`, `components/terminal-info/terminal-info.styl`, `components/footer/cmd-history.styl`
- `components/widgets/widgets.styl`, `components/auth/login.styl`
- `components/rdp/rdp.styl`, `components/vnc/vnc.styl`, `components/spice/spice.styl`

Tests and evidence:

- New: `test/unit-ci/glacier-silver-theme.spec.js`
- New: `test/unit-ci/glacier-silver-ui-style-contract.spec.js`
- Modify: `test/unit-ci/ui-theme-tokens.spec.js`, `shellpilot-ui-palettes.spec.js`, `terminal-ui-theme-decoupling.spec.js`, `secondary-ui-contract.spec.js`, `aurora-ui-style-contract.spec.js`
- Modify: `test/e2e/009.basic.themes.spec.js`, `022.secondary-ui-visual-matrix.spec.js`, `026.primary-workspace-regression.spec.js`
- New: `test/e2e/037.glacier-silver-client-visual.spec.js`
- Update after verification: `apps/electerm-agent/design-qa.md`
- Generated and uncommitted: `release-verification/glacier-silver-card-ui-2026-08-04/`

---

### Task 0: Create a clean implementation worktree and record the baseline

**Files:** No production files.

- [ ] **Step 1: Invoke `superpowers:using-git-worktrees` before implementation**

Create an isolated worktree on branch `codex/glacier-silver-card-ui` from the commit containing this plan. Do not reuse `F:\SSH工具开发\ui-modernization-worktree` and do not copy uncommitted files from the source workspace.

- [ ] **Step 2: Verify the isolated worktree is clean and at v0.4.31**

Run from the isolated app directory:

```powershell
git status --short
node -p "require('./package.json').version"
git log -1 --oneline
```

Expected: empty status; package version `0.4.31`; the latest commit includes this plan.

- [ ] **Step 3: Run focused baseline tests**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/aurora-ui-style-contract.spec.js
```

Expected: all focused tests pass before any implementation change. If a baseline failure occurs, stop and record it rather than weakening an assertion.

---

### Task 1: Add the Glacier Silver and Graphite Silver theme pair

**Files:**

- Create: `apps/electerm-agent/src/client/common/ui-theme-pairing.js`
- Create: `apps/electerm-agent/test/unit-ci/glacier-silver-theme.spec.js`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-ui-palettes.js`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/src/app/common/config-default.js`
- Modify: `apps/electerm-agent/src/client/components/main/aigshell-topbar.jsx`
- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-ui-palettes.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/terminal-ui-theme-decoupling.spec.js`

- [ ] **Step 1: Write failing tests for new-install default, palette identity, pairing, and persistence**

Create `test/unit-ci/glacier-silver-theme.spec.js` with direct assertions for:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const clientCommon = path.resolve(__dirname, '../../src/client/common')

test('new installations default to Glacier Silver without changing terminal colors', () => {
  const config = require('../../src/app/common/config-default.js')
  assert.equal(config.theme, 'shellpilot-glacier')
  assert.equal(config.terminalTheme, 'default')
})

test('Glacier Silver and Graphite Silver form a reversible pair', async () => {
  const pairing = await import(pathToFileURL(path.join(clientCommon, 'ui-theme-pairing.js')).href)
  assert.equal(pairing.getThemeToggleTarget('shellpilot-glacier'), 'shellpilot-graphite-silver')
  assert.equal(pairing.getThemeToggleTarget('shellpilot-graphite-silver'), 'shellpilot-glacier')
  assert.equal(pairing.getThemeToggleTarget('defaultLight'), 'default')
  assert.equal(pairing.getThemeToggleTarget('shellpilot-ocean'), 'defaultLight')
})

test('mode detection uses built-in metadata and safe legacy fallbacks', async () => {
  const pairing = await import(pathToFileURL(path.join(clientCommon, 'ui-theme-pairing.js')).href)
  const themes = [
    { id: 'shellpilot-glacier', mode: 'light' },
    { id: 'shellpilot-graphite-silver', mode: 'dark' }
  ]
  assert.equal(pairing.isLightUiTheme('shellpilot-glacier', themes), true)
  assert.equal(pairing.isLightUiTheme('shellpilot-graphite-silver', themes), false)
  assert.equal(pairing.isLightUiTheme('defaultLight', []), true)
  assert.equal(pairing.isLightUiTheme('custom-theme', []), false)
})
```

Extend `shellpilot-ui-palettes.spec.js` so the expected built-in list has seven records and asserts exact IDs, names, modes, readonly/type fields, and UI values. Extend `terminal-ui-theme-decoupling.spec.js` to prove toggling the UI pair leaves `terminalTheme` and all ANSI colors unchanged.

- [ ] **Step 2: Run the tests and verify they fail for missing IDs/helper/default**

```powershell
node --test test/unit-ci/glacier-silver-theme.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js
```

Expected: failures reference `shellpilot-glacier`, `shellpilot-graphite-silver`, the missing helper module, and the old `theme: 'default'` config.

- [ ] **Step 3: Implement the pure pairing helper**

Create `src/client/common/ui-theme-pairing.js` exactly as follows:

```js
export const glacierThemeId = 'shellpilot-glacier'
export const graphiteSilverThemeId = 'shellpilot-graphite-silver'

const pairedThemes = Object.freeze({
  [glacierThemeId]: graphiteSilverThemeId,
  [graphiteSilverThemeId]: glacierThemeId
})

export function getThemeToggleTarget (themeId) {
  return pairedThemes[themeId] || (themeId === 'defaultLight' ? 'default' : 'defaultLight')
}

export function isLightUiTheme (themeId, themes = []) {
  const active = themes.find(theme => theme && theme.id === themeId)
  if (active && (active.mode === 'light' || active.mode === 'dark')) {
    return active.mode === 'light'
  }
  return themeId === 'defaultLight'
}
```

This keeps legacy toggle behavior for every non-paired theme and gives only the approved pair a new reversible target.

- [ ] **Step 4: Add both palette records without changing the existing five**

Insert Glacier Silver first and Graphite Silver immediately after it in `paletteConfigs`. Use these exact values:

```js
{
  key: 'glacier',
  name: 'Glacier Silver',
  nameKey: 'shellpilotThemeGlacier',
  descriptionKey: 'shellpilotThemeGlacierDesc',
  mode: 'light',
  main: '#EDF5FB',
  mainLight: '#F6FAFC',
  mainDark: '#CFDCE7',
  surfaceSoft: '#EAF1F6',
  text: '#14243F',
  textLight: '#14243F',
  textMuted: '#65738A',
  textDisabled: '#718096',
  primary: '#5C5BE9',
  primaryAlt: '#5547A6',
  cyan: '#247FC2',
  border: '#CFDCE7',
  pageDot: '#537EB2',
  cardStart: '#F6FAFC',
  cardMid: '#EAF1F6',
  cardEnd: '#DCE6EE',
  panelStart: '#F3F8FB',
  panelMid: '#E7EFF5',
  panelEnd: '#D9E4EC',
  flat: '#EAF1F6',
  topbarStart: '#306290',
  topbarMid: '#40588E',
  topbarEnd: '#5547A6',
  statusColors: {
    info: '#247FC2',
    success: '#168A74',
    error: '#C43F55',
    warn: '#B86620'
  }
},
{
  key: 'graphite-silver',
  name: 'Graphite Silver',
  nameKey: 'shellpilotThemeGraphiteSilver',
  descriptionKey: 'shellpilotThemeGraphiteSilverDesc',
  mode: 'dark',
  main: '#101722',
  mainLight: '#2A3543',
  mainDark: '#0B1018',
  surfaceSoft: '#202A37',
  text: '#EDF3FA',
  textLight: '#EDF3FA',
  textMuted: '#AAB6C5',
  textDisabled: '#8391A3',
  primary: '#8583FF',
  primaryAlt: '#A094FF',
  cyan: '#4DB8E8',
  border: '#3A495C',
  pageDot: '#536B8A',
  cardStart: '#2A3543',
  cardMid: '#202A37',
  cardEnd: '#18212C',
  panelStart: '#26313E',
  panelMid: '#1D2733',
  panelEnd: '#151D27',
  flat: '#18212C',
  topbarStart: '#263F63',
  topbarMid: '#37477A',
  topbarEnd: '#493A87',
  statusColors: {
    info: '#4DB8E8',
    success: '#4FD1B5',
    error: '#FF7185',
    warn: '#F0A45D'
  }
}
```

Extend the `uiThemeConfig` builder with optional kebab-case fields for `page-dot`, `card-start`, `card-mid`, `card-end`, `panel-start`, `panel-mid`, `panel-end`, `flat`, `topbar-start`, `topbar-mid`, and `topbar-end`. Keep `normalizeTerminalThemeConfig(baseTerminalTheme)` untouched.

- [ ] **Step 5: Localize names and wire the default/toggle**

Add Chinese strings `冰川冷银` / `石墨冷银` with descriptions that mention diffuse cool-silver light and companion dark surfaces. Add equivalent English strings. Change `src/app/common/config-default.js` to:

```js
theme: 'shellpilot-glacier',
terminalTheme: 'default',
```

In `aigshell-topbar.jsx`, import `settingMap`, `getThemeToggleTarget`, and `isLightUiTheme`. Replace the old `default/defaultLight` check with:

```js
const activeThemes = store.getSidebarList(settingMap.terminalThemes)
const isLightTheme = isLightUiTheme(store.config.theme, activeThemes)

function handleToggleTheme () {
  window.store.setTheme(getThemeToggleTarget(store.config.theme))
}
```

Do not change the topbar action array, labels, icons, ordering, dimensions, or click targets.

- [ ] **Step 6: Run focused tests and commit**

```powershell
node --test test/unit-ci/glacier-silver-theme.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
git add src/app/common/config-default.js src/client/common/ui-theme-pairing.js src/client/common/shellpilot-ui-palettes.js src/client/common/shellpilot-i18n-overrides.js src/client/components/main/aigshell-topbar.jsx test/unit-ci/glacier-silver-theme.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js
git commit -m "feat(theme): add glacier silver theme pair"
```

Expected: all focused tests pass; the commit contains no artifact-card or unrelated audit file.

---

### Task 2: Extend semantic material tokens and shared surfaces

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`
- Modify: `apps/electerm-agent/src/client/common/ui-theme-tokens.js`
- Modify: `apps/electerm-agent/src/client/css/includes/secondary-ui.styl`

- [ ] **Step 1: Write failing exact-gradient and fallback tests**

Add these token names to the ordered token contract:

```js
'pageBackground',
'topbarBackground',
'controlBackground',
'cardBackground',
'panelBackground',
'overlayBackground',
'flatBackground',
```

For the Glacier palette, assert:

```js
assert.equal(tokens.topbarBackground, 'linear-gradient(100deg, #306290 0%, #40588E 52%, #5547A6 100%)')
assert.equal(tokens.cardBackground, 'radial-gradient(110% 90% at 15% 0%, #FFFFFF 0%, rgba(255, 255, 255, 0.82) 35%, transparent 72%), linear-gradient(150deg, #F6FAFC 0%, #EAF1F6 58%, #DCE6EE 100%)')
assert.equal(tokens.flatBackground, '#EAF1F6')
```

For Graphite Silver, assert that `cardBackground` contains `#2A3543`, `#202A37`, and `#18212C`, and does not contain the Glacier Silver light stops. Assert `buildUiThemeCss()` emits every new variable.

Update `secondary-ui-contract.spec.js` so L0 uses `--sp-page-background`, L1 uses `--sp-control-background`, L2/card uses `--sp-card-background`, L3 uses `--sp-overlay-background`, and `.sp-flat-data` has no semantic shadow.

- [ ] **Step 2: Run focused tests and verify missing-token failures**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/secondary-ui-contract.spec.js
```

Expected: failures name the seven missing semantic material variables and old solid background rules.

- [ ] **Step 3: Derive all material roles centrally**

In `deriveSecondaryThemeTokens`, derive exact color stops from the optional palette fields, with existing colors as fallbacks. Add:

```js
const pageDot = expandHex(theme['page-dot'], mix(primary, page, 0.58))
const cardStart = expandHex(theme['card-start'], surfaceElevated)
const cardMid = expandHex(theme['card-mid'], surfaceSoft)
const cardEnd = expandHex(theme['card-end'], surfaceInset)
const panelStart = expandHex(theme['panel-start'], mix(cardStart, page, 0.18))
const panelMid = expandHex(theme['panel-mid'], mix(cardMid, page, 0.16))
const panelEnd = expandHex(theme['panel-end'], mix(cardEnd, page, 0.14))
const flatBackground = expandHex(theme.flat, surfaceInset)
const topbarStart = expandHex(theme['topbar-start'], primary)
const topbarMid = expandHex(theme['topbar-mid'], mix(primary, primaryAlt, 0.5))
const topbarEnd = expandHex(theme['topbar-end'], primaryAlt)
const pageBackground = `radial-gradient(circle at 1px 1px, ${darkSurface ? 'rgba(83, 107, 138, 0.18)' : 'rgba(83, 126, 178, 0.30)'} 1px, transparent 1.2px), linear-gradient(180deg, ${page} 0%, ${mix(page, surface, 0.12)} 100%)`
const topbarBackground = `linear-gradient(100deg, ${topbarStart} 0%, ${topbarMid} 52%, ${topbarEnd} 100%)`
const controlBackground = `linear-gradient(145deg, ${cardStart} 0%, ${cardMid} 100%)`
const cardBackground = darkSurface
  ? `radial-gradient(110% 90% at 15% 0%, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.04) 35%, transparent 72%), linear-gradient(150deg, ${cardStart} 0%, ${cardMid} 58%, ${cardEnd} 100%)`
  : `radial-gradient(110% 90% at 15% 0%, #FFFFFF 0%, rgba(255, 255, 255, 0.82) 35%, transparent 72%), linear-gradient(150deg, ${cardStart} 0%, ${cardMid} 58%, ${cardEnd} 100%)`
const panelBackground = `linear-gradient(150deg, ${panelStart} 0%, ${panelMid} 58%, ${panelEnd} 100%)`
const overlayBackground = darkSurface
  ? `linear-gradient(150deg, ${cardStart} 0%, ${cardMid} 52%, ${cardEnd} 100%)`
  : cardBackground
```

Return these values from the token object. Keep `pageDot` local so the unused-variable lint rule does not fail: use it when constructing `pageBackground` by converting it to RGB or remove it and construct the rgba value from the approved constants. Prefer a small `hexToRgba(hex, alpha)` helper and use `hexToRgba(pageDot, darkSurface ? 0.18 : 0.30)`.

Use restrained Glacier shadows with cool blue-gray alpha; the card shadow must be visibly softer than the current Aurora double-lift. Keep the existing aliases `shadowControl`, `shadowCard`, and `shadowOverlay`.

- [ ] **Step 4: Apply the shared L0-L3/flat contracts**

Update `secondary-ui.styl` so every level has a solid `background-color` fallback followed by its semantic `background-image`:

```stylus
.sp-level-0
  color var(--sp-text)
  background-color var(--sp-page)
  background-image var(--sp-page-background)

.sp-level-1
  color var(--sp-text)
  background-color var(--sp-surface)
  background-image var(--sp-control-background)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-control)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-control)

.sp-level-2,
.sp-card
  color var(--sp-text)
  background-color var(--sp-surface-elevated)
  background-image var(--sp-card-background)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-card)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-card)

.sp-level-3
  color var(--sp-text)
  background-color var(--sp-surface-elevated)
  background-image var(--sp-overlay-background)
  border 1px solid var(--sp-border-strong)
  border-radius var(--sp-radius-overlay)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-overlay)

.sp-flat-data
  color var(--sp-text)
  background-color var(--sp-flat-background)
  background-image none
  border 1px solid var(--sp-border)
  box-shadow none
```

Preserve reduced-motion, nested-card shadow suppression, focus-visible, semantic statuses, and scoped Ant control rules.

- [ ] **Step 5: Run focused tests and commit**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js
git add src/client/common/ui-theme-tokens.js src/client/css/includes/secondary-ui.styl test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js
git commit -m "feat(ui): add glacier silver surface tokens"
```

Expected: exact light gradient, dark companion, fallback, contrast, and serialization tests pass.

---

### Task 3: Restyle the latest-client shell without changing geometry

**Files:**

- Modify: `components/main/aigshell-topbar.styl`, `wrapper.styl`, `term-fullscreen.styl`
- Modify: `components/sidebar/sidebar.styl`, `components/side-panel-r/right-side-panel.styl`
- Modify: `components/tabs/tabs.styl`, `components/tabs/add-btn.styl`
- Modify: `components/footer/footer.styl`, `components/layout/layout.styl`
- Modify: `test/unit-ci/glacier-silver-ui-style-contract.spec.js`
- Modify: `test/unit-ci/secondary-ui-contract.spec.js`

- [ ] **Step 1: Add failing shell contracts**

Create `glacier-silver-ui-style-contract.spec.js` with Stylus compilation and source assertions that:

- `.aigshell-topbar` uses `var(--sp-topbar-background)`.
- `.aigshell-topbar-actions`, `.window-controls`, and their idle children do not introduce a gray or white strip.
- topbar height remains `44px`, sidebar width remains `72px`, and the right panel still starts at `top 44px`.
- `.right-side-panel` uses `--sp-panel-background`; tabs/footer remain compact.
- no topbar action order or width breakpoint changed in JSX/Stylus.

- [ ] **Step 2: Run the shell contracts and confirm old solid-surface failures**

```powershell
node --test test/unit-ci/glacier-silver-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js
```

- [ ] **Step 3: Apply the continuous top color band**

Use this exact topbar surface pattern:

```stylus
.aigshell-topbar
  background-color #306290
  background-image var(--sp-topbar-background)
  border-bottom 1px solid rgba(255, 255, 255, 0.20)
  box-shadow 0 8px 22px rgba(38, 63, 99, 0.18)

.aigshell-topbar-actions,
.window-controls
  background transparent

.aigshell-topbar-action,
.window-control
  color rgba(255, 255, 255, 0.90)
  background rgba(255, 255, 255, 0.08)
  border 1px solid rgba(255, 255, 255, 0.18)

.aigshell-topbar-action:hover,
.window-control:hover
  background rgba(255, 255, 255, 0.16)
  border-color rgba(255, 255, 255, 0.34)
```

Keep close-button danger hover, the existing 30px action size, 46×44 window controls, wide/narrow label rules, scroll behavior, and draggable regions.

- [ ] **Step 4: Apply shell surfaces by depth**

- Main canvas: page background token.
- Left rail and expandable side panel: panel gradient on the outer shell; nav rows remain controls, not cards.
- Active left-nav item: cool-silver control with purple text/focus, no size change.
- Right AI shell: panel gradient with existing rounded-left geometry and resize affordance.
- Tabs and footer: flat silver strips with selected tab as a control surface; no per-tab large shadow.
- Fullscreen and split layout: preserve all dimensions and hit areas.

- [ ] **Step 5: Run shell tests and commit**

```powershell
node --test test/unit-ci/glacier-silver-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/ui-accessibility-contract.spec.js
git add src/client/components/main/aigshell-topbar.styl src/client/components/main/wrapper.styl src/client/components/main/term-fullscreen.styl src/client/components/sidebar/sidebar.styl src/client/components/side-panel-r/right-side-panel.styl src/client/components/tabs/tabs.styl src/client/components/tabs/add-btn.styl src/client/components/footer/footer.styl src/client/components/layout/layout.styl test/unit-ci/glacier-silver-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js
git commit -m "style(ui): unify glacier silver client shell"
```

---

### Task 4: Restyle shared controls, menus, notifications, and overlays

**Files:**

- Modify: `components/common/modal.styl`, `drawer.styl`, `context-menu.styl`
- Modify: `components/common/message.styl`, `notification.styl`, `input-confirm-common.styl`
- Modify: `components/common/drag-handle.styl`, `remote-float-control.styl`, `lazy-module-boundary.styl`, `markdown.styl`
- Modify: `components/sys-menu/sys-menu.styl`
- Modify: `test/unit-ci/glacier-silver-ui-style-contract.spec.js`

- [ ] **Step 1: Add failing overlay and row-density contracts**

Assert modal/drawer/popover/menu outer containers use `--sp-overlay-background`, while dropdown/menu/message rows have `box-shadow none`. Assert focus-visible controls use `--sp-shadow-focus`, danger actions use semantic danger tokens, and reduced-motion rules cover lift transitions.

- [ ] **Step 2: Apply the shared overlay hierarchy**

Map surfaces consistently:

- Modal and Drawer outer content: overlay background, overlay radius/shadow.
- Popover/Dropdown/System menu: overlay background; menu items remain flat rows with hover/selected fills.
- Message/Notification: card background and card shadow; semantic icon/color remains success/info/warning/danger.
- Tooltip and confirm controls: control surface; no nested panel shadow.
- Markdown code/table bodies: flat data surface; no gradient inside code blocks.
- Drag handles and remote float controls: control surface with visible focus and unchanged hit area.

- [ ] **Step 3: Compile and run focused overlay E2E**

```powershell
node --test test/unit-ci/glacier-silver-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js
npx playwright test test/e2e/020.context-menu-ant6-layout.spec.js test/e2e/021.secondary-ui-state.spec.js --workers=1
```

Expected: overlays preserve Escape/background isolation/focus restoration and have no new overflow.

- [ ] **Step 4: Commit shared overlay work**

```powershell
git add src/client/components/common/modal.styl src/client/components/common/drawer.styl src/client/components/common/context-menu.styl src/client/components/common/message.styl src/client/components/common/notification.styl src/client/components/common/input-confirm-common.styl src/client/components/common/drag-handle.styl src/client/components/common/remote-float-control.styl src/client/components/common/lazy-module-boundary.styl src/client/components/common/markdown.styl src/client/components/sys-menu/sys-menu.styl test/unit-ci/glacier-silver-ui-style-contract.spec.js
git commit -m "style(ui): cardize shared overlays and controls"
```

Before committing, inspect `git diff --cached --name-only`; only the named common style directory files, sys-menu style, and contract test may be staged.

---

### Task 5: Restyle connection, fleet, artifacts, and incidents workspaces

**Files:**

- Modify: `components/tabs/no-session.styl`, `quick-connect.styl`
- Modify: `components/bookmark-form/bookmark-form.styl`, `common/bookmark-group-picker.styl`, `common/color-picker.styl`
- Modify: `components/tree-list/tree-list.styl`, `bookmark-import-strategy-dialog.styl`
- Modify: `components/session/session.styl`, `components/ssh-config/ssh-config.styl`
- Modify: `components/fleet-status/fleet-status.styl`, `fleet-service-selector.styl`
- Modify: `components/artifacts/artifacts.styl`, `components/incidents/incidents.styl`
- Modify: `test/unit-ci/aurora-ui-style-contract.spec.js`
- Modify: `test/unit-ci/glacier-silver-ui-style-contract.spec.js`

- [ ] **Step 1: Write failing per-workspace surface contracts**

Assert:

- home action cards use `--sp-card-background`; recents outer panel uses `--sp-panel-background`; recent rows remain flat;
- quick-connect/bookmark grouped forms use panel/card surfaces without changing form order;
- tree/session/SSH-config rows have no card shadow;
- fleet toolbar/summary and artifact/incident outer panes use semantic card/panel backgrounds;
- fleet table rows, artifact list rows, incident list rows, and history rows remain flat.

- [ ] **Step 2: Apply home and connection surfaces**

Keep current v0.4.31 copy and structure. Use card backgrounds for entry actions and connection summaries; use flat data surfaces for recent connections, server trees, session history, key lists, and SSH-config rows. Preserve the current primary-action brand gradient and all compact breakpoints.

- [ ] **Step 3: Apply fleet, artifact, and incident surfaces**

Use panel backgrounds only on page/preview/list containers and card backgrounds on summaries/empty states/action cards. Keep tables, editors, virtual rows, artifact content pages, and incident activities dense. Do not edit `artifact-card.jsx`, `artifact-card-state.js`, `006.ai-chat.spec.js`, or `ai-artifact-chat-ui.spec.js`.

- [ ] **Step 4: Run workspace tests**

```powershell
node --test test/unit-ci/no-session-home.spec.js test/unit-ci/fleet-status-ui.spec.js test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js
npx playwright test test/e2e/007.basic.bookmarks.spec.js test/e2e/022.session-history.spec.js test/e2e/023.fleet-status.spec.js test/e2e/025.fleet-service-selector.spec.js test/e2e/034.incident-archive-foundation.spec.js --workers=1
```

Expected: all interactions pass, selected rows remain identifiable, and no workspace gains horizontal overflow.

- [ ] **Step 5: Commit only named styles/tests**

```powershell
git add src/client/components/tabs/no-session.styl src/client/components/tabs/quick-connect.styl src/client/components/bookmark-form/bookmark-form.styl src/client/components/bookmark-form/common/bookmark-group-picker.styl src/client/components/bookmark-form/common/color-picker.styl src/client/components/tree-list/tree-list.styl src/client/components/tree-list/bookmark-import-strategy-dialog.styl src/client/components/session/session.styl src/client/components/ssh-config/ssh-config.styl src/client/components/fleet-status/fleet-status.styl src/client/components/fleet-status/fleet-service-selector.styl src/client/components/artifacts/artifacts.styl src/client/components/incidents/incidents.styl test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js
git commit -m "style(ui): cardize connection and core workspaces"
```

---

### Task 6: Restyle dense operation workspaces while protecting flat data

**Files:**

- Modify: `components/terminal/terminal.styl`, `terminal-command-safety-modal.styl`, `term-search.styl`
- Modify: `components/sftp/sftp.styl`, `address-bookmark.styl`, `transfer-tag.styl`
- Modify: `components/sidebar/transfer.styl`, `transfer-history.styl`, `components/file-transfer/transfer.styl`
- Modify: `components/operations-toolkit/workspace/operations-workspace.styl`
- Modify: `components/quick-commands/qm.styl`
- Modify: `components/ssh-tunnel/ssh-tunnel-modal.styl`
- Modify: `components/server-status/server-status-modal.styl`
- Modify: `components/main/safety-operation-center-modal.styl`, `safety-task-progress.styl`
- Modify: `test/unit-ci/secondary-ui-contract.spec.js`, `aurora-ui-style-contract.spec.js`, `glacier-silver-ui-style-contract.spec.js`

- [ ] **Step 1: Strengthen protected dense-surface tests before styling**

Extend the compiled-CSS guard so selectors containing any of the following cannot use card/panel/overlay background variables or semantic elevation shadows:

```js
const protectedDenseSelector = /(?:\.xterm(?:-screen|-viewport)?|\.term-wrap|\.sftp-item|tbody\s+tr|\.batch-op-log-entry|\.operations-history\s+article|\.incident-list-item|\.ssh-tunnel-history-item|\.agent-tool-output|\.ai-file-change-diff)/i
```

Allow row hover/selected background colors and thin separators. Keep terminal frame selectors outside this protected set.

- [ ] **Step 2: Verify the stronger guard fails where old elevation leaks remain**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js
```

- [ ] **Step 3: Apply outer-card/inner-flat rules**

- Terminal: panel frame only; xterm canvas, viewport, search result body, and terminal output unchanged.
- SFTP: local/remote section shells and safety summaries use panel/card roles; headers and file rows are flat.
- Transfer: queue/history outer surface is overlay/panel; transfer entries and progress rows stay flat.
- Operations Toolkit: workspace/head/recommended flow/detail use panel/card roles; tool grid contents, history, task steps, logs, and command output remain compact.
- SSH tunnels/server status/safety center: modal shell and summaries use overlay/card roles; history, diagnostics, transaction logs, and task progress rows remain flat.
- Quick commands: popup shell and parameter groups use overlay/card roles; command/history rows remain flat.

- [ ] **Step 4: Run dense-workspace regression tests**

```powershell
node --test test/unit-ci/operations-workspace-style.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js
npx playwright test test/e2e/008.basic.file-manager.spec.js test/e2e/008.basic-terminal.spec.js test/e2e/018.file-transfer.spec.js test/e2e/023.batch-op.spec.js test/e2e/032.operations-toolkit.spec.js test/e2e/033.ssh-tunnel-manager.spec.js test/e2e/006.server-status.spec.js --workers=1
```

Expected: operation behavior is unchanged; no protected dense selector receives gradient/elevation; short viewport remains usable.

- [ ] **Step 5: Commit dense workspace styles**

```powershell
git add src/client/components/terminal/terminal.styl src/client/components/terminal/terminal-command-safety-modal.styl src/client/components/terminal/term-search.styl src/client/components/sftp/sftp.styl src/client/components/sftp/address-bookmark.styl src/client/components/sftp/transfer-tag.styl src/client/components/sidebar/transfer.styl src/client/components/sidebar/transfer-history.styl src/client/components/file-transfer/transfer.styl src/client/components/operations-toolkit/workspace/operations-workspace.styl src/client/components/quick-commands/qm.styl src/client/components/ssh-tunnel/ssh-tunnel-modal.styl src/client/components/server-status/server-status-modal.styl src/client/components/main/safety-operation-center-modal.styl src/client/components/main/safety-task-progress.styl test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js
git commit -m "style(ui): preserve dense operation surfaces"
```

---

### Task 7: Restyle the complete v0.4.31 AI panel and AI overlays

**Files:**

- Modify: `components/ai/ai.styl`, `agent-skill-manager.styl`, `agent-task-runner.styl`, `ai-file-change-review-modal.styl`
- Modify: `components/side-panel-r/right-side-panel.styl` only if the Task 3 shell lacks an AI-specific state
- Modify: `test/unit-ci/aurora-ui-style-contract.spec.js`, `glacier-silver-ui-style-contract.spec.js`

- [ ] **Step 1: Add failing AI state contracts**

Cover the AI header/config block, model status, empty/loading/error states, chat bubbles, attachment cards, composer, action groups, agent/task/skill panels, file-change review shell, code/tool output, and disabled controls. Require panel/card/control roles on outer surfaces and flat roles on tool output, code, diff, and task logs.

- [ ] **Step 2: Apply the AI hierarchy without changing AI behavior**

Use:

- right panel shell and configuration groups: panel background;
- user/assistant message containers, attachment/document cards, task/skill cards: card background;
- composer and compact controls: control background;
- tool output, generated command/code, diff bodies, terminal/file excerpts: flat background and no shadow;
- status/error/warning: existing semantic tokens and icons;
- no changes to upload, paste, drag/drop, attachment removal, model selection, takeover, terminal/file/web references, send, or agent switching.

Do not edit the dirty AI chat E2E/unit files named in the guard. Run them as regression evidence only.

- [ ] **Step 3: Run AI unit/style/Electron regression**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js test/unit-ci/ai-artifact-chat-ui.spec.js
npx playwright test test/e2e/005.ai-config.spec.js test/e2e/006.ai-chat.spec.js test/e2e/006.ai-explain.spec.js test/e2e/026.agent-skill-manager.spec.js test/e2e/026.ai-takeover.spec.js --workers=1
```

Expected: existing dirty tests are unmodified and pass against the new styles; AI panel has no clipping at its minimum width.

- [ ] **Step 4: Commit only AI styles and style contracts**

```powershell
git add src/client/components/ai/ai.styl src/client/components/ai/agent-skill-manager.styl src/client/components/ai/agent-task-runner.styl src/client/components/ai/ai-file-change-review-modal.styl src/client/components/side-panel-r/right-side-panel.styl test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js
git diff --cached --name-only
git commit -m "style(ui): restyle the v031 AI workspace"
```

Expected staged output must not contain `006.ai-chat.spec.js`, `ai-artifact-chat-ui.spec.js`, artifact JSX, or artifact state.

---

### Task 8: Restyle settings, support, widgets, authentication, and remote clients

**Files:**

- Modify: `components/setting-panel/setting-wrap.styl`, `setting.styl`, `list.styl`, `ui-font-picker.styl`
- Modify: `components/theme/theme-gallery.styl`, `theme-form.styl`, `terminal-theme-list.styl`
- Modify: `components/main/help-center-modal.styl`, `update-center-modal.styl`, `upgrade.styl`, `crash-recovery-notice.styl`
- Modify: `components/sidebar/info.styl`, `components/terminal-info/terminal-info.styl`, `components/footer/cmd-history.styl`
- Modify: `components/widgets/widgets.styl`, `components/auth/login.styl`
- Modify: `components/rdp/rdp.styl`, `components/vnc/vnc.styl`, `components/spice/spice.styl`
- Modify: `test/unit-ci/aurora-ui-style-contract.spec.js`, `glacier-silver-ui-style-contract.spec.js`

- [ ] **Step 1: Add failing coverage for every remaining visible surface**

Assert settings shell/header/rail/groups/theme cards/font cards use semantic roles; settings fields remain grouped rather than becoming one card per field. Assert help/update/about/log/model API/backup-sync shells use overlay/panel roles. Assert widget cards use card roles. Assert login and remote-client chrome use panel/control roles while RDP/VNC/Spice canvases remain flat and unfiltered.

- [ ] **Step 2: Apply settings and theme gallery styles**

Keep current top search, first-level tabs, left catalog, grouped forms, theme preview behavior, editor fields, labels, and tab order. New Glacier/Graphite cards must show localized names and mode badges through existing theme metadata. Do not change setting persistence or terminal theme preview behavior.

- [ ] **Step 3: Apply support, widgets, login, and remote-client styles**

Use overlay/panel/card roles only on outer visible shells. Keep logs, command history, update details, widget activity rows, and remote pixel canvases flat. Preserve connection controls and focus order.

- [ ] **Step 4: Run focused tests**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js
npx playwright test test/e2e/009.basic.themes.spec.js test/e2e/009.3.upgrade.check.spec.js test/e2e/009.4.upgrade.check.spec.js test/e2e/021.cmd-history.spec.js test/e2e/006.terminal-info.spec.js test/e2e/setting-bookmarks-compact-layout.spec.js test/e2e/setting-themes-compact-layout.spec.js --workers=1
```

- [ ] **Step 5: Commit secondary surfaces**

```powershell
git add src/client/components/setting-panel/setting-wrap.styl src/client/components/setting-panel/setting.styl src/client/components/setting-panel/list.styl src/client/components/setting-panel/ui-font-picker.styl src/client/components/theme/theme-gallery.styl src/client/components/theme/theme-form.styl src/client/components/theme/terminal-theme-list.styl src/client/components/main/help-center-modal.styl src/client/components/main/update-center-modal.styl src/client/components/main/upgrade.styl src/client/components/main/crash-recovery-notice.styl src/client/components/sidebar/info.styl src/client/components/terminal-info/terminal-info.styl src/client/components/footer/cmd-history.styl src/client/components/widgets/widgets.styl src/client/components/auth/login.styl src/client/components/rdp/rdp.styl src/client/components/vnc/vnc.styl src/client/components/spice/spice.styl test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js
git commit -m "style(ui): restyle settings and support surfaces"
```

---

### Task 9: Enforce full-client style ownership and prevent gradient drift

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/glacier-silver-ui-style-contract.spec.js`

- [ ] **Step 1: Add a complete Stylus inventory contract**

Recursively enumerate `src/client/components/**/*.styl`. For every component style except structural primitives `components/common/highlight.styl`, `components/common/logo.styl`, and `components/icons/ai-icon.styl`, require at least one `var(--sp-...)` reference. Compile every component style with Stylus.

Add a centralization assertion that component styles do not contain any approved material stop or copied diffuse-gradient definition:

```js
const copiedMaterialPattern = /#F6FAFC|#EAF1F6|#DCE6EE|#2A3543|#202A37|#18212C|radial-gradient\(110% 90% at 15% 0%/i
```

Allow these constants only in `common/shellpilot-ui-palettes.js`, `common/ui-theme-tokens.js`, and tests.

- [ ] **Step 2: Run the inventory and fix every reported omission**

```powershell
node --test test/unit-ci/glacier-silver-ui-style-contract.spec.js
```

No uncovered visible style is expected after Tasks 3–8. If the test reports one, return to its owning task, add the semantic token in that named owner file, run that task's focused tests, and make a separately reviewed style commit before continuing. Do not add a high-priority global override file. Add a file to the explicit three-file primitive exception set only after source inspection proves it has no visible container.

- [ ] **Step 3: Run all style contracts together**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: all component Stylus files compile; gradients are centralized; dense-surface protection passes.

- [ ] **Step 4: Commit the coverage gate**

```powershell
git add test/unit-ci/glacier-silver-ui-style-contract.spec.js
git diff --cached --name-only
git commit -m "test(ui): enforce glacier silver client coverage"
```

Before committing, unstage any file outside this plan. Never use `git add -A` or `git add .`.

---

### Task 10: Update theme E2E and run the visual acceptance matrix

**Files:**

- Modify: `test/e2e/009.basic.themes.spec.js`
- Modify: `test/e2e/022.secondary-ui-visual-matrix.spec.js`
- Modify: `test/e2e/026.primary-workspace-regression.spec.js`
- Create: `test/e2e/037.glacier-silver-client-visual.spec.js`
- Update snapshots only for `test/e2e/026.primary-workspace-regression.spec.js-snapshots/`
- Generate uncommitted evidence under `release-verification/glacier-silver-card-ui-2026-08-04/`

- [ ] **Step 1: Add failing end-to-end theme assertions**

In `009.basic.themes.spec.js`, assert a fresh isolated config uses `shellpilot-glacier`, the gallery contains both new IDs, clicking the topbar toggle selects `shellpilot-graphite-silver`, clicking again returns to `shellpilot-glacier`, and `terminalTheme` remains unchanged.

In `037.glacier-silver-client-visual.spec.js`, assert:

- topbar computed background image is one continuous linear gradient;
- actions/window controls have transparent parent bands and visible focus;
- Glacier card computed background includes both radial and linear gradients;
- Graphite card uses the dark three-stop range;
- xterm, SFTP rows, logs, and task output have no card/panel shadow;
- no document-level horizontal overflow in both themes.

- [ ] **Step 2: Expand the existing matrix to the approved coverage**

Set the matrix constants in `022.secondary-ui-visual-matrix.spec.js` to:

```js
const sizes = [
  { width: 590, height: 400 },
  { width: 920, height: 600 },
  { width: 1100, height: 700 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 }
]
const zooms = [0.75, 1, 1.25, 1.5, 2]
const languages = ['zh_cn', 'en_us']
const themeIds = [
  'shellpilot-glacier',
  'shellpilot-graphite-silver',
  'shellpilot-ocean',
  'shellpilot-jade',
  'shellpilot-indigo',
  'shellpilot-amber',
  'shellpilot-graphite'
]
```

Update `026.primary-workspace-regression.spec.js` to replace legacy default/defaultLight visual rows with Glacier/Graphite Silver rows at the same dimensions, then regenerate only its Windows snapshots after inspecting the resulting diffs.

- [ ] **Step 3: Run a smoke matrix first**

```powershell
$env:SHELLPILOT_VISUAL_MATRIX_SMOKE = '1'
npx playwright test test/e2e/009.basic.themes.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/026.primary-workspace-regression.spec.js test/e2e/037.glacier-silver-client-visual.spec.js --workers=1
Remove-Item Env:SHELLPILOT_VISUAL_MATRIX_SMOKE
```

Expected: new-install default, pair toggle, screenshot state, focus, and overflow smoke checks pass.

- [ ] **Step 4: Run the full approved matrix**

```powershell
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/026.primary-workspace-regression.spec.js test/e2e/037.glacier-silver-client-visual.spec.js --workers=1
```

Expected matrix includes both new themes, Chinese/English, all five dimensions, 75–200% zoom, and default/hover/focus/selected/disabled/loading/empty/success/warning/error states. `SECONDARY_VISUAL_FAILURES=0` and `SECONDARY_OVERFLOW_ADDED=0` must be present.

- [ ] **Step 5: Capture and inspect visual evidence**

Save representative current-client screenshots for home, connected shell, terminal, SFTP, AI panel, settings, operations toolkit, server status, safety center, modal/drawer/menu, artifacts, incidents, widgets, login, and remote-client chrome in both Glacier and Graphite modes. Use identical viewport/state pairs for comparison. Record every P0/P1/P2 issue and fix it before continuing; P3 may remain as a documented polish item.

- [ ] **Step 6: Commit E2E and approved snapshots, not generated evidence**

```powershell
git add test/e2e/009.basic.themes.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/026.primary-workspace-regression.spec.js test/e2e/037.glacier-silver-client-visual.spec.js test/e2e/026.primary-workspace-regression.spec.js-snapshots
git commit -m "test(ui): verify glacier silver visual matrix"
```

Keep `release-verification/glacier-silver-card-ui-2026-08-04/` uncommitted unless the repository's release policy explicitly requires binary evidence.

---

### Task 11: Full regression, design QA, and scope audit

**Files:**

- Modify: `apps/electerm-agent/design-qa.md`
- No additional production files unless a failing gate identifies an in-scope regression.

- [ ] **Step 1: Run all unit tests**

```powershell
npm run test-unit-ci
```

Expected: zero failures. Do not hide existing warnings or change unrelated tests.

- [ ] **Step 2: Run the applicable Electron regression suite**

```powershell
npx playwright test test/e2e/020.context-menu-ant6-layout.spec.js test/e2e/021.secondary-ui-state.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/023.fleet-status.spec.js test/e2e/025.fleet-service-selector.spec.js test/e2e/026.agent-skill-manager.spec.js test/e2e/026.ai-takeover.spec.js test/e2e/026.primary-workspace-regression.spec.js test/e2e/027.quality-core-flows.spec.js test/e2e/032.operations-toolkit.spec.js test/e2e/033.ssh-tunnel-manager.spec.js test/e2e/034.incident-archive-foundation.spec.js test/e2e/035.v0427-ui-accessibility.spec.js test/e2e/037.glacier-silver-client-visual.spec.js test/e2e/setting-bookmarks-compact-layout.spec.js test/e2e/setting-themes-compact-layout.spec.js --workers=1
```

Expected: zero failures. Real-server tests are not part of this visual-only acceptance unless credentials are already configured.

- [ ] **Step 3: Run lint, production build, and whitespace checks**

```powershell
npm run lint
npm run build
git diff --check
```

Expected: lint/build pass; only pre-existing documented bundle-size warnings are acceptable; no whitespace errors.

- [ ] **Step 4: Perform a protected-file and scope audit**

```powershell
git diff --name-only HEAD~9..HEAD
git status --short
git log --oneline --decorate -12
```

Verify:

- no changes to artifact JSX/state or the dirty AI tests;
- no business/store/API/state files except `config-default.js`, `ui-theme-pairing.js`, palette/tokens/i18n, and the topbar's minimal pairing call;
- no duplicated approved gradient constants in component styles;
- no layout/action order changes;
- generated evidence is the only expected untracked output in the isolated worktree.

- [ ] **Step 5: Update `design-qa.md` with measured evidence**

Add a new top section titled `ShellPilot v0.4.31 Glacier Silver Card UI Design QA` containing:

- source design spec and implementation commit range;
- exact screenshot directory and inspected surfaces;
- matrix dimensions, zooms, languages, themes, and state coverage;
- unit/Electron/lint/build results with actual counts;
- explicit confirmation that outer cards are cool-silver gradients, topbar is continuous, and dense inner data stays flat;
- P0/P1/P2 finding list, which must be empty before pass;
- final line exactly `final result: passed` only after every required gate succeeds.

- [ ] **Step 6: Commit QA documentation**

```powershell
git add design-qa.md
git commit -m "docs(ui): record glacier silver design QA"
```

- [ ] **Step 7: Invoke `superpowers:verification-before-completion`**

Re-run any command the verification skill requires. Report actual command results and screenshot evidence; do not claim completion from earlier output alone.

---

## Final acceptance checklist

- [ ] Fresh install defaults to `shellpilot-glacier`; existing persisted theme selection is not overwritten.
- [ ] Topbar brand/status/actions/window controls form one uninterrupted blue-purple band.
- [ ] Glacier cards visibly read as soft cool silver, not pure white and not hard metallic.
- [ ] Graphite Silver is a purpose-built dark companion and toggles back to Glacier Silver.
- [ ] All existing five built-in themes and custom terminal palettes remain available.
- [ ] Current v0.4.31 layout, action order, labels, focus order, and workflows are unchanged.
- [ ] Terminal, SFTP rows, tables, logs, history, task output, code, and diffs remain compact and flat.
- [ ] Settings, AI, help/update, widgets, all overlays, and remote-client chrome use the same semantic surface system.
- [ ] 590×400 through 1920×1080 and 75–200% zoom have no new horizontal overflow or clipped critical actions.
- [ ] Chinese/English, light/dark, focus/disabled/loading/empty/success/warning/error states pass.
- [ ] Unit, Electron, lint, build, screenshot review, design QA, and scope audit all pass.
- [ ] No unrelated dirty file is staged or committed.
