# ShellPilot Bilingual UI Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every built-in non-terminal ShellPilot UI surface complete and previewable in Simplified Chinese and English while preserving input state, existing upstream locale support, business behavior, and terminal output.

**Architecture:** Keep the existing `window.translate` and `shellpilot-i18n-overrides.js` fallback chain, add dynamic Ant Design locale selection and correct first-run system-language detection, then migrate presentation copy in auditable surface batches. A Babel-based coverage test blocks new hard-coded user-facing JSX copy and verifies all ShellPilot-prefixed keys exist in both supported catalogs; business models continue to emit stable codes/data and presentation components translate them.

**Tech Stack:** Electron 41, React 19, Ant Design 6 locales, Manate store, Babel parser/traverse, Node test runner, Playwright.

---

## Execution context and file map

Execute after the light-depth and UI-font plans in the same isolated `codex/ui-modernization` worktree. Simplified Chinese (`zh_cn`) and English (`en_us`) are the complete ShellPilot languages. Preserve existing upstream locale entries in the selector to avoid removing a client capability; ShellPilot-specific copy for other locales follows the existing English fallback.

Primary responsibilities:

- Modify `src/app/lib/ipc.js`: choose first-run language from stored user config plus OS locale, not from merged defaults.
- Modify `src/client/components/main/main.jsx`: switch Ant Design between `zh_CN` and `en_US` during preview and after save.
- Modify `src/client/components/setting-panel/setting-header.jsx`: save the previewed language without requiring an unnecessary reload.
- Modify `src/client/common/shellpilot-i18n-overrides.js`: add paired ShellPilot catalog entries and retain the existing fallback order.
- Modify presentation components under the scoped surface batches below: replace hard-coded UI copy with translation keys without changing event handlers or model/data behavior.
- Create `test/unit-ci/ui-language-runtime.spec.js`: first-run locale, Ant locale, and preview/apply/cancel contracts.
- Create `test/unit-ci/ui-localization-coverage.spec.js`: hard-coded presentation-copy audit and paired-key enforcement.
- Modify `test/unit-ci/shellpilot-i18n-overrides.spec.js`: catalog parity, non-empty values, and representative domain copy.
- Modify `test/unit-ci/setting-search-index.spec.js`: update the apply-language source contract for reload-free persistence.
- Modify `test/e2e/022.secondary-ui-visual-matrix.spec.js`: bilingual preview, state retention, text wrapping, and terminal invariants.

Explicit exclusions:

- Server command output, SSH shell output, transfer protocol output rendered inside the terminal, and log originals.
- User-entered names, hostnames, paths, commands, theme names, model responses, and remote error text.
- Internal diagnostic codes, security classifiers, AI prompt templates, regular expressions, comments, and console-only logs.
- Translation of business-model values in place. Models return stable codes; React presentation translates those codes.

### Task 1: Correct the language runtime and Ant Design locale

**Files:**
- Create: `apps/electerm-agent/test/unit-ci/ui-language-runtime.spec.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Modify: `apps/electerm-agent/src/client/components/main/main.jsx`

- [ ] **Step 1: Write the failing runtime contract tests**

Create `ui-language-runtime.spec.js` with source assertions plus a direct `getLang` test:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('first run resolves OS language from stored config before merged defaults', () => {
  const ipc = read('src/app/lib/ipc.js')
  assert.match(ipc, /const \{\s*userConfig,\s*config\s*\} = await getConfig/)
  assert.match(ipc, /getLang\(userConfig, sysLocale, langs\)/)
  assert.doesNotMatch(ipc, /getLang\(config, sysLocale, langs\)/)
})

test('Ant Design follows effective preview or saved language', () => {
  const main = read('src/client/components/main/main.jsx')
  assert.match(main, /import enUS from 'antd\/locale\/en_US'/)
  assert.match(main, /const effectiveLanguage = store\.previewLanguage \|\| config\.language \|\| 'zh_cn'/)
  assert.match(main, /locale=\{effectiveLanguage === 'en_us' \? enUS : zhCN\}/)
})

test('preview apply cancel remains explicit and does not require reload', () => {
  const header = read('src/client/components/setting-panel/setting-header.jsx')
  assert.match(header, /handlePreviewLanguage/)
  assert.match(header, /store\.setConfig\(\{ language \}\)/)
  assert.match(header, /handleCancelLanguage/)
  assert.match(header, /store\.previewLanguage = ''/)
  assert.doesNotMatch(header, /window\.location\.reload/)
})
```

