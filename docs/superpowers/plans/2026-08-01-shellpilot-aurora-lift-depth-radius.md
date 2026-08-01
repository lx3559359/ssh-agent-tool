# ShellPilot Aurora Lift Depth And Radius Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current soft-glow Aurora treatment with visibly strong dual-layer elevation and increase semantic radii across every ShellPilot card, frame, toolbar, modal, input, select, and button without changing functionality.

**Architecture:** Update the existing semantic radius and shadow tokens first, then migrate remaining visual hard-codes through existing Stylus selectors. Keep dense data rows and the terminal canvas at L0, apply L1 to controls, L2 to cards/toolbars, and L3 to main frames/overlays. Production changes are limited to `ui-theme-tokens.js` and Stylus; tests, design QA, and generated preview evidence remain separate.

**Tech Stack:** Electron 41, React 19, Ant Design 6, Stylus 0.64, Node.js test runner, StandardJS, Playwright 1.61.1, Codex Desktop image inspection.

---

## Approved sources and execution boundary

- Design specification: `docs/superpowers/specs/2026-08-01-shellpilot-aurora-lift-depth-radius-design.md`
- Existing Aurora specification: `docs/superpowers/specs/2026-08-01-shellpilot-aurora-ui-modernization-design.md`
- Selected visual target: B · Aurora Lift in `.superpowers/brainstorm/93-1785565102/content/aurora-depth-options.html`
- Existing coded screenshot baseline: `release-verification/aurora-ui-2026-08-01/*.png`
- New generated screenshot evidence: `release-verification/aurora-lift-2026-08-01/*.png` (do not commit)
- Worktree root: `F:\SSH工具开发\ui-modernization-worktree`
- App root: `F:\SSH工具开发\ui-modernization-worktree\apps\electerm-agent`
- Branch: `codex/ui-modernization`

No production JSX, TS, route, Store, IPC, persistence, SSH, SFTP, terminal behavior, AI behavior, safety, updater, or operations execution file is authorized. If an existing selector cannot express a requested treatment, leave that treatment unchanged and record it in `design-qa.md`; do not add a wrapper or change component behavior.

## File responsibility map

Theme and shared contracts:

- `apps/electerm-agent/src/client/common/ui-theme-tokens.js`: exact light/dark dual-layer shadows and six semantic radius values.
- `apps/electerm-agent/src/client/css/includes/secondary-ui.styl`: shared L0–L3 surfaces and scoped Ant Design control rounding/elevation.
- `apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js`: exact token values, aliases, and CSS serialization.
- `apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js`: compilation and page-by-page radius/depth ownership.
- `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`: shared elevation, protected terminal, focus, and no-layout-shift contracts.

Application shell and daily workspaces:

- `components/main/aigshell-topbar.styl`, `components/common/modal.styl`, `components/sys-menu/sys-menu.styl`, `components/common/context-menu.styl`: top bar, custom modal, system menu, and context overlays.
- `components/tabs/no-session.styl`, `components/sidebar/sidebar.styl`, `components/tree-list/tree-list.styl`, `components/side-panel-r/right-side-panel.styl`, `components/ai/ai.styl`: connection workbench, side panels, server/history rows, and AI assistant.
- `components/terminal/terminal.styl`, `components/tabs/tabs.styl`, `components/footer/footer.styl`, `components/sftp/sftp.styl`, `components/sidebar/transfer.styl`, `components/quick-commands/qm.styl`: terminal/SFTP frames and quick-command overlays while preserving data rows and terminal rendering.

Data, settings, and specialist surfaces:

- `components/fleet-status/fleet-status.styl`, `components/fleet-status/fleet-service-selector.styl`, `components/artifacts/artifacts.styl`: Fleet and artifact frames/toolbars/cards.
- `components/setting-panel/setting-wrap.styl`, `components/setting-panel/setting.styl`, `components/setting-panel/list.styl`, `components/setting-panel/ui-font-picker.styl`, `components/theme/theme-gallery.styl`, `components/sidebar/info.styl`: settings, passwords, logs, font and theme cards.
- `components/operations-toolkit/workspace/operations-workspace.styl`, `components/incidents/incidents.styl`, `components/ssh-tunnel/ssh-tunnel-modal.styl`, `components/server-status/server-status-modal.styl`, `components/ai/agent-skill-manager.styl`: operations, incident archives, SSH tunnel, server status, and skill-management frames.

QA artifacts:

- `apps/electerm-agent/design-qa.md`: source-vs-build review and final pass/block state.
- `release-verification/aurora-lift-2026-08-01/`: uncommitted real-app screenshots for every page.

---

