# ShellPilot Light-Depth UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved restrained four-level depth system to every non-terminal ShellPilot surface without changing any functional callback, data flow, shortcut, or terminal rendering behavior.

**Architecture:** Extend the existing `ui-theme-tokens.js` semantic layer, then consume only those tokens from shared Stylus contracts and existing component styles. Migrate the shell chrome, settings, cards, menus, modals, and notifications in small testable batches while preserving the existing terminal theme constraints and visual-matrix harness.

**Tech Stack:** Electron 41, React 19, Ant Design 6, Stylus, Node test runner, Playwright.

---

## Execution context and file map

Execute in an isolated worktree created with `superpowers:using-git-worktrees`. Use one integration branch named `codex/ui-modernization`; this plan is the first subsystem on that branch. Do not copy the current primary worktree's unrelated uncommitted AI changes into the worktree.

Primary responsibilities:

- Modify `src/client/common/ui-theme-tokens.js`: derive the L0-L3 semantic colors, shadows, radii, and motion values.
- Modify `src/client/css/includes/secondary-ui.styl`: provide reusable L0-L3 contracts and reduced-motion behavior.
- Modify `src/client/components/setting-panel/setting.styl`: apply L1/L2 depth to setting pages and form controls.
- Modify `src/client/components/setting-panel/setting-wrap.styl`: apply depth to the settings shell and responsive header.
- Modify `src/client/components/common/context-menu.styl`: apply L3 menu styling while retaining viewport reachability.
- Modify `src/client/components/common/modal.styl`: apply L3 modal styling and wrap long titles/actions.
- Modify `src/client/components/common/notification.styl`: apply L3 notification styling and responsive wrapping.
- Modify `src/client/components/main/aigshell-topbar.styl`: apply L1 shell-bar styling.
- Modify `src/client/components/sidebar/sidebar.styl`: remove hard-coded light colors and use theme tokens.
- Modify `src/client/components/side-panel-r/right-side-panel.styl`: apply L1/L2 depth to the AI/right panel.
- Modify `src/client/components/footer/footer.styl`: remove hard-coded light colors and use theme tokens.
- Modify `src/client/components/sys-menu/sys-menu.styl`: keep native menus aligned with the L3 contract.
- Modify `test/unit-ci/ui-theme-tokens.spec.js`: validate token completeness and light/dark derivation.
- Modify `test/unit-ci/secondary-ui-contract.spec.js`: enforce shared depth contracts and terminal exclusions.
- Modify `test/e2e/020.context-menu-ant6-layout.spec.js`: retain context-menu placement and reachability.
- Modify `test/e2e/022.secondary-ui-visual-matrix.spec.js`: validate all surface levels, widths, zooms, languages, themes, and terminal invariants.

Do not modify `src/client/common/shellpilot-theme-constraints.js`, terminal font settings, `src/client/components/terminal/terminal.jsx`, or connection/store business callbacks in this plan.