- [ ] **Step 2: Run the new test and verify failure**

```powershell
node --test test/unit-ci/ui-language-runtime.spec.js
```

Expected: FAIL because IPC currently passes merged `config` and Ant Design is hard-coded to `zhCN`.

- [ ] **Step 3: Use stored config for first-run language detection**

Change `initAppServer` in `src/app/lib/ipc.js` to:

```js
const {
  userConfig,
  config
} = await getConfig(globalState.get('serverInited'))
const {
  langs,
  sysLocale
} = await loadLocales()
const language = getLang(userConfig, sysLocale, langs)
config.language = language
```

Persisted `userConfig.language` therefore wins; a first run with no stored language follows the OS; unsupported OS locales continue to use `defaultLang` (`zh_cn`). Do not change existing users' saved values.

- [ ] **Step 4: Make Ant Design follow preview language**

In `main.jsx`, import both locales and access the observable preview value:

```jsx
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'

const effectiveLanguage = store.previewLanguage || config.language || 'zh_cn'
// ...
<ConfigProvider
  theme={uiThemeConfig}
  locale={effectiveLanguage === 'en_us' ? enUS : zhCN}
>
```

Keep the existing SettingHeader preview/apply/cancel flow, but replace the post-save restart action with a normal saved notification because Ant Design and ShellPilot copy now update live:

```jsx
if (language && language !== store.config.language) {
  store.setConfig({ language })
  store.previewLanguage = ''
  notification.success({ message: e('saved') })
  return
}
store.previewLanguage = ''
```

Update the corresponding source assertions in `setting-search-index.spec.js`. Do not reload during preview or after Apply.

- [ ] **Step 5: Run runtime and existing language tests**

```powershell
node --test test/unit-ci/ui-language-runtime.spec.js test/unit-ci/setting-search-index.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit the runtime fix**

```powershell
git add src/app/lib/ipc.js src/client/components/main/main.jsx src/client/components/setting-panel/setting-header.jsx test/unit-ci/ui-language-runtime.spec.js test/unit-ci/setting-search-index.spec.js
git commit -m "feat: align UI locale with language preview"
```

### Task 2: Create the hard-coded presentation-copy audit

**Files:**
- Create: `apps/electerm-agent/test/unit-ci/ui-localization-coverage.spec.js`

- [ ] **Step 1: Implement the audit test with the first surface batch**

Create a parser-based test. It must inspect visible JSX text, user-facing JSX attributes, and label/title/description/message option maps, while ignoring comments and internal strings:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const root = path.resolve(__dirname, '../../src/client')
const allowedTechnicalCopy = new Set([
  'ShellPilot', 'SSH', 'SFTP', 'AI', 'API', 'MCP', 'CLI', 'GitHub',
  'ModelScope', 'Windows', 'macOS', 'Linux', 'RDP', 'VNC', 'SPICE',
  'Telnet', 'Serial', 'HTTP', 'HTTPS', 'WebSocket', 'JSON'
])
const userFacingAttributes = new Set([
  'title', 'placeholder', 'aria-label', 'alt', 'label', 'description'
])
const userFacingMapNames = /(?:labels|titles|descriptions|messages|options)$/i

function meaningfulCopy (value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text || allowedTechnicalCopy.has(text)) return false
  if (/\p{Script=Han}/u.test(text)) return true
  return /[A-Za-z]{3,}/.test(text)
}

function location (file, node, value) {
  return `${file}:${node.loc?.start.line || 0}: ${String(value).replace(/\s+/g, ' ').trim()}`
}

function collectViolations (relativeFile) {
  const absolute = path.join(root, relativeFile)
  const source = fs.readFileSync(absolute, 'utf8')
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] })
  const violations = []
  const isTranslationArgument = item => {
    const call = item.findParent(parent => parent.isCallExpression())
    const name = call?.node?.callee?.name || ''
    return ['e', 'translate', 'formatShellPilotTranslation'].includes(name)
  }
  traverse(ast, {
    JSXText (item) {
      if (meaningfulCopy(item.node.value)) violations.push(location(relativeFile, item.node, item.node.value))
    },
    JSXAttribute (item) {
      const name = item.node.name?.name
      const value = item.node.value?.type === 'StringLiteral' ? item.node.value.value : ''
      if (userFacingAttributes.has(name) && meaningfulCopy(value)) {
        violations.push(location(relativeFile, item.node, value))
      }
    },
    StringLiteral (item) {
      if (isTranslationArgument(item)) return
      const owner = item.findParent(parent => parent.isVariableDeclarator())
      const name = owner?.node?.id?.name || ''
      const inJsx = Boolean(item.findParent(parent => parent.isJSXExpressionContainer()))
      if ((inJsx || userFacingMapNames.test(name)) && meaningfulCopy(item.node.value)) {
        violations.push(location(relativeFile, item.node, item.node.value))
      }
    },
    TemplateLiteral (item) {
      const value = item.node.quasis.map(part => part.value.cooked).join(' ')
      const owner = item.findParent(parent => parent.isVariableDeclarator())
      const name = owner?.node?.id?.name || ''
      const inJsx = Boolean(item.findParent(parent => parent.isJSXExpressionContainer()))
      if ((inJsx || userFacingMapNames.test(name)) && meaningfulCopy(value)) {
        violations.push(location(relativeFile, item.node, value))
      }
    }
  })
  return [...new Set(violations)]
}

const coreSurfaceFiles = [
  'components/main/aigshell-topbar.jsx',
  'components/setting-panel/setting-header.jsx',
  'components/setting-panel/setting-common.jsx',
  'components/setting-panel/setting-modal.jsx',
  'components/theme/theme-gallery.jsx',
  'components/theme/theme-form.jsx',
  'components/theme/theme-editor.jsx',
  'components/common/modal.jsx',
  'components/common/notification.jsx'
]

test('core UI surfaces contain no hard-coded presentation copy', () => {
  const violations = coreSurfaceFiles.flatMap(collectViolations)
  assert.deepEqual(violations, [], violations.join('\n'))
})
```

