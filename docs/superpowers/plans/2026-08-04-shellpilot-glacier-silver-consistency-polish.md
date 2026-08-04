# ShellPilot Glacier Silver Consistency Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ShellPilot's default Glacier Silver UI and paired Graphite Silver dark mode use one clear B-level card hierarchy, readable Ant Design controls, and consistent elevation while preserving the existing client layout and keeping terminal, SFTP, table, log, history, and output rows flat.

**Architecture:** Keep material generation centralized in `ui-theme-tokens.js`, bridge semantic values into Ant Design from the existing store, and classify each visible surface as control, toolbar, action card, panel, overlay, or flat data. Shared Stylus rules own cross-client controls; targeted selectors correct only currently misclassified surfaces.

**Tech Stack:** Electron 41, React 19, Ant Design 6, Stylus, Node.js `node:test`, Playwright Electron E2E.

---

## File map

- `src/client/common/shellpilot-ui-palettes.js`: approved Glacier and Graphite source colors.
- `src/client/common/ui-theme-tokens.js`: gradients, radii, shadows, contrast, and Ant Design mapping.
- `src/client/store/store.js`: consume the pure Ant Design theme bridge.
- `src/client/css/includes/secondary-ui.styl`: shared control/card/panel/overlay contracts.
- Page styles: quick commands, operations, fleet, artifacts, incidents, AI, sidebar/tree list, and home.
- Tests: token/palette contracts, semantic surface contracts, targeted visual-style contracts, E2E.
- `apps/electerm-agent/design-qa.md`: blocking same-viewport visual QA record.

### Task 1: Lock the approved material recipes

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-ui-palettes.spec.js`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-ui-palettes.js`
- Modify: `apps/electerm-agent/src/client/common/ui-theme-tokens.js`

- [ ] **Step 1: Write failing palette and token tests**

Update only Glacier/Graphite material expectations:

```js
// Glacier
'main-light': '#F8FBFD',
'surface-soft': '#E7EEF4',
'card-start': '#F8FBFD',
'card-mid': '#E7EEF4',
'card-end': '#D8E4EC',
'panel-start': '#F5F9FC',
'panel-mid': '#E8F0F5',
'panel-end': '#DAE5ED',

// Graphite Silver
'main-light': '#2B3745',
'surface-soft': '#202A37',
'card-start': '#2B3745',
'card-mid': '#202A37',
'card-end': '#17212C',
'panel-start': '#27323F',
'panel-mid': '#1D2733',
'panel-end': '#141D27',
flat: '#17212C'
```

Add `shadowPanel` to `tokenKeys`, then assert:

```js
assert.deepEqual(
  [light.radiusSmall, light.radiusControl, light.radiusToolbar,
    light.radiusCard, light.radiusPanel, light.radiusOverlay],
  ['8px', '12px', '16px', '18px', '22px', '24px']
)
assert.equal(light.shadowControl,
  '0 2px 4px rgba(44, 62, 84, 0.10), 0 7px 15px rgba(54, 77, 103, 0.14)')
assert.equal(light.shadowCard,
  '0 3px 6px rgba(44, 62, 84, 0.13), 0 14px 27px rgba(54, 77, 103, 0.20)')
assert.equal(light.shadowPanel,
  '0 4px 8px rgba(44, 62, 84, 0.15), 0 20px 40px rgba(54, 77, 103, 0.23)')
assert.equal(light.shadowOverlay,
  '0 6px 12px rgba(38, 54, 74, 0.18), 0 28px 52px rgba(49, 70, 96, 0.28)')
assert.equal(
  light.cardBackground,
  'radial-gradient(110% 90% at 15% 0%, #FFFFFF 0%, rgba(255, 255, 255, 0.72) 34%, transparent 72%), linear-gradient(150deg, #F8FBFD 0%, #E7EEF4 54%, #D8E4EC 100%)'
)
assert.match(dark.cardBackground, /#2B3745 0%.*#202A37 54%.*#17212C 100%/)
assert.equal(light.shadowSm, light.shadowControl)
assert.equal(light.shadowMd, light.shadowCard)
assert.equal(light.shadowLg, light.shadowOverlay)
```

