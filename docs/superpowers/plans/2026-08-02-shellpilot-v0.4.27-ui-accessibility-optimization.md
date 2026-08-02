# ShellPilot v0.4.27 UI Accessibility Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ShellPilot v0.4.26 最新代码之上完成已批准的 UI、文案与无障碍优化，保持全部功能入口、业务流程、安全机制和服务器现有服务不变，经过三轮自检后发布 v0.4.27 并验证双在线更新源。

**Architecture:** 继续使用现有 React 19、Ant Design 6、Stylus、Manate 和 Aurora 主题层。全局层只补充展示令牌、通用弹窗/抽屉可访问性与焦点隔离；页面层只增加展示类名、标准语义、文案和响应式样式；所有点击处理器、store、IPC、SSH/SFTP/AI/运维命令、安全事务、更新下载与安装逻辑保持原样。

**Tech Stack:** Electron 41.2、React 19.2、Ant Design 6.4、Stylus 0.64、Manate 2、Node.js test runner、StandardJS、Playwright 1.61、electron-builder 26.15、GitHub CLI、ModelScope Hub。

**Approved design:** `F:\SSH工具开发\.worktrees\release-0.4.24\docs\superpowers\specs\2026-08-02-shellpilot-v0.4.27-ui-accessibility-optimization-design.md`

**Execution directory:** 除明确标注仓库根目录的步骤外，Task 1–18 的命令都从 `F:\SSH工具开发\.worktrees\release-0.4.24\apps\electerm-agent` 执行。文中的 `src/`、`test/`、`build/`、`dist/` 和 `docs/releases/` 均相对于该目录；审计证据统一写入仓库根目录下的 `../../docs/audits/`。

**Release boundary:** 不自动收起 AI 面板；不新增帮助搜索或目录跳转；不改变“保存为连接”的默认勾选；不禁止测试前直接连接；不新增未保存确认；不新增 store、持久化键、API、IPC 或后台任务；不修改、重启或重载 VPS 上的 x-ui、sshd、防火墙、容器、数据库、Web 服务和业务目录。

---

## File structure and responsibility map

New focused files:

- `src/client/common/dialog-background-isolation.js`: 对 `#container` 做引用计数式 `inert`/`aria-hidden` 隔离并恢复原属性。
- `src/client/common/server-status-presentation.js`: 只根据已有状态生成严重度、影响和建议的展示模型。
- `src/client/common/sftp-accessibility.js`: 只根据已有文件字段生成 SFTP 行可访问名称。
- `test/unit-ci/v0427-scope-guard.spec.js`: 固化入口顺序、字段、默认值和禁止变更边界。
- `test/unit-ci/ui-accessibility-contract.spec.js`: 弹窗、抽屉、终端标签页、SFTP、设置导航和控件名称契约。
- `test/unit-ci/v0427-ui-style-contract.spec.js`: 视觉层级、焦点、状态、响应式和 reduced-motion 契约。
- `test/e2e/035.v0427-ui-accessibility.spec.js`: 纯键盘、弹窗隔离、焦点恢复、可访问树和 14 个界面证据。
- `../../docs/audits/2026-08-02-v0.4.27-ui-accessibility/requirements-matrix.md`: 166 项最新版复核副本和证据更新。
- `../../docs/audits/2026-08-02-v0.4.27-ui-accessibility/final-report.md`: 三轮自检、服务保护、构建、发布和剩余限制总报告。
- `docs/releases/v0.4.27.md`: `[新增]`、`[修复]`、`[改动]` 三段发布说明。

Existing files keep their current business responsibilities. This plan changes only presentation, semantics, tests, evidence, version metadata, and release artifacts.

---

## Approved design coverage

| 已批准范围 | 实施任务 | 验收任务 |
|---|---|---|
| 全局主题、顶部导航、窗口控制、通用弹窗/抽屉、Toast、减少动态效果 | 2–3 | 14–15 |
| 连接向导三步、显式标签、必填/可选/本地保存说明 | 4 | 14–15 |
| 终端/SFTP 标签页、会话图标按钮、状态与焦点 | 5 | 14–15 |
| SFTP 双栏、表头、文件行、排序/选中/焦点/完整名称 | 6 | 15–16 |
| AI 未配置空状态、模型 API 首次配置路径与状态层级 | 7 | 14–15 |
| 服务器状态的异常严重度、影响、建议和只读说明 | 8 | 15–16 |
| 安全中心汇总/标签计数层级、筛选、记录语义和空状态 | 9 | 14–15 |
| 运维工具卡片密度、底部工作区滚动、多面板并存和安全标签 | 10 | 15–16 |
| 帮助章节层级与长内容滚动，不增加搜索/目录 | 11 | 14–15 |
| 更新日志结构化渲染、版本/来源/状态层级 | 11 | 15、17–18 |
| 设置三层导航、左侧分类、数字控件、代理/字体/主题/开关文案 | 12–13 | 14–15 |
| 三轮自检、166 项需求、VPS 沙箱、x-ui/sshd/防火墙保护 | 14–16 | 16 |
| v0.4.27 九项资产、GitHub/ModelScope 双源与旧客户端更新识别 | 17–18 | 18 |

明确排除项由 Task 1 的范围守卫和 Task 14 的差异审计共同保护：AI 面板不自动收起；帮助不增加搜索/目录；连接向导默认保存和测试前直连不变；不增加未保存确认；不增加业务状态、服务端能力或安全事务路径。

---

## Batch 1 — Global shell, theme, top bar, and common dialogs

### Task 1: Freeze the v0.4.26 behavior boundary

**Files:**
- Create: `test/unit-ci/v0427-scope-guard.spec.js`
- Modify only if the new guard exposes a pre-existing mismatch: existing focused test files; do not modify production behavior to satisfy this task.

- [ ] **Step 1: Write the scope guard**

Create a source-contract test that slices the `actions` array in `aigshell-topbar.jsx` and asserts the exact order:

```js
const expectedTopbarActions = [
  'serverStatus', 'new', 'quick', 'quickCommands', 'sshTunnel', 'ai',
  'model', 'backup', 'connections', 'safetyCenter', 'update', 'theme',
  'setting', 'help'
]

assert.deepEqual(
  [...actionsSource.matchAll(/key: '([^']+)'/g)].map(match => match[1]),
  expectedTopbarActions
)
assert.match(wizard, /saveAsBookmark:\s*true/)
assert.match(wizard, /<Button type='primary' onClick=\{handleConnect\}>/)
assert.doesNotMatch(aiChat, /autoCollapse|autoCloseRightPanel/)
```

Also assert that the wizard still has three steps; Operations still renders the existing tab values; SFTP still delegates click, double-click, drag, context-menu and transfer actions to the same existing handlers; no new `store/`, `src/app/server/`, command-template, persistence-key or IPC file is named by this UI plan.

- [ ] **Step 2: Run the guard**

```powershell
node --test test/unit-ci/v0427-scope-guard.spec.js
```

Expected: PASS on v0.4.26. This is a preservation test, so it intentionally starts green.

- [ ] **Step 3: Record the baseline commit and tree**

```powershell
git rev-parse HEAD
git describe --tags --exact-match HEAD
git status --short
```