### Task 1: Extend the semantic theme tokens

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js`
- Modify: `apps/electerm-agent/src/client/common/ui-theme-tokens.js`

- [ ] **Step 1: Write the failing token-contract test**

Update `tokenKeys` so the contract contains the existing keys plus `surfaceInset`, `highlightTop`, `shadowControl`, `motionFast`, and `motionNormal`. Keep `surfaceElevated`; do not rename existing public variables. Rename the existing serialization test from “twenty-token” to “twenty-five-token” and keep its exact-key/unique-variable assertions.

Add this focused test:

```js
test('derives restrained four-level depth values for light and dark themes', async () => {
  const { deriveSecondaryThemeTokens } = await import(moduleUrl)
  const light = deriveSecondaryThemeTokens({
    main: '#F2F6FA',
    'main-light': '#F8FAFC',
    text: '#253249',
    primary: '#2878E6'
  })
  const dark = deriveSecondaryThemeTokens({
    main: '#10161E',
    'main-light': '#151D27',
    text: '#E8EEF6',
    primary: '#4C93F4'
  })

  for (const tokens of [light, dark]) {
    assert.notEqual(tokens.surfaceElevated, tokens.surface)
    assert.notEqual(tokens.surfaceInset, tokens.surface)
    assert.match(tokens.highlightTop, /^rgba\(/)
    assert.match(tokens.shadowControl, /^0 2px/)
    assert.match(tokens.shadowCard, /^0 (?:7|8)px/)
    assert.match(tokens.shadowOverlay, /^0 (?:18|20)px/)
    assert.equal(tokens.radiusOverlay, '10px')
    assert.equal(tokens.motionFast, '120ms')
    assert.equal(tokens.motionNormal, '180ms')
  }
  assert.notEqual(light.shadowCard, dark.shadowCard)
  assert.notEqual(light.shadowOverlay, dark.shadowOverlay)
})
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run from `apps/electerm-agent`:

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js
```

Expected: FAIL because the five new semantic tokens do not exist and `surfaceElevated` still equals `surface`.

- [ ] **Step 3: Implement brightness-aware L0-L3 derivation**

In `deriveSecondaryThemeTokens`, calculate the extra values before returning the token object:

```js
const darkSurface = relativeLuminance(surface) < 0.5
const surfaceElevated = mix(surface, '#FFFFFF', darkSurface ? 0.06 : 0.34)
const surfaceInset = mix(surface, page, darkSurface ? 0.42 : 0.58)
const highlightTop = darkSurface
  ? 'rgba(255, 255, 255, 0.06)'
  : 'rgba(255, 255, 255, 0.88)'
```

Return these exact semantic shapes while retaining all existing color and contrast calculations:

```js
surfaceInset,
surfaceElevated,
highlightTop,
radiusControl: '7px',
radiusCard: '10px',
radiusOverlay: '10px',
shadowControl: darkSurface
  ? '0 2px 6px rgba(0, 0, 0, 0.28)'
  : '0 2px 5px rgba(28, 50, 78, 0.10)',
shadowCard: darkSurface
  ? '0 8px 20px rgba(0, 0, 0, 0.30)'
  : '0 7px 18px rgba(30, 58, 95, 0.11)',
shadowOverlay: darkSurface
  ? '0 20px 46px rgba(0, 0, 0, 0.48)'
  : '0 18px 40px rgba(26, 44, 70, 0.24)',
motionFast: '120ms',
motionNormal: '180ms'
```

Update the test's color-key list explicitly so `highlightTop`, shadows, radii, and durations are not incorrectly validated as hex colors:

```js
const colorTokenKeys = [
  'page', 'surface', 'surfaceSubtle', 'surfaceInset', 'surfaceElevated',
  'text', 'textMuted', 'textDisabled', 'border', 'borderStrong',
  'primary', 'primarySoft', 'success', 'info', 'warning', 'danger'
]
```

- [ ] **Step 4: Run the token tests**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js
```

Expected: PASS with no contrast regression in built-in light or dark palettes.

- [ ] **Step 5: Commit the semantic-token change**

```powershell
git add src/client/common/ui-theme-tokens.js test/unit-ci/ui-theme-tokens.spec.js
git commit -m "feat: add restrained UI depth tokens"
```

### Task 2: Add reusable level contracts and reduced motion

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`
- Modify: `apps/electerm-agent/src/client/css/includes/secondary-ui.styl`

- [ ] **Step 1: Write the failing shared-style contract test**

Add a test that reads `css/includes/secondary-ui.styl` and asserts the reusable classes and terminal exclusion:

```js
test('defines L0-L3 contracts without styling terminal canvases', () => {
  const source = readClient('css/includes/secondary-ui.styl')
  for (const selector of ['.sp-level-0', '.sp-level-1', '.sp-level-2', '.sp-level-3']) {
    assert.match(source, new RegExp(selector.replace('.', '\\.')))
  }
  assert.match(source, /box-shadow var\(--sp-shadow-control\)/)
  assert.match(source, /box-shadow var\(--sp-shadow-card\)/)
  assert.match(source, /box-shadow var\(--sp-shadow-overlay\)/)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/)
  assert.doesNotMatch(source, /\.xterm(?:\s|,|$)/)
  assert.doesNotMatch(source, /\.term-wrap(?:\s|,|$)/)
})
```

- [ ] **Step 2: Run the contract test and verify failure**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js
```