### Task 1: Make Aurora Lift radius and shadow tokens exact

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js:140-330`
- Modify: `apps/electerm-agent/src/client/common/ui-theme-tokens.js:99-151`

- [ ] **Step 1: Write the failing exact token assertions**

In `test/unit-ci/ui-theme-tokens.spec.js`, change the malformed-theme card-radius assertion to `22px`, then replace the radius/shadow portion of `derives Aurora light and dark depth without changing compatibility aliases` with:

```js
assert.deepEqual(
  [
    light.radiusSmall,
    light.radiusControl,
    light.radiusToolbar,
    light.radiusCard,
    light.radiusPanel,
    light.radiusOverlay
  ],
  ['10px', '14px', '18px', '22px', '28px', '28px']
)
assert.equal(
  light.shadowSm,
  '0 3px 0 -1px rgba(62, 58, 160, 0.16), 0 8px 18px rgba(62, 58, 160, 0.18)'
)
assert.equal(
  light.shadowMd,
  '0 6px 0 -2px rgba(73, 66, 196, 0.18), 0 18px 34px rgba(73, 66, 196, 0.26)'
)
assert.equal(
  light.shadowLg,
  '0 9px 0 -3px rgba(75, 66, 202, 0.20), 0 28px 56px rgba(75, 66, 202, 0.32)'
)
assert.equal(
  light.shadowFocus,
  '0 4px 0 -1px rgba(77, 70, 245, 0.22), 0 16px 30px rgba(77, 70, 245, 0.36)'
)
assert.equal(
  dark.shadowSm,
  '0 3px 0 -1px rgba(0, 0, 0, 0.52), 0 10px 20px rgba(0, 0, 0, 0.56), 0 0 0 1px rgba(138, 130, 255, 0.18)'
)
assert.equal(
  dark.shadowMd,
  '0 6px 0 -2px rgba(0, 0, 0, 0.58), 0 20px 38px rgba(0, 0, 0, 0.64), 0 0 0 1px rgba(138, 130, 255, 0.22)'
)
assert.equal(
  dark.shadowLg,
  '0 10px 0 -3px rgba(0, 0, 0, 0.64), 0 30px 60px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(138, 130, 255, 0.28)'
)
assert.equal(
  dark.shadowFocus,
  '0 4px 0 -1px rgba(0, 0, 0, 0.50), 0 16px 32px rgba(116, 109, 255, 0.42), 0 0 0 2px rgba(138, 130, 255, 0.30)'
)
assert.equal(light.shadowControl, light.shadowSm)
assert.equal(light.shadowCard, light.shadowMd)
assert.equal(light.shadowOverlay, light.shadowLg)
```

In the serialization test, require:

```js
assert.match(css, /--sp-radius-small: 10px;/)
assert.match(css, /--sp-radius-control: 14px;/)
assert.match(css, /--sp-radius-toolbar: 18px;/)
assert.match(css, /--sp-radius-card: 22px;/)
assert.match(css, /--sp-radius-panel: 28px;/)
assert.match(css, /--sp-radius-overlay: 28px;/)
```

- [ ] **Step 2: Run the token test and confirm RED**

Run from `apps/electerm-agent`:

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js
```

Expected: FAIL because the implementation still returns `8/10/14/18/18/18px` and the soft shadow strings.

- [ ] **Step 3: Implement the exact Aurora Lift tokens**

In `src/client/common/ui-theme-tokens.js`, replace the four shadow declarations with:

```js
const shadowSm = darkSurface
  ? '0 3px 0 -1px rgba(0, 0, 0, 0.52), 0 10px 20px rgba(0, 0, 0, 0.56), 0 0 0 1px rgba(138, 130, 255, 0.18)'
  : '0 3px 0 -1px rgba(62, 58, 160, 0.16), 0 8px 18px rgba(62, 58, 160, 0.18)'
const shadowMd = darkSurface
  ? '0 6px 0 -2px rgba(0, 0, 0, 0.58), 0 20px 38px rgba(0, 0, 0, 0.64), 0 0 0 1px rgba(138, 130, 255, 0.22)'
  : '0 6px 0 -2px rgba(73, 66, 196, 0.18), 0 18px 34px rgba(73, 66, 196, 0.26)'
const shadowLg = darkSurface
  ? '0 10px 0 -3px rgba(0, 0, 0, 0.64), 0 30px 60px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(138, 130, 255, 0.28)'
  : '0 9px 0 -3px rgba(75, 66, 202, 0.20), 0 28px 56px rgba(75, 66, 202, 0.32)'
const shadowFocus = darkSurface
  ? '0 4px 0 -1px rgba(0, 0, 0, 0.50), 0 16px 32px rgba(116, 109, 255, 0.42), 0 0 0 2px rgba(138, 130, 255, 0.30)'
  : '0 4px 0 -1px rgba(77, 70, 245, 0.22), 0 16px 30px rgba(77, 70, 245, 0.36)'
```

Replace the six radius return values with:

```js
radiusSmall: '10px',
radiusControl: '14px',
radiusToolbar: '18px',
radiusCard: '22px',
radiusPanel: '28px',
radiusOverlay: '28px',
```

Do not change colors, contrast calculation, token ordering, aliases, or motion values.

- [ ] **Step 4: Run GREEN verification and lint**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js
npx.cmd standard src/client/common/ui-theme-tokens.js test/unit-ci/ui-theme-tokens.spec.js
```

Expected: PASS; the terminal background invariant remains `#0E0F12`.