- [ ] **Step 2: Verify RED**

Run from `apps/electerm-agent`:

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js
```

Expected: FAIL on old radii, weak shadows, old gradient stops, and old palette colors.

- [ ] **Step 3: Implement the material values**

Update the two palette records without changing IDs, `main`, text/status colors, or topbar colors. In `ui-theme-tokens.js`, set card stops to `0/34/72` and `0/54/100`, return the six approved radii, and derive:

```js
const shadowControl = darkSurface
  ? '0 2px 4px rgba(0, 0, 0, 0.34), 0 8px 18px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(160, 148, 255, 0.12)'
  : '0 2px 4px rgba(44, 62, 84, 0.10), 0 7px 15px rgba(54, 77, 103, 0.14)'
const shadowCard = darkSurface
  ? '0 3px 6px rgba(0, 0, 0, 0.38), 0 16px 32px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(160, 148, 255, 0.16)'
  : '0 3px 6px rgba(44, 62, 84, 0.13), 0 14px 27px rgba(54, 77, 103, 0.20)'
const shadowPanel = darkSurface
  ? '0 5px 10px rgba(0, 0, 0, 0.42), 0 22px 44px rgba(0, 0, 0, 0.46), 0 0 0 1px rgba(160, 148, 255, 0.20)'
  : '0 4px 8px rgba(44, 62, 84, 0.15), 0 20px 40px rgba(54, 77, 103, 0.23)'
const shadowOverlay = darkSurface
  ? '0 8px 16px rgba(0, 0, 0, 0.46), 0 30px 58px rgba(0, 0, 0, 0.54), 0 0 0 1px rgba(160, 148, 255, 0.24)'
  : '0 6px 12px rgba(38, 54, 74, 0.18), 0 28px 52px rgba(49, 70, 96, 0.28)'
const shadowSm = shadowControl
const shadowMd = shadowCard
const shadowLg = shadowOverlay
```

- [ ] **Step 4: Verify GREEN and commit**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js
git add -- apps/electerm-agent/src/client/common/shellpilot-ui-palettes.js apps/electerm-agent/src/client/common/ui-theme-tokens.js apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js apps/electerm-agent/test/unit-ci/shellpilot-ui-palettes.spec.js
git commit -m "fix(ui): strengthen glacier silver material tokens"
```

Expected: tests PASS; commit contains only these four files.

### Task 2: Bridge semantic tokens into Ant Design

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js`
- Modify: `apps/electerm-agent/src/client/common/ui-theme-tokens.js`
- Modify: `apps/electerm-agent/src/client/store/store.js`

- [ ] **Step 1: Write the failing mapping test**

```js
test('maps semantic ShellPilot surfaces and readable states into Ant Design', async () => {
  const { buildAntdThemeConfig } = await import(moduleUrl)
  const config = buildAntdThemeConfig({
    main: '#EDF5FB', 'main-light': '#F8FBFD', 'surface-soft': '#E7EEF4',
    text: '#14243F', 'text-dark': '#65738A',
    'text-disabled': '#718096', primary: '#5C5BE9', border: '#CFDCE7'
  })
  assert.equal(config.token.borderRadius, 12)
  assert.equal(config.token.borderRadiusSM, 8)
  assert.equal(config.token.borderRadiusLG, 18)
  assert.equal(config.token.colorBgContainer, '#F8FBFD')
  assert.equal(config.token.colorTextSecondary, '#65738A')
  assert.equal(config.token.colorTextPlaceholder, '#65738A')
  assert.equal(config.token.colorTextDisabled, '#718096')
  assert.equal(config.token.colorTextLightSolid, '#FFFFFF')
  assert.equal(config.components.Button.primaryColor, '#FFFFFF')
  assert.equal(config.components.Tag.defaultColor, '#14243F')
  assert.equal(config.components.Segmented.itemSelectedColor, '#14243F')
  assert.equal(config.components.Select.selectorBg, '#F8FBFD')
})
```

Also assert `store.js` imports/calls `buildAntdThemeConfig` and no longer contains `borderRadius: 3`.

- [ ] **Step 2: Verify RED**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js
```