Expected: FAIL because the L0-L3 classes and reduced-motion rule are absent.

- [ ] **Step 3: Add the shared contracts**

Append these contracts to `secondary-ui.styl` and make the existing `.sp-card` consume the L2 contract values:

```stylus
.sp-level-0
  color var(--sp-text)
  background var(--sp-page)

.sp-level-1
  color var(--sp-text)
  background var(--sp-surface)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-control)
  box-shadow inset 0 1px 0 var(--sp-highlight-top), var(--sp-shadow-control)

.sp-level-2,
.sp-card
  color var(--sp-text)
  background var(--sp-surface-elevated)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-card)
  box-shadow inset 0 1px 0 var(--sp-highlight-top), var(--sp-shadow-card)

.sp-level-3
  color var(--sp-text)
  background var(--sp-surface-elevated)
  border 1px solid var(--sp-border-strong)
  border-radius var(--sp-radius-overlay)
  box-shadow inset 0 1px 0 var(--sp-highlight-top), var(--sp-shadow-overlay)

.sp-lift-interactive
  transition transform var(--sp-motion-fast) ease, box-shadow var(--sp-motion-fast) ease
  &:hover
    transform translateY(-1px)
  &:active
    transform translateY(0)

@media (prefers-reduced-motion: reduce)
  .sp-lift-interactive
    transition none
    &:hover,
    &:active
      transform none
```

- [ ] **Step 4: Run the contract test**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js
```

Expected: PASS.

- [ ] **Step 5: Commit the shared contracts**

```powershell
git add src/client/css/includes/secondary-ui.styl test/unit-ci/secondary-ui-contract.spec.js
git commit -m "style: define shared UI elevation levels"
```

### Task 3: Migrate the settings center without text compression

**Files:**
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting.styl`
- Modify: `apps/electerm-agent/src/client/components/setting-panel/setting-wrap.styl`
- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-ui-responsive.spec.js`
- Modify: `apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js`

- [ ] **Step 1: Add failing responsive/depth assertions**

Extend `shellpilot-ui-responsive.spec.js` with source assertions for `surfaceElevated`, `shadowCard`, `surfaceInset`, `min-width 0`, and the existing compact breakpoints. Extend the settings case in the Playwright matrix with:

```js
const settingsDepth = await page.locator('.sp-setting-section').first().evaluate(element => {
  const style = getComputedStyle(element)
  return {
    background: style.backgroundColor,
    shadow: style.boxShadow,
    radius: style.borderRadius,
    overflow: element.scrollWidth > element.clientWidth + 1
  }
})
expect(settingsDepth.shadow).not.toBe('none')
expect(settingsDepth.radius).toBe('10px')
expect(settingsDepth.overflow).toBe(false)
```

- [ ] **Step 2: Run the focused tests and verify failure**

```powershell
node --test test/unit-ci/shellpilot-ui-responsive.spec.js
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --grep "settings search" --workers=1
```

Expected: the source/depth assertion fails before the settings styles are migrated; existing functional assertions continue to run.

- [ ] **Step 3: Apply tokens to settings surfaces**

In `setting.styl`:

```stylus
.sp-setting-section
  background var(--sp-surface-elevated)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-card)
  box-shadow inset 0 1px 0 var(--sp-highlight-top), var(--sp-shadow-card)

.sp-settings-form
  .ant-input,
  .ant-input-affix-wrapper,
  .ant-input-number,
  .ant-select-selector,
  textarea
    background var(--sp-surface-inset) !important
    border-color var(--sp-border) !important
    box-shadow inset 0 2px 4px rgba(0, 0, 0, .08)