Expected: base contains tag `v0.4.26`; only the implementation-plan commit is present before product work; no unrelated user file is changed.

### Task 2: Add background isolation and complete common dialog/drawer focus semantics

**Files:**
- Create: `src/client/common/dialog-background-isolation.js`
- Create: `test/unit-ci/ui-accessibility-contract.spec.js`
- Modify: `src/client/components/common/modal.jsx`
- Modify: `src/client/components/common/drawer.jsx`
- Modify: `src/client/components/common/modal.styl`
- Modify: `src/client/components/common/drawer.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`

- [ ] **Step 1: Write failing dialog accessibility tests**

The test must require all of these source contracts:

```js
assert.match(modal, /createPortal/)
assert.match(modal, /useDialogBackgroundIsolation\(open\)/)
assert.match(modal, /aria-labelledby=\{titleId\}/)
assert.match(modal, /aria-label=\{e\('shellpilotCloseDialog'\)\}/)
assert.match(drawer, /role='dialog'/)
assert.match(drawer, /aria-modal='true'/)
assert.match(drawer, /useDialogBackgroundIsolation\(open\)/)
assert.match(isolation, /root\.inert = true/)
assert.match(isolation, /activeOwners\.size/)
```

Add pure state tests for nested acquisition/release: first owner stores the old `inert`/`aria-hidden` values, a second owner does not overwrite the snapshot, releasing one owner keeps isolation, releasing the final owner restores the exact old values.

- [ ] **Step 2: Verify the red state**

```powershell
node --test test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: FAIL because the isolation helper and drawer dialog semantics do not exist.

- [ ] **Step 3: Implement the isolation helper**

Use an owner set rather than a Boolean so nested dialogs cannot restore the background early:

```js
const activeOwners = new Set()
let previousState = null

export function acquireDialogBackgroundIsolation (owner, root = document.getElementById('container')) {
  if (!root || activeOwners.has(owner)) return
  if (!activeOwners.size) {
    previousState = {
      root,
      inert: root.inert,
      ariaHidden: root.getAttribute('aria-hidden')
    }
    root.inert = true
    root.setAttribute('aria-hidden', 'true')
  }
  activeOwners.add(owner)
}
```

`releaseDialogBackgroundIsolation` must restore both properties only after `activeOwners.size === 0`. Export a `useDialogBackgroundIsolation(open)` hook from the same file using a stable `useRef(Symbol('dialog-owner'))` and effect cleanup.

- [ ] **Step 4: Portal the custom modal and drawer without changing callbacks**

In both common components:

- keep current `open`, mask click, `onCancel`/`onClose`, Escape and focus restoration behavior;
- render the overlay with `createPortal(..., document.body)` so `#container` can safely become inert;
- give the heading a stable `useId()` value and bind `aria-labelledby`;
- add an accessible name to close controls;
- give Drawer the same initial-focus, Tab-loop, Escape, restore and `role='dialog' aria-modal='true'` behavior as Modal;
- preserve z-index, placement, width and mask behavior.

- [ ] **Step 5: Run focused tests and lint**

```powershell
node --test test/unit-ci/ui-accessibility-contract.spec.js test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/safety-release-matrix.spec.js
npx standard src/client/common/dialog-background-isolation.js src/client/components/common/modal.jsx src/client/components/common/drawer.jsx test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: PASS; no callback, mask or Escape regression.

### Task 3: Refine shared visual states, top-bar grouping, icon buttons, and toast placement

**Files:**
- Create: `test/unit-ci/v0427-ui-style-contract.spec.js`
- Modify: `src/client/common/ui-theme-tokens.js`
- Modify: `src/client/css/basic.styl`
- Modify: `src/client/css/includes/theme.styl`
- Modify: `src/client/css/includes/secondary-ui.styl`
- Modify: `src/client/components/common/message.styl`
- Modify: `src/client/components/common/notification.styl`
- Modify: `src/client/components/main/aigshell-topbar.jsx`
- Modify: `src/client/components/main/aigshell-topbar.styl`
- Modify: `src/client/components/tabs/window-control.jsx`

- [ ] **Step 1: Write failing style and top-bar tests**

Require:

- shared `:focus-visible` treatment for buttons, links, tab roles, listbox options and icon buttons;
- `@media (prefers-reduced-motion: reduce)` disabling transitions/animations;
- toast and notification top offset at or below the 44 px title bar plus spacing;
- the 14 top-bar entries remain in their exact Task 1 order while receiving only presentation group metadata;
- window controls are native `<button type='button'>` elements with `aria-label` and the same `minimize`, `maximize`/`unmaximize`, and `closeApp` callbacks;
- no xterm selector consumes UI font, radius, card shadow or UI focus tokens.

- [ ] **Step 2: Verify the red state**

```powershell
node --test test/unit-ci/v0427-ui-style-contract.spec.js test/unit-ci/ui-theme-tokens.spec.js
```

Expected: FAIL on missing top-bar group classes, native window-control buttons and expanded reduced-motion coverage.

- [ ] **Step 3: Add presentation-only grouping and standard button semantics**

Add `group: 'connection' | 'work' | 'manage' | 'system'` to existing action descriptors without reordering them. Render `data-action-group` and a group-boundary class only. Replace each window-control `div` with:

```jsx
<button
  type='button'
  className='window-control-box window-control-minimize'
  aria-label={e('minimize')}
  title={e('minimize')}
  onClick={minimize}
>
  <MinusOutlined aria-hidden='true' />
</button>
```

Use the same existing handlers for maximize/unmaximize and close.

- [ ] **Step 4: Refine tokens and shared styles**

Use the existing token derivation for all colors. Add soft status backgrounds and a focus offset token only if derived from existing `success`, `info`, `warning`, `danger`, `surface` and `primary`; do not hard-code page-specific colors. Apply:

- clearer hover/pressed/selected/disabled/focus separation;
- one visual separator between top-bar groups while keeping the narrow-window horizontal rail;
- full current-tab title tooltip and visible online/offline status text for assistive technology;
- toast/notification placement below the top bar;
- no duplicate card shadow on nested cards;
- reduced motion across overlays, buttons, tabs and lifted cards.

- [ ] **Step 5: Run Batch 1 verification**

```powershell
node --test test/unit-ci/v0427-scope-guard.spec.js test/unit-ci/ui-accessibility-contract.spec.js test/unit-ci/v0427-ui-style-contract.spec.js test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/aurora-ui-style-contract.spec.js test/unit-ci/secondary-ui-contract.spec.js
npm run lint
```

Expected: PASS; 14 top-bar actions and all original callbacks remain unchanged.

- [ ] **Step 6: Commit Batch 1**

```powershell
git add src/client/common/dialog-background-isolation.js src/client/common/ui-theme-tokens.js src/client/common/shellpilot-i18n-overrides.js src/client/css/basic.styl src/client/css/includes/theme.styl src/client/css/includes/secondary-ui.styl src/client/components/common/modal.jsx src/client/components/common/modal.styl src/client/components/common/drawer.jsx src/client/components/common/drawer.styl src/client/components/common/message.styl src/client/components/common/notification.styl src/client/components/main/aigshell-topbar.jsx src/client/components/main/aigshell-topbar.styl src/client/components/tabs/window-control.jsx test/unit-ci/v0427-scope-guard.spec.js test/unit-ci/ui-accessibility-contract.spec.js test/unit-ci/v0427-ui-style-contract.spec.js
git commit -m "feat: refine global UI accessibility shell"
```

---

## Batch 2 — Connection wizard, terminal, SFTP, and AI panel

### Task 4: Tighten the three-step connection wizard and bind every visible label

**Files:**
- Modify: `src/client/components/tabs/quick-connect-wizard.jsx`
- Modify: `src/client/components/tabs/quick-connect.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `test/unit-ci/quick-connect-ui.spec.js`
- Modify: `test/unit-ci/quick-connect-options.spec.js`