- [ ] **Step 5: Commit the token batch**

```powershell
git add src/client/common/ui-theme-tokens.js test/unit-ci/ui-theme-tokens.spec.js
git commit -m "style: strengthen Aurora Lift depth tokens"
```

---

### Task 2: Apply larger radii and L1–L3 depth to shared chrome

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`
- Modify: `apps/electerm-agent/src/client/css/includes/secondary-ui.styl`
- Modify: `apps/electerm-agent/src/client/components/main/aigshell-topbar.styl`
- Modify: `apps/electerm-agent/src/client/components/common/modal.styl`
- Modify: `apps/electerm-agent/src/client/components/sys-menu/sys-menu.styl`
- Modify: `apps/electerm-agent/src/client/components/common/context-menu.styl`
- Modify: `apps/electerm-agent/src/client/components/tabs/no-session.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/sidebar.styl`
- Modify: `apps/electerm-agent/src/client/components/tree-list/tree-list.styl`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel.styl`
- Modify: `apps/electerm-agent/src/client/components/ai/ai.styl`

- [ ] **Step 1: Add failing shared-radius contracts**

Add this helper to `test/unit-ci/aurora-ui-style-contract.spec.js`:

```js
function assertSelectorUsesRadius (source, selector, token) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  assert.match(
    source,
    new RegExp(`${escaped}[\\s\\S]{0,320}border-radius\\s+var\\(--sp-radius-${token}\\)`),
    `${selector} should use --sp-radius-${token}`
  )
}
```

Append:

```js
test('Aurora Lift shared chrome uses the approved radius hierarchy', () => {
  const shared = readClient('css/includes/secondary-ui.styl')
  const topbar = readClient('components/main/aigshell-topbar.styl')
  const modal = readClient('components/common/modal.styl')
  const home = readClient('components/tabs/no-session.styl')
  const panel = readClient('components/side-panel-r/right-side-panel.styl')
  const ai = readClient('components/ai/ai.styl')

  assertSelectorUsesRadius(shared, '.sp-level-1', 'small')
  assertSelectorUsesRadius(shared, '.sp-card', 'card')
  assertSelectorUsesRadius(shared, '.sp-level-3', 'overlay')
  assertSelectorUsesRadius(topbar, '.aigshell-topbar-action', 'control')
  assertSelectorUsesRadius(modal, '.custom-modal-content', 'overlay')
  assertSelectorUsesRadius(modal, '.custom-modal-ok-btn', 'control')
  assertSelectorUsesRadius(home, '.no-session-action', 'control')
  assertSelectorUsesRadius(home, '.no-session-recents', 'panel')
  assertSelectorUsesRadius(panel, '.right-side-panel', 'panel')
  assertSelectorUsesRadius(ai, '.ai-chat-input .ant-input', 'control')
  assertSelectorUsesRadius(ai, '.agent-tool-readonly-card', 'card')
})
```

Expand `styleFiles` with:

```js
'components/main/aigshell-topbar.styl',
'components/common/modal.styl',
'components/sys-menu/sys-menu.styl',
'components/common/context-menu.styl',
```

Keep `secondary-ui-contract.spec.js` assertions that reject terminal glyph shadows and `transform: translate`.

- [ ] **Step 2: Run the contracts and confirm RED**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js
```

Expected: FAIL on top-bar actions, custom-modal buttons, AI input, and AI readonly-card radius assertions.

- [ ] **Step 3: Add scoped L1 control treatment**

Append to `src/client/css/includes/secondary-ui.styl`:

```stylus
.sp-secondary-page,
.custom-modal-content,
.sidebar-panel,
.right-side-panel
  .ant-btn:not(.ant-btn-text):not(.ant-btn-link),
  .ant-input,
  .ant-input-affix-wrapper,
  .ant-input-number,
  .ant-picker,
  .ant-select-selector
    border-radius var(--sp-radius-control)
    box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-sm)

  .ant-btn:not(.ant-btn-text):not(.ant-btn-link):focus-visible,
  .ant-input:focus,
  .ant-input-affix-wrapper-focused,
  .ant-input-number-focused,
  .ant-picker-focused,
  .ant-select-focused .ant-select-selector
    box-shadow var(--sp-shadow-focus)
```

Do not apply this rule to text/link/icon-only controls, terminal canvas descendants, table rows, log rows, or file rows.

- [ ] **Step 4: Replace shared custom-control hard-codes**

Apply these exact mappings:

```text
aigshell-topbar.styl
  .aigshell-topbar-action                       -> radius-control + shadow-sm
  .aigshell-topbar-action-primary               -> shadow-focus

common/modal.styl
  .custom-modal-content                         -> radius-overlay + shadow-lg (retain)
  .custom-modal-close                           -> radius-control
  .custom-modal-ok-btn/.custom-modal-cancel-btn -> radius-control + shadow-sm