Add a second test that parses `e('shellpilot...')` calls in audited files and confirms each referenced key appears in both `getShellPilotCatalogKeys('zh_cn')` and `getShellPilotCatalogKeys('en_us')`.

- [ ] **Step 2: Run the audit and capture the real failures**

```powershell
node --test test/unit-ci/ui-localization-coverage.spec.js
```

Expected: FAIL with exact file/line/text entries for remaining hard-coded copy in the first batch. Save this output in the implementation log; it is the migration inventory, not a reason to weaken the test.

### Task 3: Migrate shell, settings, themes, and common overlays

**Files:**
- Modify: files in `coreSurfaceFiles` from Task 2 as reported by the audit
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-i18n-overrides.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ui-localization-coverage.spec.js`

- [ ] **Step 1: Add paired catalog entries before replacing literals**

Use stable semantic keys. Add both languages in the same edit. Representative required mappings:

```js
// zh_cn
shellpilotClose: '关闭',
shellpilotApplyLanguage: '应用语言',
shellpilotCancelLanguagePreview: '取消并恢复',
shellpilotLanguagePreviewNotice: '正在预览界面语言，应用后保存。',
shellpilotThemeImport: '导入主题',
shellpilotThemeDelete: '删除主题',
shellpilotThemeDeleteConfirm: '确定删除此主题吗？',
shellpilotCopyNotification: '复制通知内容',

// en_us
shellpilotClose: 'Close',
shellpilotApplyLanguage: 'Apply Language',
shellpilotCancelLanguagePreview: 'Cancel and Restore',
shellpilotLanguagePreviewNotice: 'Previewing the interface language. Apply to save it.',
shellpilotThemeImport: 'Import Theme',
shellpilotThemeDelete: 'Delete Theme',
shellpilotThemeDeleteConfirm: 'Delete this theme?',
shellpilotCopyNotification: 'Copy notification content',
```

Use existing upstream keys such as `close`, `apply`, and `cancel` when their wording and semantics already match. Add ShellPilot-prefixed keys only for missing or product-specific copy.

- [ ] **Step 2: Replace presentation literals without changing handlers**

For direct JSX:

```jsx
// before
<Button title='删除主题'>删除主题</Button>

// after
<Button title={e('shellpilotThemeDelete')}>{e('shellpilotThemeDelete')}</Button>
```

For label maps, store keys and translate during render:

```js
const statusLabelKeys = {
  applied: 'themeApplied',
  readonly: 'themeReadonly'
}