```

In `setting-wrap.styl`, make the settings root L0, the header L1, and the navigation selected state use `primarySoft`. Preserve the current `590px` and `820px` behavior, `min-width: 0`, flexible button wrapping, internal scrolling, and search keyboard behavior.

- [ ] **Step 4: Run settings tests**

```powershell
node --test test/unit-ci/shellpilot-ui-responsive.spec.js test/unit-ci/settings-search-interaction.spec.js test/unit-ci/setting-search-index.spec.js
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --grep "settings search" --workers=1
```

Expected: PASS; settings fields and header have no horizontal overflow at 590px and 1.5 zoom.

- [ ] **Step 5: Commit the settings migration**

```powershell
git add src/client/components/setting-panel/setting.styl src/client/components/setting-panel/setting-wrap.styl test/unit-ci/shellpilot-ui-responsive.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js
git commit -m "style: add depth to settings surfaces"
```

### Task 4: Migrate menus, modals, and notifications to L3

**Files:**
- Modify: `apps/electerm-agent/src/client/components/common/context-menu.styl`
- Modify: `apps/electerm-agent/src/client/components/common/modal.styl`
- Modify: `apps/electerm-agent/src/client/components/common/notification.styl`
- Modify: `apps/electerm-agent/src/client/components/sys-menu/sys-menu.styl`
- Modify: `apps/electerm-agent/test/e2e/020.context-menu-ant6-layout.spec.js`
- Modify: `apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js`

- [ ] **Step 1: Add failing overlay-style assertions**

For both Ant and native menus, assert the computed border radius is `10px`, the shadow is not `none`, the menu remains inside the viewport, and the first/last items stay reachable. Add this modal/notification check to the visual matrix:

```js
const overlayMetrics = await page.evaluate(() => {
  return ['.custom-modal-content', '.notification'].map(selector => {
    const element = document.querySelector(selector)
    if (!element) return null
    const style = getComputedStyle(element)
    return {
      selector,
      shadow: style.boxShadow,
      radius: style.borderRadius,
      overflow: element.scrollWidth > element.clientWidth + 1
    }
  }).filter(Boolean)
})
for (const metric of overlayMetrics) {
  expect(metric.shadow).not.toBe('none')
  expect(metric.radius).toBe('10px')
  expect(metric.overflow).toBe(false)
}
```

- [ ] **Step 2: Run the overlay tests and verify failure**

```powershell
npx playwright test test/e2e/020.context-menu-ant6-layout.spec.js --workers=1
node --test test/unit-ci/secondary-ui-contract.spec.js
```

Expected: at least the legacy modal/notification radius or semantic-token assertion fails.

- [ ] **Step 3: Replace raw overlay values with semantic tokens**

Apply this shape to all four style files while retaining their existing placement, scrolling, danger semantics, keyboard focus, and action ordering:

```stylus
background var(--sp-surface-elevated)
border 1px solid var(--sp-border-strong)
border-radius var(--sp-radius-overlay)
box-shadow inset 0 1px 0 var(--sp-highlight-top), var(--sp-shadow-overlay)
```

For modal and notification text, replace single-line truncation of titles with:

```stylus
min-width 0
white-space normal
overflow-wrap anywhere
word-break normal
```

Keep filename/host/technical-ID elements as the only permitted ellipsis cases. Add `flex-wrap: wrap` to modal action rows and constrain notifications with `width: min(400px, calc(100vw - 32px))`.

- [ ] **Step 4: Run menu and visual tests**

```powershell
npx playwright test test/e2e/020.context-menu-ant6-layout.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1
```

Expected: PASS; menus retain pointer placement and scroll reachability, overlays do not overflow compact windows.

- [ ] **Step 5: Commit the overlay migration**

```powershell
git add src/client/components/common/context-menu.styl src/client/components/common/modal.styl src/client/components/common/notification.styl src/client/components/sys-menu/sys-menu.styl test/e2e/020.context-menu-ant6-layout.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js
git commit -m "style: unify menus modals and notifications"
```

### Task 5: Migrate the non-terminal shell chrome

**Files:**
- Modify: `apps/electerm-agent/src/client/components/main/aigshell-topbar.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/sidebar.styl`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel.styl`
- Modify: `apps/electerm-agent/src/client/components/footer/footer.styl`
- Modify: `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`
- Modify: `apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js`