tabs/no-session.styl
  .no-session-action                            -> radius-control + shadow-focus (retain token use)
  .no-session-action-card                       -> radius-toolbar
  recent-session action buttons                 -> radius-control
  .no-session-recents                           -> radius-panel + shadow-lg

tree-list.styl
  sort popover shell                            -> radius-overlay + shadow-lg
  sort popover items                            -> radius-small
  group picker and tree selection frames        -> radius-control

ai/ai.styl
  panel buttons and icon buttons                -> radius-control
  .ai-chat-input .ant-input                     -> radius-control + shadow-md
  .agent-tool-readonly-card                     -> radius-card + shadow-md
  tool/result/error cards                       -> radius-card
  code/pre blocks                               -> radius-small
```

Keep `50%` and `999px` status dots/pills unchanged. Keep server/history/list rows flat even when selected.

- [ ] **Step 5: Compile and run shared regressions**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/aigshell-layout.spec.js test/unit-ci/connection-wizard-and-layout.spec.js test/unit-ci/ai-chat-layout.spec.js
npx.cmd standard test/unit-ci/aurora-ui-style-contract.spec.js
```

Expected: PASS with no terminal glyph shadow, no hover translation, and unchanged layout/feature inventories.

- [ ] **Step 6: Commit shared chrome**

```powershell
git add src/client/css/includes/secondary-ui.styl src/client/components/main/aigshell-topbar.styl src/client/components/common/modal.styl src/client/components/sys-menu/sys-menu.styl src/client/components/common/context-menu.styl src/client/components/tabs/no-session.styl src/client/components/sidebar/sidebar.styl src/client/components/tree-list/tree-list.styl src/client/components/side-panel-r/right-side-panel.styl src/client/components/ai/ai.styl test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js
git commit -m "style: round Aurora shared chrome and controls"
```

---

### Task 3: Round terminal, SFTP, transfer, and quick-command frames

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal.styl`
- Modify: `apps/electerm-agent/src/client/components/tabs/tabs.styl`
- Modify: `apps/electerm-agent/src/client/components/footer/footer.styl`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/transfer.styl`
- Modify: `apps/electerm-agent/src/client/components/quick-commands/qm.styl`

- [ ] **Step 1: Add failing terminal/SFTP/quick-command radius assertions**

Append:

```js
test('terminal SFTP and quick-command frames use Aurora Lift radii without carding rows', () => {
  const terminal = readClient('components/terminal/terminal.styl')
  const sftp = readClient('components/sftp/sftp.styl')
  const transfer = readClient('components/sidebar/transfer.styl')
  const commands = readClient('components/quick-commands/qm.styl')

  assertSelectorUsesRadius(terminal, '.terminal-workspace-layer', 'panel')
  assertSelectorUsesRadius(sftp, '.sftp-section', 'panel')
  assertSelectorUsesRadius(sftp, '.sftp-safety-summary', 'card')
  assertSelectorUsesRadius(transfer, '.transfer-list-card', 'overlay')
  assertSelectorUsesRadius(commands, '.qm-list-wrap', 'overlay')
  assertSelectorUsesRadius(commands, '.qm-command-param-section', 'card')
  assert.match(commands, /\.qm-list-wrap[\s\S]{0,260}var\(--sp-shadow-lg\)/)
  assert.match(sftp, /\.sftp-item[\s\S]{0,180}box-shadow none/)
  assert.doesNotMatch(terminal, /\.(?:xterm|xterm-screen|xterm-viewport)[^{\n]*[\s\S]{0,180}box-shadow/)
})
```

Add `components/quick-commands/qm.styl` to `styleFiles`.

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/sftp-navigation-ui.spec.js
```

Expected: FAIL because terminal outer frame, SFTP summary, and quick-command frames still use missing or hard-coded radii.

- [ ] **Step 3: Apply the frame/control mapping**

Use these exact declarations:

```stylus
.terminal-workspace-layer:not(.fleet-status-active):not(.artifacts-active):not(.incident-archives-active)
  border-radius var(--sp-radius-panel)
  box-shadow inset 0 0 0 1px var(--sp-border-strong), var(--sp-shadow-lg)

.sftp-section
  border-radius var(--sp-radius-panel)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-md)

.sftp-safety-summary,
.sftp-text-change-confirmation
  border-radius var(--sp-radius-card)
  box-shadow var(--sp-shadow-md)

.transfer-list-card.shellpilot-context-menu.shellpilot-transfer-history-popover
  border-radius var(--sp-radius-overlay)
  box-shadow var(--sp-shadow-lg)

.qm-list-wrap
  border-radius var(--sp-radius-overlay)
  box-shadow var(--sp-shadow-lg)

.qm-item,
.qm-command-param-item
  border-radius var(--sp-radius-control)

.qm-command-modal-context,
.qm-command-modal-tips,
.qm-command-param-section,
.qm-command-preview-wrap,
.qm-network-probe,
.qm-target-discovery,
.qm-rollback-preview
  border-radius var(--sp-radius-card)
  box-shadow var(--sp-shadow-md)