- [ ] **Step 1: Add failing wizard semantics/copy assertions**

Assert explicit `htmlFor`/`id` pairs for protocol, host, port, username, auth method, password/private key, profile, title, save checkbox and group picker. Assert help IDs are wired through `aria-describedby`, and copy distinguishes required, optional, recommended and local persistence.

Keep these preservation assertions:

```js
assert.match(source, /saveAsBookmark:\s*true/)
assert.match(source, /await testConnection\(options\)/)
assert.match(source, /<Button type='primary' onClick=\{handleConnect\}>/)
assert.doesNotMatch(source, /disabled=\{!testResult|disabled=\{testResult/)
```

- [ ] **Step 2: Verify the red state**

```powershell
node --test test/unit-ci/quick-connect-ui.spec.js test/unit-ci/quick-connect-options.spec.js
```

Expected: FAIL on missing label associations and persistence help.

- [ ] **Step 3: Add labels and compact layout**

Add stable IDs such as `shellpilot-connect-host`, use native `<label htmlFor>` around existing Ant controls, and retain every field and step in the current order. Reduce blank vertical space with CSS only. Keep the step count, `goNext`, `handleTest`, `handleConnect`, `openAdvancedSettings`, default values and direct-connect availability unchanged.

- [ ] **Step 4: Run focused tests**

```powershell
node --test test/unit-ci/quick-connect.spec.js test/unit-ci/quick-connect-ui.spec.js test/unit-ci/quick-connect-options.spec.js
npx standard src/client/components/tabs/quick-connect-wizard.jsx test/unit-ci/quick-connect-ui.spec.js
```

Expected: PASS.

### Task 5: Turn Terminal/SFTP switching and session icons into standard keyboard controls

**Files:**
- Modify: `src/client/components/session/session.jsx`
- Modify: `src/client/components/session/session.styl`
- Modify: `test/unit-ci/terminal-experience-matrix.spec.js`
- Modify: `test/unit-ci/terminal-shortcut-handler.spec.js`
- Modify: `test/unit-ci/ui-accessibility-contract.spec.js`

- [ ] **Step 1: Add failing tab and icon-button tests**

Require `role='tablist'`, two native tab buttons, `aria-selected`, roving `tabIndex`, `aria-controls`, visible focus style, ArrowLeft/ArrowRight/Home/End handling, and panel IDs. Require search, fullscreen, split view, path-follow, keepalive, broadcast and Delete-tip close controls to expose button semantics and names.

- [ ] **Step 2: Verify the red state**

```powershell
node --test test/unit-ci/ui-accessibility-contract.spec.js test/unit-ci/terminal-experience-matrix.spec.js test/unit-ci/terminal-shortcut-handler.spec.js
```

Expected: FAIL because the pane controls are clickable `span` elements.

- [ ] **Step 3: Reuse existing pane and icon handlers**

Implement a presentation-only keyboard adapter:

```jsx
<button
  type='button'
  role='tab'
  aria-selected={types[i] === pane}
  aria-controls={`session-pane-${types[i]}-${tab.id}`}
  tabIndex={types[i] === pane ? 0 : -1}
  onClick={() => this.onChangePane(types[i])}
  onKeyDown={event => this.handlePaneTabKeyDown(event, i, types)}
>
```

Arrow/Home/End must call the same `onChangePane`; existing application shortcuts, xterm input and click behavior remain untouched. Convert icon-only controls to native buttons or button wrappers using their existing callbacks and state (`aria-pressed` for split, follow, keepalive and broadcast).

- [ ] **Step 4: Run focused terminal tests**

```powershell
node --test test/unit-ci/terminal-async-focus.spec.js test/unit-ci/terminal-ui-theme-decoupling.spec.js test/unit-ci/terminal-experience-matrix.spec.js test/unit-ci/terminal-shortcut-handler.spec.js test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: PASS; terminal input and shortcuts remain unchanged.

### Task 6: Add SFTP grid/row semantics and improve row/header/focus hierarchy

**Files:**
- Create: `src/client/common/sftp-accessibility.js`
- Modify: `src/client/components/sftp/file-item.jsx`
- Modify: `src/client/components/sftp/list-table-ui.jsx`
- Modify: `src/client/components/sftp/file-table-header.jsx`
- Modify: `src/client/components/sftp/sftp-entry.jsx`
- Modify: `src/client/components/sftp/sftp.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `test/unit-ci/sftp-navigation-ui.spec.js`
- Modify: `test/unit-ci/sftp-file-selection.spec.js`
- Modify: `test/unit-ci/sftp-feature-matrix.spec.js`
- Modify: `test/unit-ci/ui-accessibility-contract.spec.js`

- [ ] **Step 1: Write failing pure-label and source-contract tests**

Test a directory, file, parent row, selected row and truncated name. The helper output must include side, name, type, size, modification time and selected state from existing fields only. Source contracts must require `role='grid'`, `role='row'`, `role='columnheader'`, `aria-rowcount`, `aria-rowindex`, `aria-selected`, full-name `title`, and a roving row `tabIndex`.

- [ ] **Step 2: Verify the red state**

```powershell
node --test test/unit-ci/sftp-navigation-ui.spec.js test/unit-ci/sftp-file-selection.spec.js test/unit-ci/sftp-feature-matrix.spec.js test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: FAIL on missing grid/row semantics and row labels.

- [ ] **Step 3: Implement a pure SFTP row-label helper**

The helper may format existing values but must not read the store or SFTP client:

```js
export function buildSftpRowAriaLabel ({ file, type, selected, properties, translate, formatSize, formatTime }) {
  const fields = properties.map(property => property.id)
  return [
    translate(type),
    file.name || translate('shellpilotSftpEmptyName'),
    file.isDirectory ? translate('folder') : translate('file'),
    fields.includes('size') && !file.isDirectory ? formatSize(file.size) : '',
    fields.some(id => id.toLowerCase().includes('time')) ? formatTime(file.modifyTime) : '',
    selected ? translate('selected') : translate('notSelected')
  ].filter(Boolean).join('，')
}
```

- [ ] **Step 4: Add semantics without duplicating actions**

Keep delegated container click/double-click, `FileSection.onClick`, `transferOrEnterDirectory`, context menu, drag and transfer methods. Keyboard Enter calls existing `transferOrEnterDirectory`; Space calls existing `onClick`; ArrowUp/ArrowDown call the already-present `selectPrev`/`selectNext`, then move DOM focus to the newly selected row. Pass those two existing methods through `getFileProps`; do not create a second selection model.

- [ ] **Step 5: Refine SFTP presentation**

Use CSS to distinguish header, hover, selected and focused rows; retain both panes and all columns. Keep ellipsis only where required for layout and preserve `title={file.name}`. Give disabled one-click backup an accessible reason only when the existing `selectedCount` state supplies it; otherwise leave the current disabled semantics unchanged.

- [ ] **Step 6: Run focused SFTP tests**

```powershell
node --test test/unit-ci/sftp-navigation-ui.spec.js test/unit-ci/sftp-file-selection.spec.js test/unit-ci/sftp-feature-matrix.spec.js test/unit-ci/sftp-client-order.spec.js test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: PASS; click, double-click, multi-select, drag, context menu and transfer contracts remain green.