- [ ] **Step 1: Add failing source and computed-style tests**

Add a contract that rejects the legacy shell hard-coded light colors:

```js
test('shell chrome consumes semantic surfaces instead of fixed light colors', () => {
  const files = [
    'components/main/aigshell-topbar.styl',
    'components/sidebar/sidebar.styl',
    'components/side-panel-r/right-side-panel.styl',
    'components/footer/footer.styl'
  ]
  for (const file of files) {
    const source = readClient(file)
    assert.doesNotMatch(source, /#f7f8fa|#dfe3ea/i, file)
    assert.match(source, /var\(--sp-(?:surface|page|border)/, file)
  }
})
```

In the visual matrix, sample `.aigshell-topbar`, `.sidebar`, `.right-side-panel`, and `.main-footer`; assert no sampled surface has horizontal overflow and that the right panel remains independently scrollable.

- [ ] **Step 2: Run the tests and verify failure**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js
```

Expected: FAIL because sidebar and footer still contain `#f7f8fa` and `#dfe3ea`.

- [ ] **Step 3: Apply shell-level semantics**

Use these mappings without changing positioning or dimensions:

```text
Top bar:          surfaceElevated + border + shadowControl
Sidebar rail:     surface + border
Sidebar buttons:  L1 only for hover/selected state
Right panel:      surface + border; header/config cards use L1/L2
Footer:           surfaceElevated + top border + short upward separator shadow
```

Do not apply UI card shadows to `.tabs.terminal-session-tabs`, `.term-wrap`, `.xterm`, `.xterm-screen`, or terminal workspace layers. Keep terminal tabs and the terminal canvas tied to `--shellpilot-terminal-background`.

- [ ] **Step 4: Run shell and terminal-isolation tests**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js test/unit-ci/shellpilot-theme-constraints.spec.js
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1
```

Expected: PASS; every terminal invariant reports background `#0E0F12` and readable foreground while shell surfaces gain depth.

- [ ] **Step 5: Commit the shell migration**

```powershell
git add src/client/components/main/aigshell-topbar.styl src/client/components/sidebar/sidebar.styl src/client/components/side-panel-r/right-side-panel.styl src/client/components/footer/footer.styl test/unit-ci/secondary-ui-contract.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js
git commit -m "style: add restrained depth to client chrome"
```

### Task 6: Run the visual subsystem acceptance gate

**Files:**
- Verify only; modify tests only if a reproducible product defect is found.

- [ ] **Step 1: Run lint and the complete unit contract set**

```powershell
npx standard src/client/common/ui-theme-tokens.js test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/secondary-ui-contract.spec.js
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js test/unit-ci/shellpilot-theme-constraints.spec.js
```

Expected: exit code 0 and zero failed tests.

- [ ] **Step 2: Run the complete visual matrix**

```powershell
npx playwright test test/e2e/020.context-menu-ant6-layout.spec.js test/e2e/021.secondary-ui-state.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1
```

Expected: exit code 0; no document overflow, menu clipping, text collision, focus failure, or terminal invariant failure across the matrix.

- [ ] **Step 3: Perform local-client visual verification**

Start the development client with:

```powershell
npm run app
```

Verify light and dark themes at 590px, 820px, and a normal desktop width; check 100%, 125%, 150%, 175%, and 200% zoom. Open Settings, UI Themes, a right-click menu, a modal, a notification, and the AI panel. Confirm the terminal canvas remains `#0E0F12`, text is readable, and SSH input/copy/paste behavior is unchanged.

- [ ] **Step 4: Record the local gate without publishing**

Add the verification commands and results to the implementation task handoff. Do not run any `release:*`, `r`, `w`, upload, push, or updater-publication command.