function getStatusLabel (status) {
  return e(statusLabelKeys[status] || 'unknown')
}
```

For interpolated copy, use the existing formatter:

```js
formatShellPilotTranslation(e, 'shellpilotItemsSelected', { count })
```

Do not translate identifiers, CSS class names, theme IDs, filenames, or user content.

- [ ] **Step 3: Run the core audit and catalog tests**

```powershell
node --test test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/theme-field-labels.spec.js test/unit-ci/theme-preview.spec.js
```

Expected: PASS with zero core-surface violations and identical ShellPilot key sets in `zh_cn` and `en_us`.

- [ ] **Step 4: Commit the core migration**

```powershell
git add src/client/components/main src/client/components/setting-panel src/client/components/theme src/client/components/common src/client/common/shellpilot-i18n-overrides.js test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
git commit -m "feat: localize shell settings and themes"
```

Before committing, inspect `git diff --cached --name-only` and unstage any file outside the audited UI-copy changes. Do not stage unrelated AI work from another branch.

### Task 4: Migrate connection, file, SFTP, and terminal-wrapper UI

**Files:**
- Modify presentation `.jsx` files under:
  - `apps/electerm-agent/src/client/components/bookmark-form/`
  - `apps/electerm-agent/src/client/components/profile/`
  - `apps/electerm-agent/src/client/components/sidebar/`
  - `apps/electerm-agent/src/client/components/sftp/`
  - `apps/electerm-agent/src/client/components/file-transfer/`
  - `apps/electerm-agent/src/client/components/terminal/`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/ui-localization-coverage.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-file-context-i18n.spec.js`

- [ ] **Step 1: Expand the audit target deterministically**

Add a recursive helper to the audit test and include `.jsx` files only from the six directories:

```js
function jsxFilesUnder (relativeDirectory) {
  const directory = path.join(root, relativeDirectory)
  const files = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.name.endsWith('.jsx')) {
        files.push(path.relative(root, absolute).replace(/\\/g, '/'))
      }
    }
  }
  visit(directory)
  return files.sort()
}

const connectionSurfaceFiles = [
  ...jsxFilesUnder('components/bookmark-form'),
  ...jsxFilesUnder('components/profile'),
  ...jsxFilesUnder('components/sidebar'),
  ...jsxFilesUnder('components/sftp'),
  ...jsxFilesUnder('components/file-transfer'),
  ...jsxFilesUnder('components/terminal')
]
```

Do not add `.js` protocol/model files to this presentation audit. Terminal-emitted status lines and raw remote errors remain outside this UI-language task.

- [ ] **Step 2: Run the expanded audit and capture exact violations**

```powershell
node --test test/unit-ci/ui-localization-coverage.spec.js
```

Expected: FAIL with a bounded list of visible JSX copy.

- [ ] **Step 3: Add paired domain keys and migrate each violation**

Use domain prefixes and preserve stable values. Required patterns include:

```js
// keys, not translated values, in presentation maps
const connectionStateLabelKeys = {
  connecting: 'shellpilotConnecting',
  connected: 'shellpilotConnected',
  failed: 'shellpilotConnectionFailed'
}

const transferStateLabelKeys = {
  queued: 'shellpilotTransferQueued',
  running: 'shellpilotTransferRunning',
  completed: 'shellpilotTransferCompleted',
  failed: 'shellpilotTransferFailed',
  cancelled: 'shellpilotTransferCancelled'
}
```

Translate at the final React render boundary. Keep thrown internal errors and remote protocol messages intact unless the component supplies a built-in user-facing wrapper; translate only that wrapper. Keep terminal canvas/output strings unchanged.

- [ ] **Step 4: Run connection/file tests**

```powershell
node --test test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/sftp-file-context-i18n.spec.js test/unit-ci/bookmark-context-menu.spec.js test/unit-ci/terminal-context-menu.spec.js test/unit-ci/context-menu-props.spec.js
npx playwright test test/e2e/018.file-transfer.spec.js test/e2e/020.context-menu-ant6-layout.spec.js --workers=1
```

Expected: PASS; menu commands and transfer/connection actions behave exactly as before in both languages.

- [ ] **Step 5: Commit the connection/file migration**

```powershell
git add src/client/components/bookmark-form src/client/components/profile src/client/components/sidebar src/client/components/sftp src/client/components/file-transfer src/client/components/terminal src/client/common/shellpilot-i18n-overrides.js test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/sftp-file-context-i18n.spec.js
git commit -m "feat: localize connection and file UI"
```