### Task 7: Compact the AI empty state and clarify the first API configuration path

**Files:**
- Modify: `src/client/components/ai/ai-chat.jsx`
- Modify: `src/client/components/ai/ai-config.jsx`
- Modify: `src/client/components/ai/ai.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `test/unit-ci/ai-config-required.spec.js`
- Modify: `test/unit-ci/ai-model-api-config-matrix.spec.js`
- Modify: `test/unit-ci/ai-provider-guide.spec.js`
- Modify: `test/unit-ci/ai-health-ui.spec.js`

- [ ] **Step 1: Write failing AI presentation tests**

Require a compact unconfigured state with a status region and one primary API configuration action. Require the API URL, key and model fields to appear before the provider guide; mark the primary field area with a heading/description; require accessible labels for provider search, region filter, password visibility, model loading, website links and advanced options.

- [ ] **Step 2: Verify the red state**

```powershell
node --test test/unit-ci/ai-config-required.spec.js test/unit-ci/ai-model-api-config-matrix.spec.js test/unit-ci/ai-provider-guide.spec.js test/unit-ci/ai-health-ui.spec.js
```

Expected: FAIL on the new heading/status/accessible-name contracts.

- [ ] **Step 3: Implement presentation-only hierarchy**

Add a compact inner wrapper to the existing right panel; keep `rightPanelTab`, panel width, `toggleConfig`, agent takeover and all model state unchanged. In API configuration, visually number the existing three primary fields and lower provider-guide prominence. Do not reorder actual fields, provider data, save/test/load actions or advanced controls.

- [ ] **Step 4: Run Batch 2 verification and commit**

```powershell
node --test test/unit-ci/quick-connect*.spec.js test/unit-ci/terminal-*.spec.js test/unit-ci/sftp-*.spec.js test/unit-ci/ai-config-required.spec.js test/unit-ci/ai-model-api-config-matrix.spec.js test/unit-ci/ai-provider-guide.spec.js test/unit-ci/ai-health-ui.spec.js test/unit-ci/ui-accessibility-contract.spec.js
npm run lint
git add src/client/common/sftp-accessibility.js src/client/common/shellpilot-i18n-overrides.js src/client/components/tabs/quick-connect-wizard.jsx src/client/components/tabs/quick-connect.styl src/client/components/session/session.jsx src/client/components/session/session.styl src/client/components/sftp/file-item.jsx src/client/components/sftp/list-table-ui.jsx src/client/components/sftp/file-table-header.jsx src/client/components/sftp/sftp-entry.jsx src/client/components/sftp/sftp.styl src/client/components/ai/ai-chat.jsx src/client/components/ai/ai-config.jsx src/client/components/ai/ai.styl test/unit-ci/quick-connect-ui.spec.js test/unit-ci/quick-connect-options.spec.js test/unit-ci/terminal-experience-matrix.spec.js test/unit-ci/terminal-shortcut-handler.spec.js test/unit-ci/sftp-navigation-ui.spec.js test/unit-ci/sftp-file-selection.spec.js test/unit-ci/sftp-feature-matrix.spec.js test/unit-ci/ai-config-required.spec.js test/unit-ci/ai-model-api-config-matrix.spec.js test/unit-ci/ai-provider-guide.spec.js test/unit-ci/ai-health-ui.spec.js test/unit-ci/ui-accessibility-contract.spec.js
git commit -m "feat: improve connection terminal sftp and ai UX"
```

Expected: PASS and one Batch 2 commit.

---

## Batch 3 — Server status, safety center, and Operations toolkit

### Task 8: Explain server abnormal states using the existing scan result

**Files:**
- Create: `src/client/common/server-status-presentation.js`
- Modify: `src/client/components/server-status/server-status-modal.jsx`
- Modify: `src/client/components/server-status/server-status-modal.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `test/unit-ci/server-status-center.spec.js`
- Modify: `test/unit-ci/server-status-model.spec.js`

- [ ] **Step 1: Write failing pure presentation tests**

For `healthy`, `warning`, `critical` and `unknown`, assert a stable severity label, impact sentence and next-step sentence. The helper receives only the existing `overallStatus`, `alerts` and translated strings; it must not execute commands, schedule polling or mutate snapshot data.

- [ ] **Step 2: Verify the red state**

```powershell
node --test test/unit-ci/server-status-center.spec.js test/unit-ci/server-status-model.spec.js
```

Expected: FAIL because `server-status-presentation.js` does not exist.

- [ ] **Step 3: Render explanation beside the unchanged status**

Keep the existing “异常”/`statusTag`, summary values, alerts and AI diagnosis entries. Add a presentation block containing severity, impact and next step. Existing alert messages are evidence; the new copy must not claim a cause not present in the snapshot. Repeated AI diagnosis buttons remain present but use secondary visual styling.

- [ ] **Step 4: Run focused tests**

```powershell
node --test test/unit-ci/server-status-center.spec.js test/unit-ci/server-status-model.spec.js test/unit-ci/server-status-actions.spec.js test/unit-ci/server-status-probes.spec.js
```

Expected: PASS; no new probe or command appears.

### Task 9: Reduce safety-center duplication and add record-list semantics

**Files:**
- Modify: `src/client/components/main/safety-operation-center-modal.jsx`
- Modify: `src/client/components/main/safety-operation-center-modal.styl`
- Modify: `test/unit-ci/safety-operation-center.spec.js`
- Modify: `test/unit-ci/ui-accessibility-contract.spec.js`

- [ ] **Step 1: Write failing semantics and hierarchy tests**

Require one visually primary summary group, auxiliary tab counts, `role='list'` on the record container, `role='listitem'` on both safety and Operations task records, accessible filter names, readable empty/error states and an `aria-live` loading/result status.

- [ ] **Step 2: Verify the red state**

```powershell
node --test test/unit-ci/safety-operation-center.spec.js test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: FAIL on record roles and live status.

- [ ] **Step 3: Apply semantic and visual-only changes**

Keep all four summary counts and all four tab labels/counts. Use CSS to make the top summary primary and tab counts auxiliary; do not delete either set. Keep search, filters, refresh, rollback, audit, legacy data and filtering logic unchanged.

- [ ] **Step 4: Run focused safety tests**

```powershell
node --test test/unit-ci/safety-operation-center.spec.js test/unit-ci/safety-release-matrix.spec.js test/unit-ci/safety-transaction-store.spec.js test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: PASS.