Expected: FAIL because the bridge does not exist.

- [ ] **Step 3: Implement the pure bridge**

Export `buildAntdThemeConfig(theme)` from `ui-theme-tokens.js`. It must return:

```js
{
  token: {
    borderRadius: 12, borderRadiusSM: 8, borderRadiusLG: 18,
    colorPrimary: tokens.primary,
    colorBgBase: tokens.page,
    colorBgContainer: tokens.surface,
    colorBgElevated: tokens.surfaceElevated,
    colorBgContainerDisabled: tokens.surfaceInset,
    colorTextBase: tokens.text,
    colorText: tokens.text,
    colorTextSecondary: tokens.textMuted,
    colorTextPlaceholder: tokens.textMuted,
    colorTextDisabled: tokens.textDisabled,
    colorTextLightSolid: '#FFFFFF',
    colorBorder: tokens.border,
    colorBorderSecondary: tokens.border,
    colorError: tokens.danger,
    colorInfo: tokens.info,
    colorSuccess: tokens.success,
    colorWarning: tokens.warning,
    colorLink: tokens.primary,
    motion: false
  },
  components: {
    Button: {
      primaryColor: '#FFFFFF', solidTextColor: '#FFFFFF',
      defaultColor: tokens.text, defaultBg: tokens.surface,
      defaultBorderColor: tokens.border, defaultBgDisabled: tokens.surfaceInset,
      defaultShadow: tokens.shadowControl, primaryShadow: tokens.shadowControl
    },
    Input: {
      addonBg: tokens.surfaceSoft, hoverBg: tokens.surfaceElevated,
      activeBg: tokens.surfaceElevated, hoverBorderColor: tokens.primary,
      activeBorderColor: tokens.primary, activeShadow: tokens.shadowFocus
    },
    Select: {
      selectorBg: tokens.surface, clearBg: tokens.surface,
      optionSelectedColor: tokens.text, optionSelectedBg: tokens.primarySoft,
      optionActiveBg: tokens.surfaceSoft, multipleItemBg: tokens.surfaceSoft,
      multipleItemBorderColor: tokens.border,
      multipleSelectorBgDisabled: tokens.surfaceInset,
      multipleItemColorDisabled: tokens.textDisabled,
      multipleItemBorderColorDisabled: tokens.border,
      hoverBorderColor: tokens.primary, activeBorderColor: tokens.primary,
      activeOutlineColor: tokens.primarySoft
    },
    Tag: { defaultBg: tokens.surfaceSoft, defaultColor: tokens.text, solidTextColor: '#FFFFFF' },
    Segmented: {
      trackBg: tokens.surfaceInset, itemColor: tokens.textMuted,
      itemHoverColor: tokens.text, itemHoverBg: tokens.surfaceSoft,
      itemActiveBg: tokens.primarySoft, itemSelectedBg: tokens.surfaceElevated,
      itemSelectedColor: tokens.text
    },
    Tabs: {
      cardBg: tokens.surfaceSoft, itemColor: tokens.textMuted,
      itemHoverColor: tokens.primary, itemActiveColor: tokens.primary,
      itemSelectedColor: tokens.primary, inkBarColor: tokens.primary
    },
    Pagination: {
      itemBg: tokens.surface, itemLinkBg: tokens.surface,
      itemActiveBg: tokens.surfaceElevated, itemActiveColor: tokens.primary,
      itemActiveColorHover: tokens.primaryAlt,
      itemActiveBgDisabled: tokens.surfaceInset,
      itemActiveColorDisabled: tokens.textDisabled, itemInputBg: tokens.surface
    }
  }
}
```