### Task 5: Migrate AI, safety, fleet, widgets, status, update, and help UI

**Files:**
- Modify presentation `.jsx` files under:
  - `apps/electerm-agent/src/client/components/ai/`
  - `apps/electerm-agent/src/client/components/fleet-status/`
  - `apps/electerm-agent/src/client/components/widgets/`
  - `apps/electerm-agent/src/client/components/batch-op/`
  - `apps/electerm-agent/src/client/components/server-status/`
  - `apps/electerm-agent/src/client/components/main/`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/ui-localization-coverage.spec.js`
- Modify relevant existing unit UI specs for AI, fleet, widgets, update, and safety components.

- [ ] **Step 1: Expand the audit to the final surface batch**

Use `jsxFilesUnder` for the six directories. Exclude model prompt builders, server commands, diagnostic raw data, and model-generated content by continuing to scan presentation `.jsx` files only.

- [ ] **Step 2: Run the audit and capture exact remaining violations**

```powershell
node --test test/unit-ci/ui-localization-coverage.spec.js
```

Expected: FAIL with exact UI file/line/text entries.

- [ ] **Step 3: Keep model state language-neutral and translate in views**

Where status labels are currently Chinese values, convert the view layer to key maps:

```js
const fleetStatusLabelKeys = {
  pending: 'shellpilotFleetPending',
  connecting: 'shellpilotFleetConnecting',
  connected: 'shellpilotFleetConnected',
  failed: 'shellpilotFleetFailed',
  offline: 'shellpilotFleetOffline',
  timeout: 'shellpilotFleetTimeout',
  permission: 'shellpilotPermissionDenied',
  unsupported: 'shellpilotUnsupported',
  cancelled: 'shellpilotCancelled'
}

function fleetStatusLabel (status) {
  return e(fleetStatusLabelKeys[status] || 'unknown')
}
```

For count/time strings, use paired templates:

```js
formatShellPilotTranslation(e, 'shellpilotFleetSelectedServers', { count })
formatShellPilotTranslation(e, 'shellpilotUpdatedMinutesAgo', { minutes })
```

For AI and safety surfaces, translate the client-owned button, state, confirmation, validation, and wrapper copy. Do not translate model responses, user prompts, command text, remote output, or safety-classifier inputs.

- [ ] **Step 4: Run the final surface unit suite**

```powershell
node --test test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/agent-skill-manager-ui.spec.js test/unit-ci/agent-tool-presentation.spec.js test/unit-ci/fleet-status-ui.spec.js test/unit-ci/widgets-localization.spec.js test/unit-ci/update-center.spec.js test/unit-ci/secondary-config-ui.spec.js
```

Expected: PASS with zero hard-coded presentation-copy violations and no missing paired keys.

- [ ] **Step 5: Commit the final surface migration**

```powershell
git add src/client/components/ai src/client/components/fleet-status src/client/components/widgets src/client/components/batch-op src/client/components/server-status src/client/components/main src/client/common/shellpilot-i18n-overrides.js test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/agent-skill-manager-ui.spec.js test/unit-ci/agent-tool-presentation.spec.js test/unit-ci/fleet-status-ui.spec.js test/unit-ci/widgets-localization.spec.js test/unit-ci/update-center.spec.js test/unit-ci/secondary-config-ui.spec.js
git commit -m "feat: complete bilingual client UI copy"
```

If any listed AI file has unrelated changes in another worktree, migrate from the clean integration branch version and resolve by behavior, not by copying the dirty file wholesale.

### Task 6: Verify preview state retention and long-text layout

**Files:**
- Modify: `apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-ui-responsive.spec.js`

- [ ] **Step 1: Add failing language-preview state tests**

Extend the existing language lifecycle test to fill a settings input, record focus and scroll position, preview the other language, and confirm all three survive:

```js
const searchInput = page.locator('.setting-header-search input')
await searchInput.fill('theme')
await searchInput.focus()
const before = await page.evaluate(() => ({
  activeValue: document.activeElement?.value,
  scrollTop: document.querySelector('.setting-wrap')?.scrollTop || 0,
  theme: window.store.config.theme,
  uiFont: window.store.config.uiFontPresetId
}))

await page.evaluate(() => { window.store.previewLanguage = 'en_us' })