### Task 10: Reflow Operations cards and panels without changing its tools or safety path

**Files:**
- Modify: `src/client/components/operations-toolkit/workspace/operations-workspace.jsx`
- Modify: `src/client/components/operations-toolkit/workspace/operations-workspace.styl`
- Modify: `src/client/components/operations-toolkit/workspace/tool-catalog.jsx`
- Modify: `src/client/components/operations-toolkit/workspace/task-panel.jsx`
- Modify: `src/client/components/operations-toolkit/workspace/result-viewer.jsx`
- Modify: `src/client/components/operations-toolkit/workspace/parameter-form.jsx`
- Modify: `test/unit-ci/operations-workspace-style.spec.js`
- Modify: `test/unit-ci/operations-workspace-connection.spec.js`
- Modify: `test/unit-ci/operations-toolkit-release-gate.spec.js`

- [ ] **Step 1: Write failing Operations presentation contracts**

Assert the current five tabs, existing recommended order, tool IDs, safety labels and command registry counts remain unchanged. Require responsive card/catalog columns, listbox/option semantics for categories/tools, selected state, named close controls, scrollable short-window layout and visible `只读`/`需编辑`/preview/confirmation/rollback text.

- [ ] **Step 2: Verify the red state**

```powershell
node --test test/unit-ci/operations-workspace-style.spec.js test/unit-ci/operations-workspace-connection.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js
```

Expected: FAIL on listbox/option and reflow contracts, while tool-count preservation remains green.

- [ ] **Step 3: Implement responsive presentation**

Use `repeat(auto-fit, minmax(...))` or the existing two-column master/detail structure so the audited six-column card density becomes two or three readable columns at normal desktop widths and one column at narrow widths. Keep tool definitions, ordering, filtering, parameters, preview, run, confirmation, recovery and rollback callbacks untouched. Allow the bottom workspace to scroll internally at short heights rather than covering terminal/SFTP controls.

- [ ] **Step 4: Run Batch 3 verification and commit**

```powershell
node --test test/unit-ci/server-status-*.spec.js test/unit-ci/safety-operation-center.spec.js test/unit-ci/safety-release-matrix.spec.js test/unit-ci/operations-*.spec.js test/unit-ci/ui-accessibility-contract.spec.js
npm run lint
git add src/client/common/server-status-presentation.js src/client/common/shellpilot-i18n-overrides.js src/client/components/server-status/server-status-modal.jsx src/client/components/server-status/server-status-modal.styl src/client/components/main/safety-operation-center-modal.jsx src/client/components/main/safety-operation-center-modal.styl src/client/components/operations-toolkit/workspace/operations-workspace.jsx src/client/components/operations-toolkit/workspace/operations-workspace.styl src/client/components/operations-toolkit/workspace/tool-catalog.jsx src/client/components/operations-toolkit/workspace/task-panel.jsx src/client/components/operations-toolkit/workspace/result-viewer.jsx src/client/components/operations-toolkit/workspace/parameter-form.jsx test/unit-ci/server-status-center.spec.js test/unit-ci/server-status-model.spec.js test/unit-ci/safety-operation-center.spec.js test/unit-ci/operations-workspace-style.spec.js test/unit-ci/operations-workspace-connection.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js test/unit-ci/ui-accessibility-contract.spec.js
git commit -m "feat: clarify status safety and operations workspaces"
```

Expected: PASS and one Batch 3 commit.

---

## Batch 4 — Help, update, settings, and copy

### Task 11: Improve Help and Update reading hierarchy without adding navigation features

**Files:**
- Modify: `src/client/components/main/help-center-modal.jsx`
- Modify: `src/client/components/main/help-center-modal.styl`
- Modify: `src/client/components/main/update-center-modal.jsx`
- Modify: `src/client/components/main/update-center-modal.styl`
- Modify: `src/client/components/common/markdown.jsx`
- Create: `src/client/components/common/markdown.styl`
- Modify: `test/unit-ci/help-center.spec.js`
- Modify: `test/unit-ci/shellpilot-help-content.spec.js`
- Modify: `test/unit-ci/update-center.spec.js`
- Modify: `test/unit-ci/update-manual-feedback.spec.js`

- [ ] **Step 1: Write failing reading-hierarchy tests**

Require Help to retain its current section order and `defaultActiveKey={['start']}` while exposing heading levels and expanded/collapsed state through the existing Ant Collapse. Explicitly assert no help search input and no anchor/TOC is added. Require Update to render release notes through `<Markdown text={info.releaseInfo.body} />`, with heading/list/paragraph styles and no raw Markdown in a plain `<pre>` or text block.

- [ ] **Step 2: Verify the red state**

```powershell
node --test test/unit-ci/help-center.spec.js test/unit-ci/shellpilot-help-content.spec.js test/unit-ci/update-center.spec.js test/unit-ci/update-manual-feedback.spec.js
```

Expected: the preservation assertions pass; the new heading/reading-style contract fails.

- [ ] **Step 3: Apply display-only structure**

Add semantic headings and compact intro/safety areas. Keep all Help chapters and their order. In Update, keep source selection, check, retry, download, hash and install behavior; only strengthen current/latest/status/source/last-checked hierarchy and Markdown typography.

- [ ] **Step 4: Run focused tests**

```powershell
node --test test/unit-ci/help-center.spec.js test/unit-ci/shellpilot-help-content.spec.js test/unit-ci/update-center.spec.js test/unit-ci/update-manual-feedback.spec.js test/unit-ci/update-sources.spec.js
```

Expected: PASS.

### Task 12: Give settings categories and numeric controls standard semantics

**Files:**
- Modify: `src/client/components/setting-panel/list.jsx`
- Modify: `src/client/components/setting-panel/list.styl`
- Modify: `src/client/components/setting-panel/number-config.jsx`
- Modify: `src/client/components/setting-panel/setting-common.jsx`
- Modify: `src/client/components/setting-panel/setting-terminal.jsx`
- Modify: `src/client/components/setting-panel/setting-modal.jsx`
- Modify: `src/client/components/setting-panel/setting-wrap.jsx`
- Modify: `src/client/components/setting-panel/setting.styl`
- Modify: `src/client/components/setting-panel/setting-wrap.styl`
- Modify: `test/unit-ci/settings-search-interaction.spec.js`
- Modify: `test/unit-ci/secondary-config-ui.spec.js`
- Modify: `test/unit-ci/ui-accessibility-contract.spec.js`

- [ ] **Step 1: Write failing settings accessibility tests**

Require the left list to be a named `listbox`, every item an `option` with `aria-selected` and roving `tabIndex`, and Enter/Space to call the existing `onClickItem`. Require delete/edit icons to be native named buttons that stop propagation and call existing handlers. Require `NumberConfig` to pass `aria-label`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` and the unit/help ID to `InputNumberConfirm`.

- [ ] **Step 2: Verify the red state**

```powershell
node --test test/unit-ci/settings-search-interaction.spec.js test/unit-ci/secondary-config-ui.spec.js test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: FAIL because category rows are generic clickable `div` elements and number inputs lack stable names.