- [ ] **Step 4: Replace the store mapping**

```js
import { buildAntdThemeConfig } from '../common/ui-theme-tokens'

get uiThemeConfig () {
  const { store } = window
  const themeConf = store.getUiThemeConfig()
  return {
    ...buildAntdThemeConfig(themeConf),
    algorithm: isColorDark(themeConf.main) ? theme.darkAlgorithm : theme.defaultAlgorithm
  }
}
```

- [ ] **Step 5: Verify GREEN and commit**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js
git add -- apps/electerm-agent/src/client/common/ui-theme-tokens.js apps/electerm-agent/src/client/store/store.js apps/electerm-agent/test/unit-ci/ui-theme-tokens.spec.js
git commit -m "fix(ui): map semantic tokens into ant design"
```

Expected: PASS and no business state code changes.

### Task 3: Correct shared surface hierarchy and readable controls

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`
- Modify: `apps/electerm-agent/src/client/css/includes/secondary-ui.styl`

- [ ] **Step 1: Write failing hierarchy tests**

Add a panel contract:

```js
assertCssRule(blocks, '.sp-level-panel, .sp-panel', {
  color: 'var(--sp-text)',
  'background-color': 'var(--sp-surface)',
  'background-image': 'var(--sp-panel-background)',
  border: '1px solid var(--sp-border)',
  'border-radius': 'var(--sp-radius-panel)',
  'box-shadow': 'inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-panel)'
})
```

Add a source test that rejects `.sp-card .sp-card { box-shadow: none }` and requires readable placeholder, disabled, and primary-button rules:

```js
assert.doesNotMatch(source, /\.sp-card \.sp-card\s*\r?\n\s*box-shadow none/)
assert.match(source, /\.ant-select-selection-placeholder[\s\S]{0,180}color var\(--sp-text-muted\) !important[\s\S]{0,100}opacity 1/)
assert.match(source, /\.ant-btn-primary[\s\S]{0,180}color #FFFFFF !important/)
assert.match(source, /\.ant-btn:disabled[\s\S]{0,220}color var\(--sp-text-disabled\) !important[\s\S]{0,100}opacity 1/)
```

- [ ] **Step 2: Verify RED**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js
```

Expected: FAIL on missing panel primitive, nested-card cancellation, and missing readable-state rules.

- [ ] **Step 3: Implement shared contracts**

Add:

```stylus
.sp-level-panel,
.sp-panel
  color var(--sp-text)
  background-color var(--sp-surface)
  background-image var(--sp-panel-background)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-panel)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-panel)
```

Delete the descendant-wide `.sp-card .sp-card` rule. Keep `.sp-flat-data` as the generic no-shadow contract.

Inside the existing secondary/custom-modal/sidebar/right-panel scope, add compact control backgrounds without overriding primary buttons:

```stylus
.ant-btn:not(.ant-btn-text):not(.ant-btn-link):not(.ant-btn-primary),
.ant-input,
.ant-input-affix-wrapper,
.ant-input-number,
.ant-picker,
.ant-select-selector
  color var(--sp-text)
  background-color var(--sp-surface)
  background-image var(--sp-control-background)
  border-color var(--sp-border)

.ant-btn-primary
  color #FFFFFF !important

.ant-btn:disabled,
.ant-btn.ant-btn-disabled,
.ant-input:disabled,
.ant-select-disabled .ant-select-selector
  color var(--sp-text-disabled) !important
  background-color var(--sp-surface-inset) !important
  border-color var(--sp-border) !important
  opacity 1

.ant-input::placeholder,
textarea::placeholder,
.ant-select-selection-placeholder
  color var(--sp-text-muted) !important
  opacity 1
```

- [ ] **Step 4: Verify GREEN and commit**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js
git add -- apps/electerm-agent/src/client/css/includes/secondary-ui.styl apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js
git commit -m "fix(ui): unify shared card and control hierarchy"
```

Expected: PASS, including the dense-surface guard.