```

Keep `.qm-wrap-embedded` outer radius `0`, pill values `999px`, status dots `50%`, `.sftp-item` shadow `none`, and xterm descendants free of semantic shadows.

- [ ] **Step 4: Run terminal/SFTP behavior and style regressions**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js test/unit-ci/sftp-navigation-ui.spec.js
```

Expected: PASS; terminal theme, input, search, split, reconnect, file navigation, selection, transfer, and keyboard contracts remain unchanged.

- [ ] **Step 5: Commit the terminal/SFTP batch**

```powershell
git add src/client/components/terminal/terminal.styl src/client/components/tabs/tabs.styl src/client/components/footer/footer.styl src/client/components/sftp/sftp.styl src/client/components/sidebar/transfer.styl src/client/components/quick-commands/qm.styl test/unit-ci/aurora-ui-style-contract.spec.js
git commit -m "style: deepen terminal SFTP and command frames"
```

---

### Task 4: Round Fleet, artifacts, settings, passwords, logs, fonts, and themes

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/fleet-status-ui.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-artifact-ui.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/secondary-config-ui.spec.js`
- Modify: `apps/electerm-agent/src/client/components/fleet-status/fleet-status.styl`
- Modify: `apps/electerm-agent/src/client/components/fleet-status/fleet-service-selector.styl`
- Modify: `apps/electerm-agent/src/client/components/artifacts/artifacts.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-wrap.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/list.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/ui-font-picker.styl`
- Modify: `apps/electerm-agent/src/client/components/theme/theme-gallery.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/info.styl`

- [ ] **Step 1: Add failing page hierarchy assertions**

Append to `aurora-ui-style-contract.spec.js`:

```js
test('data and settings pages use panel card toolbar and control radii', () => {
  const fleet = readClient('components/fleet-status/fleet-status.styl')
  const drawer = readClient('components/fleet-status/fleet-service-selector.styl')
  const artifacts = readClient('components/artifacts/artifacts.styl')
  const settings = readClient('components/setting-panel/setting.styl')
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const fonts = readClient('components/setting-panel/ui-font-picker.styl')
  const themes = readClient('components/theme/theme-gallery.styl')

  assertSelectorUsesRadius(fleet, '.fleet-status-toolbar', 'toolbar')
  assertSelectorUsesRadius(fleet, '.fleet-status-table-scroll', 'panel')
  assertSelectorUsesRadius(drawer, '.ant-drawer-content', 'panel')
  assertSelectorUsesRadius(artifacts, '.artifact-list-panel', 'panel')
  assertSelectorUsesRadius(artifacts, '.artifact-preview', 'panel')
  assertSelectorUsesRadius(settings, '.sp-setting-section', 'panel')
  assertSelectorUsesRadius(wrap, '.setting-header', 'toolbar')
  assertSelectorUsesRadius(fonts, '.sp-ui-font-preview', 'card')
  assertSelectorUsesRadius(themes, '.sp-theme-card', 'card')
  assert.doesNotMatch(artifacts, /\.artifact-list-item[\s\S]{0,180}var\(--sp-shadow-(?:md|lg)\)/)
})
```

Add the font picker and theme gallery to `styleFiles`. Keep all existing behavior assertions in the three focused test files.

- [ ] **Step 2: Run tests and confirm RED**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/fleet-status-ui.spec.js test/unit-ci/ai-artifact-ui.spec.js test/unit-ci/secondary-config-ui.spec.js
```

Expected: FAIL on font preview, theme card selector naming, and remaining hard-coded card/control radii.

- [ ] **Step 3: Apply semantic mappings without carding data rows**

Use this mapping:

```text
Fleet
  .fleet-status-toolbar/.fleet-service-selector-toolbar -> radius-toolbar + shadow-md
  .fleet-status-table-scroll/.ant-drawer-content        -> radius-panel + shadow-lg
  table rows                                             -> shadow none

Artifacts
  .artifact-list-panel/.artifact-preview                 -> radius-panel + shadow-lg
  toolbars                                               -> radius-toolbar + shadow-md
  .artifact-list-item                                    -> radius 0 + shadow none
  empty/preview/editor cards                             -> radius-card

Settings/passwords/logs
  .setting-header                                        -> radius-toolbar + shadow-md
  .sp-setting-section/.setting-passwords                 -> radius-panel
  .sp-setting-field/table/log rows                       -> shadow none
  .info-modal .custom-modal-content                      -> radius-overlay + shadow-lg
  .info-modal pre                                        -> radius-toolbar

Fonts/themes
  font selector/control                                  -> radius-control
  .sp-ui-font-preview                                   -> radius-card + shadow-md
  font option rows                                       -> radius-control
  theme cards and preview cards                          -> radius-card + shadow-md
  theme controls                                         -> radius-control
```

Do not change saved values, theme identity/order, font selection, settings search, language preview, password actions, table columns, artifact behavior, or Fleet behavior.