- [ ] **Step 3: Implement listbox and spinbutton labeling**

Keep the top Tabs, left categories, fields and automatic save. Use the same `onClickItem`, `del`, `editItem`, `onChange` and default values. Pass `title` and `extraDesc` to numeric input ARIA; `sshReadyTimeout` and `keepaliveInterval` must announce their names, milliseconds unit, current values and ranges. Do not change parsing, min/max, step or saved config keys.

- [ ] **Step 4: Run focused settings tests**

```powershell
node --test test/unit-ci/settings-search-interaction.spec.js test/unit-ci/setting-search-index.spec.js test/unit-ci/theme-field-labels.spec.js test/unit-ci/secondary-config-ui.spec.js test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/update-channel-settings.spec.js test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: PASS; Ctrl/Command+K and auto-save behavior stay green.

### Task 13: Clean the confirmed bilingual copy defects and commit Batch 4

**Files:**
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `test/unit-ci/ui-localization-coverage.spec.js`
- Modify: all focused tests from Tasks 4, 7, 8, 11 and 12 that assert added copy keys.

- [ ] **Step 1: Add failing exact-copy assertions**

Cover both `zh_cn` and `en_us` for:

- connection required/optional/recommended/local-save help;
- dialog close, Terminal/SFTP controls and SFTP row state;
- AI first-three-fields guidance;
- server severity/impact/next-step text;
- settings numeric units and category names;
- a direct `disableTransferHistory` override so Chinese no longer concatenates into “关闭传输SFTP传输历史”.

Keep protocol names, AI, API, SSH, SFTP, Markdown, Keepalive, URLs and standard abbreviations where technically necessary. The UI-font preview may retain one explicitly labeled English sample because it is a font sample, not an untranslated control.

- [ ] **Step 2: Verify red, then update both catalogs together**

```powershell
node --test test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/quick-connect-ui.spec.js test/unit-ci/ui-accessibility-contract.spec.js
```

Expected before copy update: FAIL. After adding paired Chinese/English keys and exact natural copy: PASS.

- [ ] **Step 3: Run Batch 4 verification and commit**

```powershell
node --test test/unit-ci/help-center.spec.js test/unit-ci/shellpilot-help-content.spec.js test/unit-ci/update-center.spec.js test/unit-ci/update-manual-feedback.spec.js test/unit-ci/settings-search-interaction.spec.js test/unit-ci/setting-search-index.spec.js test/unit-ci/theme-field-labels.spec.js test/unit-ci/secondary-config-ui.spec.js test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/update-channel-settings.spec.js test/unit-ci/ui-accessibility-contract.spec.js
npm run lint
git add src/client/common/shellpilot-i18n-overrides.js src/client/components/main/help-center-modal.jsx src/client/components/main/help-center-modal.styl src/client/components/main/update-center-modal.jsx src/client/components/main/update-center-modal.styl src/client/components/common/markdown.jsx src/client/components/common/markdown.styl src/client/components/setting-panel/list.jsx src/client/components/setting-panel/list.styl src/client/components/setting-panel/number-config.jsx src/client/components/setting-panel/setting-common.jsx src/client/components/setting-panel/setting-terminal.jsx src/client/components/setting-panel/setting-modal.jsx src/client/components/setting-panel/setting-wrap.jsx src/client/components/setting-panel/setting.styl src/client/components/setting-panel/setting-wrap.styl test/unit-ci/help-center.spec.js test/unit-ci/shellpilot-help-content.spec.js test/unit-ci/update-center.spec.js test/unit-ci/update-manual-feedback.spec.js test/unit-ci/settings-search-interaction.spec.js test/unit-ci/secondary-config-ui.spec.js test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/ui-accessibility-contract.spec.js
git commit -m "feat: refine help update settings and copy"
```

Expected: PASS and one Batch 4 commit.

---

## Three-round self-check and requirement regression

### Task 14: Round 1 — code, component, and boundary self-check

**Files:**
- Create: `../../docs/audits/2026-08-02-v0.4.27-ui-accessibility/round-1-code-components.md`
- Modify: implementation/tests only when a real failure is found; rerun the complete affected set after each fix.

- [ ] **Step 1: Run all unit and lint gates**

```powershell
npm run test-unit-ci
npm run lint
npm run b
git diff --check
```

Expected: all commands exit 0; production Vite/Stylus build passes.

- [ ] **Step 2: Audit forbidden change categories**

```powershell
git diff --name-only v0.4.26...HEAD
git diff --stat v0.4.26...HEAD
git diff v0.4.26...HEAD -- src/client/store src/app/server src/app/common
git grep -n -I -E "autoCollapse|autoCloseRightPanel|saveAsBookmark: false" -- src test
```

Expected: no product changes under store/server/common backend paths; no forbidden AI collapse or changed save default. Review production diffs to confirm no new API, IPC, persistence key, command template, scan command, safety classification or transaction path.

- [ ] **Step 3: Re-run the scope guard after all four batches**

```powershell
node --test test/unit-ci/v0427-scope-guard.spec.js test/unit-ci/ui-accessibility-contract.spec.js test/unit-ci/v0427-ui-style-contract.spec.js
```

Expected: PASS; entry count/order, fields, buttons and callbacks remain preserved.

- [ ] **Step 4: Write Round 1 evidence**

Record exact commands, exit codes, test totals, build result, changed production directories and any defect/fix/replay cycle. Do not record secrets or server addresses.

### Task 15: Round 2 — user interaction, visual matrix, keyboard, and screen reader

**Files:**
- Create: `test/e2e/035.v0427-ui-accessibility.spec.js`
- Modify: `test/e2e/022.secondary-ui-visual-matrix.spec.js`
- Modify: `test/e2e/026.primary-workspace-regression.spec.js`
- Create: `../../docs/audits/2026-08-02-v0.4.27-ui-accessibility/round-2-interaction-visual-a11y.md`
- Create: screenshot/accessibility evidence below `../../docs/audits/2026-08-02-v0.4.27-ui-accessibility/evidence/`

- [ ] **Step 1: Write the failing accessibility E2E journey**

The new E2E must exercise these existing journeys: disconnected home; all three connection steps; connection-test feedback; connected Terminal; SFTP; server status; safety center; update; Help; Operations; Model API; settings. It must assert:

```js
await expect(page.locator('[role="dialog"]')).toBeVisible()
await expect(page.locator('#container')).toHaveAttribute('aria-hidden', 'true')
expect(await page.locator('#container').evaluate(node => node.inert)).toBe(true)
await page.keyboard.press('Tab')
await page.keyboard.press('Shift+Tab')
await page.keyboard.press('Escape')
await expect(trigger).toBeFocused()
```

It must also exercise Terminal/SFTP Arrow keys, SFTP row Enter/Space/Arrow navigation and settings category Enter/Space without changing any data outside the isolated test profile and local fixture.

- [ ] **Step 2: Verify red before product fixes, then green after Batch 4**

```powershell
npx playwright test test/e2e/035.v0427-ui-accessibility.spec.js --workers=1
```

Expected before semantics work: FAIL. Expected now: PASS.

- [ ] **Step 3: Run the visual and core-flow suites**

```powershell
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/026.primary-workspace-regression.spec.js test/e2e/027.quality-core-flows.spec.js test/e2e/032.operations-toolkit.spec.js test/e2e/035.v0427-ui-accessibility.spec.js --workers=1
```

Expected: PASS at light/dark, 1366/1920 widths and 100%/125%/150% zoom; no horizontal page overflow, clipped primary action, hidden close button or inaccessible scroll region.

- [ ] **Step 4: Review screenshots before updating intentional snapshots**

Open every actual/diff image produced by Playwright. Reject any accidental entry reorder, missing field, obscured action, unreadable disabled state or extra nested shadow. Only after manual review, update snapshots for intentional v0.4.27 presentation changes:

```powershell
npx playwright test test/e2e/026.primary-workspace-regression.spec.js --workers=1 --update-snapshots
npx playwright test test/e2e/026.primary-workspace-regression.spec.js --workers=1
```

Expected: second run PASS with reviewed snapshots.

- [ ] **Step 5: Perform Windows Narrator verification**

With the packaged/dev client focused, enable Narrator and check one complete path: top bar → connection wizard → Terminal/SFTP tabs → one local and one remote SFTP row → server status dialog → settings listbox and two numeric controls. Record spoken accessible names, selected state, dialog boundaries and focus restoration. A missing/duplicated name, background focus escape or keyboard trap is a defect; fix and replay the complete affected journey.

- [ ] **Step 6: Write Round 2 evidence**

Record all 14 states, theme/viewport/zoom matrix, keyboard results, Narrator results, screenshot paths and every defect/fix/replay cycle.

### Task 16: Round 3 — authorized VPS, 166 requirements, quality, performance, tunnels, and protected services

**Files:**
- Modify: `test/e2e/034.real-server-external-acceptance.spec.js` only to add read-only protected-service before/after comparison and cleanup assertions.
- Create: `../../docs/audits/2026-08-02-v0.4.27-ui-accessibility/requirements-matrix.md`
- Create: `../../docs/audits/2026-08-02-v0.4.27-ui-accessibility/round-3-requirements-external-release.md`

- [ ] **Step 1: Add a read-only server protection assertion**

Use the existing `@electerm/ssh2` connection in `034.real-server-external-acceptance.spec.js` to capture before/after output from read-only inspection commands only. Compare x-ui and SSH daemon process start markers plus available firewall service state. Do not call `systemctl start/stop/restart/reload/enable/disable`, firewall mutation commands, container mutation commands or write outside the test sandbox.

The test must retain the existing `/tmp` restriction and assert no matching `.shellpilot-*` sandbox remains after cleanup.

- [ ] **Step 2: Load the supplied credentials without printing them**

The supplied file has three non-empty lines. In the current PowerShell process, extract the IPv4 from line 1, the final whitespace-delimited username from line 2 and the remaining secret value from line 3. Never echo these variables:

```powershell
$secretLines = Get-Content -LiteralPath 'F:\SSH工具开发\VPS服务器信息.txt'
$env:SHELLPILOT_E2E_HOST = [regex]::Match($secretLines[0], '(?:\d{1,3}\.){3}\d{1,3}').Value
$env:SHELLPILOT_E2E_PORT = '22'
$env:SHELLPILOT_E2E_USERNAME = ($secretLines[1] -split '\s+')[-1]
$env:SHELLPILOT_E2E_PASSWORD = ($secretLines[2] -split '\s+', 2)[-1]
$env:SHELLPILOT_E2E_REMOTE_ROOT = '/tmp'
```

Before executing, assert only Boolean presence and port validity in memory; do not print values.

- [ ] **Step 3: Run external and tunnel acceptance**

```powershell
npm run test-real-server-e2e
npm run test-agent-readonly-real-server
npm run test-real-server-external-acceptance
npm run test-ssh-tunnel
```

Expected: SSH/SFTP journeys, remote forwarding/SOCKS5/refusal paths and cleanup pass. Every remote write stays in a random `/tmp/.shellpilot-*` sandbox. Before/after protected-service state is identical.

- [ ] **Step 4: Clear credential environment variables immediately**

```powershell
Remove-Item Env:SHELLPILOT_E2E_HOST,Env:SHELLPILOT_E2E_PORT,Env:SHELLPILOT_E2E_USERNAME,Env:SHELLPILOT_E2E_PASSWORD,Env:SHELLPILOT_E2E_REMOTE_ROOT -ErrorAction SilentlyContinue
```

- [ ] **Step 5: Run quality and performance gates**

```powershell
npm run test-quality-e2e
npm run test-performance-e2e
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