### Task 4: Reclassify the seven screenshot surfaces

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/glacier-silver-ui-style-contract.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/operations-workspace-style.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/server-maintenance-quick-commands.spec.js`
- Modify: `apps/electerm-agent/src/client/components/quick-commands/qm.styl`
- Modify: `apps/electerm-agent/src/client/components/operations-toolkit/workspace/operations-workspace.styl`
- Modify: `apps/electerm-agent/src/client/components/fleet-status/fleet-status.styl`
- Modify: `apps/electerm-agent/src/client/components/artifacts/artifacts.styl`
- Modify: `apps/electerm-agent/src/client/components/incidents/incidents.styl`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/sidebar.styl`
- Modify: `apps/electerm-agent/src/client/components/tree-list/tree-list.jsx`
- Modify: `apps/electerm-agent/src/client/components/tree-list/bookmark-toolbar.jsx`
- Modify: `apps/electerm-agent/src/client/components/tree-list/tree-list.styl`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai.styl`

- [ ] **Step 1: Write failing semantic style contracts**

Require:

```js
assert.match(fleet, /\.fleet-status-toolbar[\s\S]{0,420}background-image var\(--sp-card-background\)[\s\S]{0,180}border-radius var\(--sp-radius-toolbar\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
assert.match(artifacts, /\.artifact-list-panel[\s\S]{0,360}var\(--sp-shadow-panel\)/)
assert.match(artifacts, /\.artifact-preview[\s\S]{0,420}var\(--sp-shadow-panel\)/)
assert.match(artifacts, /\.artifact-list-filters[\s\S]{0,360}background-image var\(--sp-card-background\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
assert.match(incidents, /\.incident-list-toolbar[\s\S]{0,420}background-image var\(--sp-card-background\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
assert.match(operations, /\.operations-tool-list[\s\S]{0,820}> button[\s\S]{0,420}background-image var\(--sp-card-background\)[\s\S]{0,180}border-radius var\(--sp-radius-card\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
assert.match(operations, /\.operations-tool-detail[\s\S]{0,420}var\(--sp-shadow-panel\)/)
assert.match(quickCommands, /\.qm-item[\s\S]{0,520}background-image var\(--sp-card-background\)[\s\S]{0,180}border-radius var\(--sp-radius-card\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
assert.doesNotMatch(quickCommands, /\.qm-item[\s\S]{0,320}background var\(--sp-flat-background\)/)
assert.match(rightPanel, /\.right-side-panel[\s\S]{0,360}var\(--sp-shadow-panel\)/)
assert.match(rightPanel, /\.right-panel-ai-model-select[\s\S]{0,620}background-image var\(--sp-control-background\) !important/)
assert.match(ai, /\.ai-mode-segmented[\s\S]{0,420}color var\(--sp-text\)/)
assert.match(tree, /\.tree-list-action-toolbar,[\s\S]{0,420}background-image var\(--sp-card-background\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
assert.match(tree, /\.tree-item[\s\S]{0,220}box-shadow none/)
```

Update the two focused tests to require action-card depth for `.qm-item` and `.operations-tool-list > button`, while retaining flat history/output assertions.

- [ ] **Step 2: Verify RED**

```powershell
node --test test/unit-ci/glacier-silver-ui-style-contract.spec.js test/unit-ci/operations-workspace-style.spec.js test/unit-ci/server-maintenance-quick-commands.spec.js
```

Expected: FAIL on flat command/diagnostic cards, weak panel aliases, filter toolbars, and missing wrapper classes.

- [ ] **Step 3: Convert command and diagnostic items to action cards**

Preserve all existing dimensions, grid, scrolling, truncation, and behavior. For `.qm-item` and `.operations-tool-list > button`, use:

```stylus
color var(--sp-text)
background-color var(--sp-surface-elevated)
background-image var(--sp-card-background)
border 1px solid var(--sp-border)
border-radius var(--sp-radius-card)
box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-card)
transition border-color var(--sp-motion-fast) ease, box-shadow var(--sp-motion-fast) ease, background-color var(--sp-motion-fast) ease
&:hover,
&:focus-visible
  border-color var(--sp-primary)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-panel)
```

Keep selected diagnostic cards elevated:

```stylus
&.active
  border-color var(--sp-primary)
  background-color var(--sp-primary-soft)
  background-image var(--sp-card-background)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-card), 0 0 0 2px var(--sp-primary-soft)
```

Use `--sp-shadow-panel` for `.operations-toolkit-workspace` and `.operations-tool-detail`. Do not touch virtual logs, task output, or history rows.

- [ ] **Step 4: Strengthen fleet, artifact, incident, and AI surfaces**

```stylus
.fleet-status-toolbar
  background-image var(--sp-card-background)
  border-radius var(--sp-radius-toolbar)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-card)

.artifact-list-panel,
.artifact-preview
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-panel)
.artifact-list-filters
  background-color var(--sp-surface-elevated)
  background-image var(--sp-card-background)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-toolbar)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-card)

.incident-workspace
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-panel)
.incident-list-toolbar
  margin 10px
  background-color var(--sp-surface-elevated)
  background-image var(--sp-card-background)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-toolbar)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-card)
```

Use `--sp-shadow-panel` for the AI and sidebar shells. Change AI model selectors from `--sp-flat-background` to `--sp-control-background` plus `--sp-shadow-control`. Give AI status tags control radius/background/shadow while preserving semantic colors.

- [ ] **Step 5: Add UI-only wrapper classes**

Change only existing className strings:

```jsx
// bookmark-toolbar.jsx
<div className='pd1b pd1r tree-list-action-toolbar'>

// tree-list.jsx
<div className='pd1y tree-list-search-toolbar'>

// ai-chat.jsx
<Segmented
  className='ai-mode-segmented'
  size='small'
  value={mode}
  onChange={value => setMode(value)}
  options={[
    {
      label: e('shellpilotAiModeChat'),
      value: 'ask'
    },
    {
      label: e('shellpilotAiModeAgent'),
      value: 'agent',
      disabled: agentRunning
    }
  ]}
/>
```

Style both tree wrappers as toolbar cards; keep tree rows flat:

```stylus
.tree-list-action-toolbar,
.tree-list-search-toolbar
  margin-right 8px
  margin-bottom 8px
  padding 8px
  background-color var(--sp-surface-elevated)
  background-image var(--sp-card-background)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-toolbar)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-card)