- [ ] **Step 4: Run focused GREEN verification**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/fleet-status-ui.spec.js test/unit-ci/ai-artifact-ui.spec.js test/unit-ci/ai-artifact-preview-ui.spec.js test/unit-ci/secondary-config-ui.spec.js
```

Expected: PASS with data rows flat and existing responsive/behavior assertions unchanged.

- [ ] **Step 5: Commit data and settings pages**

```powershell
git add src/client/components/fleet-status/fleet-status.styl src/client/components/fleet-status/fleet-service-selector.styl src/client/components/artifacts/artifacts.styl src/client/components/setting-panel/setting-wrap.styl src/client/components/setting-panel/setting.styl src/client/components/setting-panel/list.styl src/client/components/setting-panel/ui-font-picker.styl src/client/components/theme/theme-gallery.styl src/client/components/sidebar/info.styl test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/fleet-status-ui.spec.js test/unit-ci/ai-artifact-ui.spec.js test/unit-ci/secondary-config-ui.spec.js
git commit -m "style: round Aurora data and settings surfaces"
```

---

### Task 5: Round operations, incidents, server status, SSH tunnel, and skill manager

**Files:**

- Modify: `apps/electerm-agent/test/unit-ci/aurora-ui-style-contract.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/operations-workspace-style.spec.js`
- Modify: `apps/electerm-agent/src/client/components/operations-toolkit/workspace/operations-workspace.styl`
- Modify: `apps/electerm-agent/src/client/components/incidents/incidents.styl`
- Modify: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.styl`
- Modify: `apps/electerm-agent/src/client/components/server-status/server-status-modal.styl`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-skill-manager.styl`

- [ ] **Step 1: Add failing specialist-page contracts**

Append:

```js
test('specialist workspaces and modals use Aurora Lift semantic radii', () => {
  const operations = readClient('components/operations-toolkit/workspace/operations-workspace.styl')
  const incidents = readClient('components/incidents/incidents.styl')
  const tunnel = readClient('components/ssh-tunnel/ssh-tunnel-modal.styl')
  const status = readClient('components/server-status/server-status-modal.styl')
  const skills = readClient('components/ai/agent-skill-manager.styl')

  assertSelectorUsesRadius(operations, '.operations-toolkit-workspace', 'panel')
  assertSelectorUsesRadius(operations, '.operations-recommended-flow', 'toolbar')
  assertSelectorUsesRadius(incidents, '.incident-home-summary', 'panel')
  assertSelectorUsesRadius(incidents, '.incident-detail-panel', 'panel')
  assertSelectorUsesRadius(tunnel, '.ssh-tunnel-type-card', 'card')
  assertSelectorUsesRadius(tunnel, '.ssh-tunnel-running-card', 'card')
  assertSelectorUsesRadius(status, '.server-status-summary', 'card')
  assertSelectorUsesRadius(status, '.server-status-section', 'card')
  assertSelectorUsesRadius(skills, '.agent-skill-manager-list', 'card')
  assertSelectorUsesRadius(skills, '.agent-skill-editor', 'card')
  assert.match(operations, /\.operations-history article[\s\S]{0,180}box-shadow none/)
})
```

Add the four newly covered Stylus files to `styleFiles`.

- [ ] **Step 2: Run contracts and confirm RED**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/operations-workspace-style.spec.js
```

Expected: FAIL because incidents, tunnel, status, and skill-manager frames still use 4–8px hard-coded radii.

- [ ] **Step 3: Apply exact semantic mappings**

```text
Operations Toolkit
  workspace                                             -> radius-panel + shadow-lg
  recommended/detail/task/maintenance frames           -> radius-toolbar + shadow-md
  buttons/selects                                      -> radius-control
  tool/history rows                                    -> shadow none
  virtual log                                          -> radius-small, no glow

Incident Archives
  .incident-home-summary/.incident-list-panel/
  .incident-detail-panel                               -> radius-panel + shadow-lg
  evidence/form/storage/note cards                     -> radius-card + shadow-md
  toolbar                                              -> radius-toolbar
  list items                                           -> radius-control + shadow none
  controls                                             -> radius-control

SSH Tunnel
  modal content                                        -> radius-overlay + shadow-lg
  context/runtime sections                             -> radius-panel
  type/saved/running cards                             -> radius-card + shadow-md
  template/history rows and controls                   -> radius-control

Server Status
  modal content                                        -> radius-overlay + shadow-lg
  summary/section/resource/rule frames                 -> radius-card + shadow-md
  toolbar                                              -> radius-toolbar
  buttons and fields                                   -> radius-control
  raw/pre content                                      -> radius-small

Agent Skill Manager
  list/editor/evidence/conversation frames             -> radius-card + shadow-md
  message/status/review frames                         -> radius-card
  buttons and fields                                   -> radius-control
```

Keep all text, field order, tabs, task/safety behavior, incident transactions, tunnel lifecycle, status refresh, AI skill creation, and responsive breakpoints unchanged.

- [ ] **Step 4: Run specialist GREEN verification**

```powershell
node --test test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/operations-workspace-style.spec.js test/unit-ci/incident-ui.spec.js test/unit-ci/ssh-tunnel-ui.spec.js test/unit-ci/server-status-center.spec.js test/unit-ci/agent-skill-manager-ui.spec.js
```