Expected: PASS; no high/critical advisory. Record any lower-severity advisory honestly.

- [ ] **Step 6: Reconcile all 166 requirements**

Copy the row structure from `F:\SSH工具开发\.worktrees\release-0.4.24\docs\audits\2026-08-01-v0.4.24-three-round\requirements-matrix.md`, update evidence to v0.4.27, and recount by status. Expected latest classification before any new evidence changes:

- 163 satisfied;
- 2 partially satisfied: `TUN-06` needs a dedicated SSH endpoint whose policy forbids forwarding, and `REL-13` needs an independent official website deployment;
- 1 replaced: `TERM-06`, superseded by the approved direct manual terminal input contract;
- 0 unmet;
- 0 unverified.

The former six external items must be explicitly explained: `SFTP-01`, `SFTP-02`, `SFTP-13` and `TUN-01` are now satisfied by v0.4.26/v0.4.27 real-server evidence; `TUN-06` and `REL-13` remain partial because this goal forbids changing shared sshd/Web services. Do not claim 166/166 complete.

- [ ] **Step 7: Commit self-check tests and evidence**

```powershell
git add test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/026.primary-workspace-regression.spec.js test/e2e/026.primary-workspace-regression.spec.js-snapshots test/e2e/034.real-server-external-acceptance.spec.js test/e2e/035.v0427-ui-accessibility.spec.js ../../docs/audits/2026-08-02-v0.4.27-ui-accessibility
git commit -m "test: complete v0.4.27 three-round acceptance"
```

Expected: evidence contains no host, username, password, token or copied server-information content.

---

## Build, version, publish, and post-release verification

### Task 17: Prepare v0.4.27 and build the exact nine Windows assets

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `docs/releases/v0.4.27.md`
- Modify: `test/unit-ci/release-notes.spec.js` only if the existing test needs the new version fixture.
- Generated, not committed: `dist/*`, root `electron-builder.json`, `work/*`.

- [ ] **Step 1: Bump the patch version without creating a tag**

```powershell
npm version 0.4.27 --no-git-tag-version
```

Expected: only `package.json` and both package-lock version fields change to `0.4.27`.

- [ ] **Step 2: Write release notes**

`docs/releases/v0.4.27.md` must have `[新增]`, `[修复]` and `[改动]` headings and accurately describe accessibility semantics, layout/copy refinements, three-round verification and unchanged functional/safety boundaries. It must state that `TUN-06` and `REL-13` remain external-environment partials.

- [ ] **Step 3: Verify version and notes**