```

Style the AI segmented control:

```stylus
.ai-mode-segmented
  color var(--sp-text)
  background-color var(--sp-surface-inset)
  background-image var(--sp-control-background)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-control)
  box-shadow var(--sp-shadow-control)
  .ant-segmented-item-label
    color var(--sp-text)
  .ant-segmented-item-disabled .ant-segmented-item-label
    color var(--sp-text-disabled)
    opacity 1
```

- [ ] **Step 6: Verify GREEN and commit**

```powershell
node --test test/unit-ci/glacier-silver-ui-style-contract.spec.js test/unit-ci/operations-workspace-style.spec.js test/unit-ci/server-maintenance-quick-commands.spec.js
git add -- apps/electerm-agent/src/client/components/quick-commands/qm.styl apps/electerm-agent/src/client/components/operations-toolkit/workspace/operations-workspace.styl apps/electerm-agent/src/client/components/fleet-status/fleet-status.styl apps/electerm-agent/src/client/components/artifacts/artifacts.styl apps/electerm-agent/src/client/components/incidents/incidents.styl apps/electerm-agent/src/client/components/side-panel-r/right-side-panel.styl apps/electerm-agent/src/client/components/sidebar/sidebar.styl apps/electerm-agent/src/client/components/tree-list/tree-list.jsx apps/electerm-agent/src/client/components/tree-list/bookmark-toolbar.jsx apps/electerm-agent/src/client/components/tree-list/tree-list.styl apps/electerm-agent/src/client/components/ai/ai-chat.jsx apps/electerm-agent/src/client/components/ai/ai.styl apps/electerm-agent/test/unit-ci/glacier-silver-ui-style-contract.spec.js apps/electerm-agent/test/unit-ci/operations-workspace-style.spec.js apps/electerm-agent/test/unit-ci/server-maintenance-quick-commands.spec.js
git commit -m "fix(ui): align client action cards and toolbars"
```

Expected: PASS; no functional JSX change beyond class names.

### Task 5: Audit settings, overlays, AI, and flat-data exclusions

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/glacier-silver-ui-style-contract.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`
- Modify only when a failing assertion identifies one concrete Stylus file.