Expected: PASS; `aurora-ui-style-contract.spec.js` compiles every newly covered Stylus file and the existing specialist UI inventories remain unchanged.

- [ ] **Step 5: Commit specialist surfaces**

```powershell
git add src/client/components/operations-toolkit/workspace/operations-workspace.styl src/client/components/incidents/incidents.styl src/client/components/ssh-tunnel/ssh-tunnel-modal.styl src/client/components/server-status/server-status-modal.styl src/client/components/ai/agent-skill-manager.styl test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/operations-workspace-style.spec.js
git commit -m "style: round Aurora specialist workspaces"
```

---

### Task 6: Capture every page and pass source-vs-build design QA

**Files:**

- Create: `apps/electerm-agent/design-qa.md`
- Generate, do not commit: `release-verification/aurora-lift-2026-08-01/*.png`
- Modify only when a visual defect is proven: Stylus files already owned by Tasks 2–5.

- [ ] **Step 1: Create the blocking QA document before capture**

Create `apps/electerm-agent/design-qa.md` with:

```md
# Aurora Lift Design QA

- Reference: B · Aurora Lift and the 2026-08-01 Aurora coded screenshot baseline.
- Target: ShellPilot 0.4.23 on `codex/ui-modernization`.
- Required viewport: 1600×900 at 100% zoom; compact check at 1100×700 and 125% zoom.
- Required themes: Cloud Indigo and Graphite Night.
- Final result: blocked
- Blocking reason: new implementation screenshots have not been captured and compared yet.

## Blocking acceptance rules

- P0/P1/P2 findings must be fixed before pass.
- L3 depth must be obvious at normal zoom.
- L0 table/log/file/terminal content must remain flat.
- No content clipping, shadow clipping, wrong radius, overflow, low contrast, or layout movement.
- No function, label, order, route, state, or behavior change.
```

- [ ] **Step 2: Obtain explicit permission before Playwright CLI use**

Ask the user once for permission to run the repository's Electron Playwright visual and behavior tests. Continue only after an explicit yes. If permission is denied, do not run Playwright and leave `design-qa.md` blocked with that reason.

- [ ] **Step 3: Run the visual matrix smoke and targeted cases**

After permission, run from `apps/electerm-agent`:

```powershell
$env:SHELLPILOT_VISUAL_MATRIX_SMOKE = '1'
npx.cmd playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1
Remove-Item Env:SHELLPILOT_VISUAL_MATRIX_SMOKE

$env:SHELLPILOT_VISUAL_MATRIX_SIZE = '1600x900'
$env:SHELLPILOT_VISUAL_MATRIX_ZOOM = '1'
$env:SHELLPILOT_VISUAL_MATRIX_LANGUAGE = 'zh_cn'
npx.cmd playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1

$env:SHELLPILOT_VISUAL_MATRIX_SIZE = '1100x700'
$env:SHELLPILOT_VISUAL_MATRIX_ZOOM = '1.25'
npx.cmd playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1

Remove-Item Env:SHELLPILOT_VISUAL_MATRIX_SIZE
Remove-Item Env:SHELLPILOT_VISUAL_MATRIX_ZOOM
Remove-Item Env:SHELLPILOT_VISUAL_MATRIX_LANGUAGE
```

Expected: zero overflow, focus, contrast, terminal-invariant, or surface failures.

- [ ] **Step 4: Capture the real app surfaces**

Create `F:\SSH工具开发\ui-modernization-worktree\release-verification\aurora-lift-2026-08-01` and capture these exact files from the real Electron app at 1600×900, 100% zoom:

```text
01-connection-workbench.png
02-fleet-status.png
03-ai-artifacts.png
04-server-side-panel.png
05-terminal-workspace.png
05-terminal-workspace-dark.png
06-sftp.png
06-sftp-dark.png
07-history-side-panel.png
08-password-management.png
09-logs.png
10-settings.png
10-settings-dark.png
11-operations-toolkit.png
12-ai-assistant.png
12-ai-assistant-dark.png
13-incident-archives.png
14-ssh-tunnel.png
15-server-status.png
16-skill-manager.png
```

Use current application labels, controls, and fixtures only. Do not add preview-only routes, actions, fields, records, or fake product data.

- [ ] **Step 5: Compare source and build at the same viewport/state**

For each page, open the old baseline screenshot and new screenshot together in one comparison surface, then inspect:

```text
P0: unusable, blocked interaction, unreadable content, missing page, severe clipping
P1: wrong layout, missing visible function, broken responsive state, major overflow
P2: weak/incorrect shadow, wrong radius tier, shadow clipping, low contrast, inconsistent frame
P3: small spacing or polish difference that does not obscure the selected direction
```

Fix all P0/P1/P2 findings only in the responsible Stylus file, rerun its focused tests, recapture the affected page, and repeat the same comparison. Do not loop on P3 polish.

- [ ] **Step 6: Mark design QA passed only after evidence passes**