```powershell
node --test test/unit-ci/release-notes.spec.js test/unit-ci/update-version.spec.js test/unit-ci/update-sources.spec.js test/unit-ci/release-version-baseline.spec.js test/unit-ci/release-version-consistency.spec.js
```

Expected: PASS; current version is `0.4.27` and baseline `origin/master`/`master` is an ancestor.

- [ ] **Step 4: Re-run final code gates after the version bump**

```powershell
npm run test-unit-ci
npm run lint
npm run b
```

Expected: PASS.

- [ ] **Step 5: Build installer and portable ZIP**

```powershell
npm run pb
npx electron-builder --win nsis --x64 --publish never
node build/bin/prepare-electron-build.js
node build/bin/prepare-win-portable-ci.js
npx electron-builder --win zip --x64 --publish never
npm run release:approval
npm run release:prepare-assets
```

Expected: `dist/` contains the installer, blockmap and portable ZIP plus generated update metadata.

- [ ] **Step 6: Verify the exact nine-asset local set**

The required names are:

1. `ShellPilot-0.4.27-win-x64-installer.exe`
2. `ShellPilot-0.4.27-win-x64-installer.exe.blockmap`
3. `ShellPilot-0.4.27-win-x64-portable.zip`
4. `latest.yml`
5. `shellpilot-local.yml`
6. `aigshell-update.json`
7. `shellpilot-update.json`
8. `checksums.json`
9. `shellpilot-release.json`

Run strict full-set verification:

```powershell
$env:AIGSHELL_RELEASE_UPDATE_ONLY = '0'
npm run release:local:verify
Remove-Item Env:AIGSHELL_RELEASE_UPDATE_ONLY
npm run test-package-smoke
npm run verify-win-portable -- dist/ShellPilot-0.4.27-win-x64-portable.zip
Get-AuthenticodeSignature -LiteralPath 'dist\ShellPilot-0.4.27-win-x64-installer.exe' | Select-Object Status,StatusMessage,SignerCertificate
```

Expected: nine files are present, non-empty, version-consistent and checksum-listed; package and portable smoke pass. Record Authenticode status exactly and do not report a valid public signature unless status is `Valid`.

- [ ] **Step 7: Commit release metadata**

```powershell
git add package.json package-lock.json docs/releases/v0.4.27.md test/unit-ci/release-notes.spec.js
git commit -m "chore: prepare ShellPilot v0.4.27"
git status --short
```

Expected: tracked tree clean; generated build files remain ignored.

### Task 18: Merge, publish GitHub/ModelScope, and verify the v0.4.26 → v0.4.27 update chain

**Files:**
- Create: `../../docs/audits/2026-08-02-v0.4.27-ui-accessibility/final-report.md` with final URLs, timestamps, hashes and verification results.

- [ ] **Step 1: Synchronize with the latest remote and rerun affected gates if needed**

```powershell
git fetch origin
git merge-base --is-ancestor origin/master HEAD
git status --short
```

Expected: exit 0 and clean tree. If `origin/master` advanced, merge it non-destructively into `codex/ui-accessibility-0.4.27`, resolve only actual overlaps, then rerun Tasks 14–17 affected gates before proceeding.

- [ ] **Step 2: Push the branch and merge through a reviewed PR**

```powershell
git push -u origin codex/ui-accessibility-0.4.27
gh pr create --base master --head codex/ui-accessibility-0.4.27 --title "ShellPilot v0.4.27 UI accessibility optimization" --body-file docs/releases/v0.4.27.md
gh pr checks --watch
gh pr merge --merge --delete-branch=false
git fetch origin
git merge-base --is-ancestor HEAD origin/master
git merge --ff-only origin/master
```

Expected: PR checks pass, merge succeeds, and the release commit is contained in `origin/master`.

- [ ] **Step 3: Dry-run and publish the GitHub release**

```powershell
npm run release:github:dry
npm run release:github
npm run release:github:verify
```

Expected: a new non-draft, non-prerelease `v0.4.27` release contains exactly the approved nine assets. Existing v0.4.26 and earlier releases remain unchanged.

- [ ] **Step 4: Publish identical bytes to ModelScope**

Use the Hub uploader first:

```powershell
npm run release:modelscope:hub
```

If and only if the Hub uploader fails before successful completion, use the existing Node git-sync fallback with the same local `dist/` bytes:

```powershell
npm run release:modelscope
```

Do not rebuild any asset after one source has accepted it.

- [ ] **Step 5: Verify both online sources by metadata, size, SHA256 and downloaded bytes**

```powershell
npm run release:update-sources:verify
```

Expected: strict-all/verify-bytes returns version `0.4.27`; all nine names, sizes and SHA256 values match local approved assets and each other.

- [ ] **Step 6: Verify an actual published v0.4.26 client recognizes v0.4.27**

Download the unchanged published v0.4.26 portable asset to a temporary directory, expand it, start it with an isolated user-data directory, open Update Center and check both update sources. It must show current `v0.4.26`, latest `v0.4.27`, the structured changelog and available update action. Do not install over the development machine's active ShellPilot profile.

- [ ] **Step 7: Finalize and commit the release report**

The final report must include:

- four implementation commit IDs and the acceptance/release commit IDs;
- three-round command results and test totals;
- 14-interface visual/a11y evidence paths;
- protected-service before/after equality without revealing endpoint details;
- 166-item classification `163 satisfied / 2 partial / 1 replaced / 0 unmet / 0 unverified` unless evidence justifies a stricter result;
- GitHub and ModelScope URLs, release time and nine-asset manifest;
- installer and portable SHA256 values;
- v0.4.26 client update-recognition result;
- remaining `TUN-06` and `REL-13` environment boundaries.

```powershell
git add ../../docs/audits/2026-08-02-v0.4.27-ui-accessibility/final-report.md
git commit -m "docs: record v0.4.27 release verification"
git push origin HEAD:master
```

Expected: report commit is on `master`; no product asset is rebuilt or republished. If the report-only commit occurs after the release tag, state that fact in the report rather than moving/recreating the tag.

- [ ] **Step 8: Final completion gate**

Run:

```powershell
git status --short
gh release view v0.4.27 --json isDraft,isPrerelease,publishedAt,url,assets
npm run release:update-sources:verify
```

Expected: clean tree; GitHub release is public/stable with nine assets; both sources still pass byte verification; no protected VPS service changed; no required work remains.

---

## Plan self-review checklist

- Every approved design section maps to at least one task and test.
- Every implementation batch starts with a failing test, ends with focused verification, and has one explicit commit.
- The scope guard preserves 14 top-bar entries, three wizard steps, current fields/defaults, Terminal/SFTP behavior, all Operations tools and safety paths.
- Accessibility work reuses existing handlers and state; no duplicate business action is introduced.
- The complete latest 166-item matrix is rechecked, and the two unavoidable external partials remain honestly classified.
- VPS use is limited to read-only checks and random `/tmp/.shellpilot-*` sandboxes; credential values never enter logs or tracked files.
- Release creates a new v0.4.27 and never overwrites v0.4.26 or earlier assets.
- GitHub and ModelScope must contain identical approved bytes before completion is claimed.