- [ ] **Step 1: Add audit assertions**

Require overlays, settings, and AI grouped surfaces to remain elevated:

```js
assert.match(modal, /\.custom-modal-content[\s\S]{0,320}var\(--sp-shadow-overlay\)/)
assert.match(drawer, /\.custom-drawer-content-wrapper[\s\S]{0,320}var\(--sp-shadow-overlay\)/)
assert.match(contextMenu, /\.ant-dropdown-menu[\s\S]{0,560}var\(--sp-shadow-overlay\)/)
assert.match(setting, /\.sp-setting-section[\s\S]{0,420}background-image var\(--sp-card-background\)/)
assert.match(ai, /\.sp-ai-config-form[\s\S]{0,420}background-image var\(--sp-panel-background\)/)
assert.match(ai, /\.ai-composer-surface[\s\S]{0,420}background-image var\(--sp-control-background\)/)
```

Retain explicit flat-data contracts for terminal canvas, SFTP rows, tables, Markdown code, logs, history, operations output, and AI generated output. Add a scan rejecting `color: transparent`, label `opacity: 0`, and any reintroduced descendant-wide nested-card shadow cancellation in touched styles.

- [ ] **Step 2: Run all focused contracts**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js test/unit-ci/operations-workspace-style.spec.js test/unit-ci/server-maintenance-quick-commands.spec.js
```

Expected: PASS. If one assertion fails, it must identify one concrete surface.

- [ ] **Step 3: Fix concrete audit failures only**

Use this mapping and no new high-priority global override:

```text
control: control background + 12px + control shadow
toolbar: card background + 16px + card shadow
action card: card background + 18px + card shadow
panel: panel background + 22px + panel shadow
overlay: overlay background + 24px + overlay shadow
flat data: flat background + no background image + no shadow
```

Do not modify events, labels, component order, data, persistence, APIs, SSH/SFTP/AI behavior, permissions, or safety flow.

- [ ] **Step 4: Re-run tests and optionally commit**

Run the command from Step 2. If Step 3 changed files, stage only those files and associated tests, then:

```powershell
git commit -m "fix(ui): close shared surface consistency gaps"
```

If no files changed in Step 3, skip this commit.

### Task 6: Automated regression and production validation

**Files:**
- No production files unless a failing test isolates a regression.

- [ ] **Step 1: Run complete unit CI**

```powershell
npm run test-unit-ci
```

Expected: exit 0, zero failed tests.

- [ ] **Step 2: Run lint**

```powershell
npm run lint
```

Expected: exit 0; fix only branch-introduced lint errors.

- [ ] **Step 3: Run targeted Electron E2E after user-approved Playwright use**

```powershell
npx playwright test test/e2e/023.fleet-status.spec.js test/e2e/032.operations-toolkit.spec.js test/e2e/034.incident-archive-foundation.spec.js --workers=1
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --grep "AI config stays|English tool cards stay|sidebar standard tiles|shell chrome keeps|settings search supports|tool center and batch editor" --workers=1
npx cross-env SHELLPILOT_VISUAL_MATRIX_SMOKE=1 playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --grep "real app covers the secondary UI visual acceptance matrix" --workers=1
```

Expected: every command exits 0 and the smoke matrix reports its computed expected count.

- [ ] **Step 4: Run production build**

```powershell
npm run vite-build
```

Expected: exit 0 with no missing-module or Stylus errors.

- [ ] **Step 5: Check patch integrity**

From the worktree root:

```powershell
git diff --check
git status --short
```

Expected: no diff-check output; pre-existing `apps/electerm-agent/release-verification/` remains untracked and unstaged.

### Task 7: Same-viewport Product Design QA

**Files:**
- Create: `apps/electerm-agent/design-qa.md`
- Create/update screenshots only under Playwright output or existing QA output directories.

- [ ] **Step 1: Capture matching states**

Use all seven user PNGs as references. Capture matching implementation states at `1920×1080`, `100%`, simplified Chinese in `shellpilot-glacier`; capture representative paired states in `shellpilot-graphite-silver`.

- [ ] **Step 2: Compare source and implementation together**

Record for every state:

```text
surface classification
continuous silver gradient with no hard reflective band
12/16/18/22/24px semantic radius
B-level shadow strength
readable text, placeholder, disabled label, tag, and primary button
no clipping, overflow, focus loss, or layout movement
flat terminal/SFTP/table/log/history/output
```

Fix all P0/P1/P2 issues, rerun the focused failing test, and recapture. Keep P3 polish as notes.

- [ ] **Step 3: Write the blocking QA report**

`apps/electerm-agent/design-qa.md` must contain the following sections and real evidence:

```markdown
# ShellPilot Glacier Silver Consistency Design QA