Remove the blocking-reason line and replace the blocked status in `design-qa.md` with:

```md
- Final result: passed
- Comparison result: all required pages match B · Aurora Lift with visibly stronger dual-layer depth and the approved 10/14/18/22/28px radius hierarchy.
- Remaining P3 findings: none.
- Functional scope result: production changes contain only the approved token file and Stylus files.
```

List every screenshot path reviewed and the focused test command rerun after each correction.

- [ ] **Step 7: Commit QA text and any proven style corrections**

Stage `design-qa.md` plus only the named Stylus/test files actually corrected. Do not stage screenshots.

```powershell
git add design-qa.md
git diff --cached --name-only
git commit -m "test: pass Aurora Lift visual QA"
```

Expected staged list: no PNG, JSX, route, Store, API, IPC, data, persistence, SSH/SFTP behavior, AI behavior, or safety file.

---

### Task 7: Run full regression and prove the diff is UI-only

**Files:**

- Verify all files modified by Tasks 1–6.
- Do not create production files.

- [ ] **Step 1: Audit the production diff against the pre-adjustment commit**

Use `0975cc2` as the plan baseline:

```powershell
git diff --name-only 0975cc2..HEAD -- apps/electerm-agent/src/client
git diff --stat 0975cc2..HEAD
```

Expected production diff: `src/client/common/ui-theme-tokens.js` and the Stylus files explicitly named in this plan. Reject the batch if any production JSX, TS, route, Store, IPC, persistence, SSH/SFTP behavior, AI behavior, safety, updater, or execution file appears.

- [ ] **Step 2: Run all unit contracts**

From `apps/electerm-agent`:

```powershell
npm.cmd run test-unit-ci
```

Expected: zero failures. Record the exact pass/skip counts.

- [ ] **Step 3: Run lint and compile**

```powershell
npm.cmd run lint
npm.cmd run compile
```

Expected: both commands exit 0 with no new warning caused by plan-owned files.

- [ ] **Step 4: Run the primary Electron regression set after Playwright permission**

```powershell
npx.cmd playwright test test/e2e/00181.layout.spec.js test/e2e/008.basic-terminal.spec.js test/e2e/008.basic.file-manager.spec.js test/e2e/009.1.quick-commands.spec.js test/e2e/009.2.quick-command.spec.js test/e2e/009.basic.themes.spec.js test/e2e/020.context-menu-ant6-layout.spec.js test/e2e/021.secondary-ui-state.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/023.fleet-status.spec.js test/e2e/025.fleet-service-selector.spec.js test/e2e/026.agent-skill-manager.spec.js test/e2e/032.operations-toolkit.spec.js test/e2e/033.ssh-tunnel-manager.spec.js test/e2e/034.incident-archive-foundation.spec.js test/e2e/setting-bookmarks-compact-layout.spec.js test/e2e/setting-themes-compact-layout.spec.js --workers=1
```

Expected: PASS except clearly identified credential-dependent or pre-existing fixture gaps. Do not weaken, skip, or rewrite behavior assertions to make visual work pass.

- [ ] **Step 5: Scan for forbidden implementation patterns**

```powershell
rg -n "text-shadow|transform\s+translate|filter\s*:|filter\s+" src/client/components/terminal src/client/css/includes/secondary-ui.styl
rg -n "border-radius\s+(4|5|6|7|8|9|10|12|14)px" src/client/components/main/aigshell-topbar.styl src/client/components/common/modal.styl src/client/components/tabs/no-session.styl src/client/components/ai/ai.styl src/client/components/quick-commands/qm.styl src/client/components/sftp/sftp.styl src/client/components/artifacts/artifacts.styl src/client/components/setting-panel/ui-font-picker.styl src/client/components/operations-toolkit/workspace/operations-workspace.styl src/client/components/incidents/incidents.styl src/client/components/ssh-tunnel/ssh-tunnel-modal.styl src/client/components/server-status/server-status-modal.styl src/client/components/ai/agent-skill-manager.styl
```

Expected: no terminal glyph glow or hover translation. Every remaining hard-coded radius must be one of these documented exceptions: `0`, `50%`, `999px`, status dot, progress bar, scrollbar, terminal-internal marker, or attached window edge. Replace every other card/frame/control hard-code with its semantic token.

- [ ] **Step 6: Verify generated evidence remains uncommitted**

```powershell
git status --short
git diff --cached --name-only
```

Expected: `.superpowers/`, `release-verification/aurora-ui-2026-08-01/`, and `release-verification/aurora-lift-2026-08-01/` remain untracked/unstaged; unrelated user changes remain untouched.

- [ ] **Step 7: Commit final contract corrections only when the index is non-empty**

```powershell
git diff --cached --quiet
if ($LASTEXITCODE -eq 1) {
  git commit -m "test: finalize Aurora Lift UI contracts"
}
```

Final handoff must include the new screenshot directory, exact test/lint/compile results, UI-only production diff audit, known external-test caveats, and a clear statement that no function was changed.