const during = await page.evaluate(() => ({
  activeMatchesSearch: document.activeElement === document.querySelector('.setting-header-search input'),
  activeValue: document.activeElement?.value,
  scrollTop: document.querySelector('.setting-wrap')?.scrollTop || 0,
  theme: window.store.config.theme,
  uiFont: window.store.config.uiFontPresetId,
  preview: window.store.previewLanguage
}))
expect(during.activeValue).toBe(before.activeValue)
expect(during.activeMatchesSearch).toBe(true)
expect(during.scrollTop).toBe(before.scrollTop)
expect(during.theme).toBe(before.theme)
expect(during.uiFont).toBe(before.uiFont)
expect(during.preview).toBe('en_us')
```

Cancel and assert saved language remains unchanged; repeat and Apply, then assert only `language` changes.

- [ ] **Step 2: Add text-collision checks across the matrix**

For every tested surface at 590px, 820px, and desktop widths, and zoom 100/125/150/175/200, collect visible text elements and reject overlap with sibling buttons/shortcut columns. Retain the existing document-overflow checks. At minimum cover settings header actions, font-picker rows, context-menu labels plus shortcut extras, modal footers, AI action bars, fleet toolbars, and notifications.

Use rectangle intersection with a 1px tolerance:

```js
function rectanglesOverlap (left, right) {
  return left.left < right.right - 1 &&
    left.right > right.left + 1 &&
    left.top < right.bottom - 1 &&
    left.bottom > right.top + 1
}
```

- [ ] **Step 3: Run the focused matrix and verify any failures before fixes**

```powershell
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js --grep "language|visual acceptance matrix" --workers=1
```

Expected before final CSS/copy corrections: any remaining collision is reported with surface, language, size, and zoom context.

- [ ] **Step 4: Fix layout only in the owning component styles**

Use `min-width: 0`, natural wrapping, `overflow-wrap: anywhere` for help/error text, flexible grid columns, and wrapping action rows. Keep ellipsis only for filenames, hostnames, model names, and technical IDs with a title/tooltip containing the full value. Do not shorten translations to hide a layout defect.

- [ ] **Step 5: Run the full bilingual visual matrix**

```powershell
node --test test/unit-ci/shellpilot-ui-responsive.spec.js test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
npx playwright test test/e2e/020.context-menu-ant6-layout.spec.js test/e2e/021.secondary-ui-state.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1
```

Expected: exit code 0; zero collision, clipping, focus, state-retention, overflow, or terminal-invariant failures.

- [ ] **Step 6: Commit bilingual layout coverage**

```powershell
git add test/e2e/022.secondary-ui-visual-matrix.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
git commit -m "test: cover bilingual preview and text layout"
```

### Task 7: Run the bilingual subsystem and integration acceptance gate

**Files:**
- Verify only; modify code only for reproducible failures within the approved spec.

- [ ] **Step 1: Run lint and the complete unit suite**

```powershell
npm run lint
npm run test-unit-ci
```

Expected: exit code 0 and zero failed tests.

- [ ] **Step 2: Run settings, theme, menu, and visual end-to-end tests**

```powershell
npx playwright test test/e2e/009.basic.themes.spec.js test/e2e/020.context-menu-ant6-layout.spec.js test/e2e/021.secondary-ui-state.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1
```

Expected: exit code 0.

- [ ] **Step 3: Run core-flow regression tests**

```powershell
npm run test1
npm run test2
npm run test3
npm run test-quality-e2e
```

Expected: exit code 0; connection, settings, SSH/SFTP, AI, history, and recovery behaviors are unchanged.

- [ ] **Step 4: Perform local-client bilingual verification**

```powershell
npm run app
```

In both `zh_cn` and `en_us`, inspect top bar, sidebar, settings categories and all configuration pages, theme editor, font picker, every reachable right-click menu, modal, notification, AI panel, SFTP/file UI, server/fleet status, tool center, update center, help, empty states, validation errors, and danger confirmations. Confirm user values and remote/model content are not translated.

Open a real SSH session and verify the terminal remains `#0E0F12`, readable, and functionally unchanged after theme, font, and language previews and saves.

- [ ] **Step 5: Stop at the approved local-release boundary**

Prepare a verification report listing commands, pass/fail counts, screenshots, and any accepted limitations. Do not push, upload, publish an update, or run release commands until the user explicitly authorizes release after reviewing the local client.