## Scope
- Baseline: v0.4.32 / faf17bf
- Target: option B, Glacier Silver + Graphite Silver
- Reference viewport: 1920×1080 at 100%

## Iterations
### Iteration 1
- Reference images: seven user-provided PNGs
- Implementation captures: enumerate every capture path produced by Step 1.
- Findings: enumerate every observed P0, P1, P2, and P3 issue.
- Fixes applied: map each resolved P0, P1, and P2 issue to its code change.

## Regression matrix
- Themes: Glacier Silver, Graphite Silver, built-in-theme smoke
- Sizes/zoom/language/states: record the exact cases actually executed.
- Automated evidence: record every command, exit code, and pass/fail count.

## Remaining P3 notes
- None

final result: passed
```

Write `final result: passed` only after all P0/P1/P2 findings and fresh automated checks are green. If capture is blocked, write `final result: blocked` with the exact reason.

- [ ] **Step 4: Run final verification after visual fixes**

```powershell
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-ui-palettes.spec.js test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js test/unit-ci/operations-workspace-style.spec.js test/unit-ci/server-maintenance-quick-commands.spec.js
npm run test-unit-ci
npm run lint
npm run vite-build
```

Re-run each E2E whose surface changed during QA.

- [ ] **Step 5: Commit QA**

```powershell
git add -- apps/electerm-agent/design-qa.md
git commit -m "test(ui): verify glacier silver consistency"
```

Include verified QA-fix files and their tests in this commit only when they were changed after the previous implementation commits.

### Task 8: Final scope audit and local handoff

**Files:**
- No new files.

- [ ] **Step 1: Audit the UI-only boundary**

```powershell
git diff faf17bf..HEAD --name-status
git diff faf17bf..HEAD --stat
git diff faf17bf..HEAD -- apps/electerm-agent/src/app apps/electerm-agent/src/client/store
```

Expected: no `src/app` files; `store.js` changes only theme construction/import; no API, SSH, SFTP, AI runtime, persistence, shortcut, permission, safety, label, route, or component-order change.

- [ ] **Step 2: Verify final repository state**

```powershell
git status --short --branch
git log --oneline --decorate -8
git diff --check faf17bf..HEAD
```

Expected: only pre-existing untracked release-verification evidence remains; implementation and QA are committed; diff check is empty.

- [ ] **Step 3: Keep the verified local client open**

Leave the verified local ShellPilot build running for inspection. Report the branch, commits, commands, evidence paths, and remaining P3 notes. Do not publish an online update until the user inspects and explicitly approves this local build.
