# SSH + SFTP Core UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 SSH/SFTP 协议、安全门槛和现有功能入口的前提下，修正传输终态、精简上下文菜单、让安全删除立即反馈，并提升主机指纹确认和键盘体验。

**Architecture:** 保留 `fileTransfers`、`transferHistory` 和安全事务运行器作为唯一事实来源，在纯展示模型中派生完成、部分完成和失败摘要。SFTP 菜单只重组现有动作；安全删除通过可更新的现有 Modal 先展示准备态，再并行准备恢复快照；SSH 指纹提示增加兼容的结构化字段并由独立展示组件渲染。

**Tech Stack:** Electron 41、React 19、Ant Design 6、Stylus、Node.js test runner、Playwright Electron E2E、StandardJS。

---

## 文件结构

### 新建

- `src/client/components/sftp/sftp-delete-dialog.jsx`：安全删除准备、就绪、失败和重试对话框控制器。
- `src/client/components/sftp/sftp-delete-dialog-model.js`：删除目标摘要和对话框状态的纯函数。
- `src/client/components/terminal/ssh-host-key-confirmation.jsx`：结构化 SSH 主机指纹信息和复制动作。
- `src/client/components/terminal/ssh-host-key-confirmation.styl`：主机指纹信息布局。
- `test/unit-ci/sftp-delete-dialog.spec.js`：删除对话框模型与界面契约。
- `test/unit-ci/ssh-host-key-confirmation.spec.js`：结构化提示和复制/焦点契约。

### 修改

- `src/client/components/sftp/sftp-transfer-progress-model.js`：聚合终态结果、保留策略和手动关闭。
- `src/client/components/sftp/sftp-transfer-progress-dock.jsx`：准确文案、部分完成、详情和可访问播报。
- `src/client/components/sftp/sftp.styl`：部分完成、警示菜单和对话框状态样式。
- `src/client/components/sftp/sftp-file-context-menu.js`：一级动作与两个子菜单。
- `src/client/components/sftp/context-menu-utils.js`：分隔线、子菜单和紧凑分组工具。
- `src/client/components/sftp/file-item.jsx`：通用菜单项映射及键盘打开入口。
- `src/client/components/sftp/list-table-ui.jsx`：菜单关闭后恢复文件焦点。
- `src/client/components/sftp/sftp-entry.jsx`：快速删除摘要和安全删除阶段式流程。
- `src/client/components/common/modal.jsx`：禁用确认按钮和指定初始焦点。
- `src/app/server/ssh-known-hosts.js`：兼容的 `hostKeyDetails` 数据。
- `src/client/components/terminal/terminal-interactive-ui.jsx`：结构化指纹确认和安全页脚。
- `src/client/common/shellpilot-i18n-overrides.js`：新增中英文界面文案。
- `test/unit-ci/sftp-transfer-progress-dock.spec.js`：终态模型和进度坞契约。
- `test/unit-ci/sftp-context-menu.spec.js`：菜单结构与键盘契约。
- `test/unit-ci/sftp-file-context-i18n.spec.js`：中英文菜单分组。
- `test/unit-ci/sftp-safety-transaction.spec.js`：删除安全门槛和阶段式准备契约。
- `test/unit-ci/session-ssh-known-hosts.spec.js`：结构化主机指纹数据。
- `test/unit-ci/ui-accessibility-contract.spec.js`：Modal 初始焦点和禁用确认。
- `test/e2e/027.quality-core-flows.spec.js`：SSH/SFTP 完整交互回归。

## Task 1：传输终态模型

**Files:**
- Modify: `test/unit-ci/sftp-transfer-progress-dock.spec.js`
- Modify: `src/client/components/sftp/sftp-transfer-progress-model.js`

- [ ] **Step 1: 写入部分完成和失败保留的失败测试**

在 `test/unit-ci/sftp-transfer-progress-dock.spec.js` 增加：

```js
test('SFTP progress publishes skipped work as a persistent partial outcome', async () => {
  const { createSftpProgressPublishGate } = await importModel()
  const published = []
  const scheduled = []
  const gate = createSftpProgressPublishGate({
    setTimer: (callback, delay) => {
      scheduled.push({ callback, delay })
      return scheduled.at(-1)
    },
    clearTimer: () => {},
    onPublish: summary => published.push(summary)
  })

  gate.update({
    count: 2,
    status: 'running',
    statusKey: 'ok:running:|busy:running:',
    transferred: 8,
    total: 12,
    determinate: true,
    percent: 66,
    items: [{ id: 'ok' }, { id: 'busy' }]
  })
  gate.update({
    count: 0,
    status: '',
    statusKey: '',
    transferred: 0,
    total: 0,
    determinate: false,
    percent: null,
    items: [],
    terminalRecordById: {
      ok: { status: 'success', error: '' },
      busy: { status: 'skipped', error: 'EBUSY' }
    }
  })

  assert.equal(published.at(-1).status, 'partial')
  assert.deepEqual(published.at(-1).outcomeCounts, {
    successful: 1,
    skipped: 1,
    failed: 0
  })
  assert.equal(published.at(-1).determinate, false)
  assert.equal(published.at(-1).percent, null)
  assert.equal(scheduled.length, 0)
})

test('SFTP progress dismisses a persistent terminal outcome explicitly', async () => {
  const { createSftpProgressPublishGate } = await importModel()
  const published = []
  const gate = createSftpProgressPublishGate({
    onPublish: summary => published.push(summary)
  })

  gate.update({ count: 1, status: 'failed', statusKey: 'a:failed:', transferred: 1, items: [{ id: 'a' }] })
  gate.dismiss()

  assert.equal(published.at(-1).count, 0)
  assert.equal(published.at(-1).status, '')
})
```

同时把已有“verified successful terminal state”的清理延迟期望从 `2000` 改为 `8000`；把已有“root-skipped transfer”用例改为断言 `status === 'partial'`、`determinate === false`、`percent === null` 且不创建自动清理计时器。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: FAIL，`terminalRecordById`、`partial`、`outcomeCounts` 或 `dismiss` 尚不存在。

- [ ] **Step 3: 用结构化历史记录替换仅状态映射**

在 `sftp-transfer-progress-model.js` 中实现：

```js
function buildTerminalRecordById (history, tabId) {
  const result = {}
  const items = Array.isArray(history) ? history.slice(0, 100) : []
  for (const item of items) {
    if (String(item?.tabId || '') !== String(tabId || '')) continue
    const record = {
      status: String(item.error ? 'failed' : (item.status || '')),
      error: String(item.error || '')
    }
    if (item.id) result[item.id] = record
    if (item.originalId) result[item.originalId] = record
  }
  return result
}
```

`buildSftpTransferProgress()` 返回 `terminalRecordById`，并为旧调用保留从该记录派生的 `terminalStatusById`。

- [ ] **Step 4: 实现终态派生和关闭**

增加并使用：

```js
function terminalOutcome (previous, recordById) {
  const records = previous.items.map(item => (
    recordById[item.id] || { status: '', error: '' }
  ))
  if (records.some(record => !record.status)) return null
  const outcomeCounts = {
    successful: records.filter(record => ['success', 'completed'].includes(record.status)).length,
    skipped: records.filter(record => record.status === 'skipped').length,
    failed: records.filter(record => ['failed', 'exception'].includes(record.status)).length
  }
  const status = outcomeCounts.failed > 0
    ? 'failed'
    : outcomeCounts.skipped > 0
      ? 'partial'
      : 'completed'
  return {
    ...previous,
    status,
    outcomeCounts,
    items: previous.items.map(item => ({
      ...item,
      status: recordById[item.id]?.status || item.status,
      error: recordById[item.id]?.error || item.error
    })),
    speedBytesPerSecond: 0,
    determinate: status === 'completed' && previous.determinate,
    percent: status === 'completed' && previous.determinate ? 100 : null,
    transferred: status === 'completed' && previous.determinate
      ? previous.total
      : previous.transferred
  }
}
```

`createSftpProgressPublishGate()` 对 `completed` 设置 8000 ms 清理计时器，对 `partial` 和 `failed` 不自动清理，并公开：

终态派生调用需兼容手工构造的旧摘要：

```js
const recordById = summary.terminalRecordById || Object.fromEntries(
  Object.entries(summary.terminalStatusById || {}).map(([id, status]) => [
    id,
    { status, error: '' }
  ])
)
const outcome = terminalOutcome(previous, recordById)
```

并公开：

```js
dismiss () {
  cancelPending()
  const empty = {
    items: [], count: 0, transferred: 0, total: 0,
    determinate: false, percent: null, speedBytesPerSecond: 0,
    status: '', statusKey: '', current: null,
    terminalRecordById: {}, terminalStatusById: {}
  }
  latest = empty
  previous = empty
  onPublish(empty)
}
```

- [ ] **Step 5: 运行测试并确认通过**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: PASS，已有成功、取消、历史边界测试也继续通过。

- [ ] **Step 6: 提交模型改动**

```powershell
git add src/client/components/sftp/sftp-transfer-progress-model.js test/unit-ci/sftp-transfer-progress-dock.spec.js
git commit -m "fix(sftp): distinguish partial transfer outcomes"
```

## Task 2：进度坞结果表达和可访问性

**Files:**
- Modify: `test/unit-ci/sftp-transfer-progress-dock.spec.js`
- Modify: `src/client/components/sftp/sftp-transfer-progress-dock.jsx`
- Modify: `src/client/components/sftp/sftp.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`

- [ ] **Step 1: 写入进度坞界面契约失败测试**

增加以下源码契约：

```js
test('SFTP transfer dock renders terminal outcomes without unknown totals', () => {
  const dock = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transfer-progress-dock.jsx'
  ), 'utf8')
  const styles = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp.styl'
  ), 'utf8')

  assert.match(dock, /published\.status === 'partial'/)
  assert.match(dock, /published\.outcomeCounts/)
  assert.match(dock, /aria-live='polite'/)
  assert.match(dock, /gateRef\.current\.dismiss\(\)/)
  assert.match(dock, /shellpilotSftpTransferViewDetails/)
  assert.match(styles, /\.sftp-transfer-progress-dock-partial/)
  assert.match(styles, /var\(--warning\)/)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: FAIL，部分完成样式、终态结果和关闭动作尚未渲染。

- [ ] **Step 3: 实现阶段感知的摘要格式**

在 `sftp-transfer-progress-dock.jsx` 中替换百分比和详情格式逻辑：

```js
function formatProgressPercent (summary) {
  if (['completed', 'partial', 'failed'].includes(summary.status)) return ''
  return summary.determinate
    ? `${summary.percent}%`
    : e('shellpilotSftpTransferUnknownTotal')
}

function formatProgressDetail (summary) {
  if (['completed', 'partial', 'failed'].includes(summary.status)) return ''
  if (!summary.determinate) {
    return summary.transferred > 0 ? filesize(summary.transferred) : ''
  }
  return `${filesize(summary.transferred)} / ${filesize(summary.total)}`
}

function formatOutcome (summary) {
  const counts = summary.outcomeCounts || {}
  return formatShellPilotTranslation(e, summary.status === 'partial'
    ? 'shellpilotSftpTransferPartialSummary'
    : summary.status === 'failed'
      ? 'shellpilotSftpTransferFailedSummary'
      : 'shellpilotSftpTransferCompletedSummary', {
    successful: counts.successful || 0,
    skipped: counts.skipped || 0,
    failed: counts.failed || 0
  })
}
```

- [ ] **Step 4: 实现终态详情、播报和关闭**

终态摘要增加：

```jsx
<span className='sftp-transfer-dock-outcome' role='status' aria-live='polite' aria-atomic='true'>
  {formatOutcome(published)}
</span>
```

终态按钮使用 `shellpilotSftpTransferViewDetails`，并增加：

```jsx
<button
  type='button'
  className='sftp-transfer-dock-dismiss'
  aria-label={e('shellpilotSftpTransferDismiss')}
  onClick={() => gateRef.current.dismiss()}
>
  ×
</button>
```

失败或跳过详情使用传输记录中的 `status` 和 `error`；未知总量不得渲染 `/ 0 B`。

- [ ] **Step 5: 添加中英文文案和状态样式**

在两种语言映射中加入：

```js
shellpilotSftpTransferPartialSummary: '传输结束：成功 {successful} 项，跳过 {skipped} 项',
shellpilotSftpTransferCompletedSummary: '传输完成：成功 {successful} 项',
shellpilotSftpTransferFailedSummary: '传输失败：失败 {failed} 项',
shellpilotSftpTransferViewDetails: '查看详情',
shellpilotSftpTransferDismiss: '关闭传输结果',
shellpilotSftpTransferSkippedLocked: '已跳过：文件正在被其他程序占用。关闭占用后可重新上传。'
```

英文对应使用 `Transfer finished`、`Completed`、`Transfer failed`、`View details`、`Dismiss transfer result` 和 `Skipped: the file is in use by another program. Close it and upload again.`。

在 `sftp.styl` 增加橙色 `.sftp-transfer-progress-dock-partial`、结果文本和 32×32 可聚焦关闭按钮；完成、部分完成和失败状态的进度轨不再继续显示运行百分比。

- [ ] **Step 6: 运行定向测试和 StandardJS**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
.\node_modules\.bin\standard.cmd src/client/components/sftp/sftp-transfer-progress-model.js src/client/components/sftp/sftp-transfer-progress-dock.jsx
```

Expected: 全部 PASS，StandardJS 无输出。

- [ ] **Step 7: 提交进度坞改动**

```powershell
git add src/client/components/sftp/sftp-transfer-progress-dock.jsx src/client/components/sftp/sftp.styl src/client/common/shellpilot-i18n-overrides.js test/unit-ci/sftp-transfer-progress-dock.spec.js
git commit -m "feat(sftp): clarify transfer progress outcomes"
```

## Task 3：紧凑菜单与键盘上下文入口

**Files:**
- Modify: `test/unit-ci/sftp-context-menu.spec.js`
- Modify: `test/unit-ci/sftp-file-context-i18n.spec.js`
- Modify: `src/client/components/sftp/context-menu-utils.js`
- Modify: `src/client/components/sftp/sftp-file-context-menu.js`
- Modify: `src/client/components/sftp/file-item.jsx`
- Modify: `src/client/components/sftp/list-table-ui.jsx`
- Modify: `src/client/components/common/context-menu.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`

- [ ] **Step 1: 写入菜单层级和键盘契约失败测试**

在 `sftp-context-menu.spec.js` 增加：

```js
test('remote SFTP menu keeps both delete actions direct and groups secondary actions', async () => {
  const { buildSftpFileContextItems } = await import(pathToFileURL(
    path.resolve(__dirname, '../../src/client/components/sftp/sftp-file-context-menu.js')
  ).href)
  const items = buildSftpFileContextItems({
    file: { id: 'remote', type: 'remote', path: '/', name: 'logs', isDirectory: true },
    selectedFiles: new Set(['remote']),
    tab: { host: 'server.example', enableSsh: true },
    hasRecovery: true,
    translate: key => key
  })

  assert.ok(items.find(item => item.func === 'del'))
  assert.ok(items.find(item => item.func === 'quickDelete'))
  assert.deepEqual(
    items.find(item => item.func === 'backupRecoveryMenu').children.map(item => item.func),
    ['quickBackup', 'restoreLatestBackup', 'openSafetyCenter']
  )
  assert.ok(items.find(item => item.func === 'moreActionsMenu').children.length > 0)
})

test('SFTP file rows expose a keyboard context-menu path', () => {
  assert.match(fileItemSource, /event\.shiftKey && event\.key === 'F10'/)
  assert.match(fileItemSource, /event\.key === 'ContextMenu'/)
  assert.match(fileItemSource, /new MouseEvent\('contextmenu'/)
})
```

- [ ] **Step 2: 运行菜单测试并确认失败**

Run:

```powershell
node --test test/unit-ci/sftp-context-menu.spec.js test/unit-ci/sftp-file-context-i18n.spec.js
```

Expected: FAIL，分组菜单和键盘入口尚不存在。

- [ ] **Step 3: 实现菜单分组纯函数**

在 `context-menu-utils.js` 增加：

```js
function compactMenuItems (items) {
  return items.filter((item, index) => {
    if (!item) return false
    if (item.type !== 'divider') return true
    return index > 0 && items[index - 1]?.type !== 'divider'
  }).filter((item, index, list) => (
    item.type !== 'divider' || index < list.length - 1
  ))
}

export function groupSftpContextItems ({ items, isRemote, isRealFile, translate }) {
  const take = func => items.find(item => item.func === func)
  const directFunctions = [
    'doEnterDirectory', 'doTransferSelected', 'gotoFolderInTerminal',
    'doTransfer', 'transferOrEnterDirectory', 'showInDefaultFileManager',
    'downloadFromBrowser', 'askAiAboutFile', 'editFile'
  ]
  const reserved = new Set([
    ...directFunctions, 'del', 'quickDelete', 'doRename', 'onCopyPath',
    'quickBackup', 'restoreLatestBackup', 'openSafetyCenter'
  ])
  const backup = ['quickBackup', 'restoreLatestBackup', 'openSafetyCenter']
    .map(take).filter(Boolean)
  const more = items.filter(item => !reserved.has(item.func))
  return compactMenuItems([
    ...directFunctions.map(take).filter(Boolean),
    isRealFile ? { type: 'divider' } : null,
    take('del'),
    isRemote ? take('quickDelete') : null,
    isRealFile ? { type: 'divider' } : null,
    take('doRename'),
    take('onCopyPath'),
    backup.length ? {
      func: 'backupRecoveryMenu',
      icon: 'SaveOutlined',
      text: translate('shellpilotSftpBackupRecoveryMenu'),
      children: backup
    } : null,
    more.length ? {
      func: 'moreActionsMenu',
      icon: 'AppstoreOutlined',
      text: translate('shellpilotSftpMoreActionsMenu'),
      children: more
    } : null
  ])
}
```

在 `buildSftpFileContextItems()` 末尾调用该函数；远程安全删除设置 `tone: 'warning'`，远程快速删除和本地永久删除设置 `tone: 'danger'`。

- [ ] **Step 4: 让文件项支持分隔线、子菜单和警示色**

用以下逻辑扩展 `itemToMenuFormat`：

```jsx
itemToMenuFormat = (item) => {
  if (item.type === 'divider') return { type: 'divider' }
  const IconCom = iconsMap[item.icon]
  const result = {
    key: item.func,
    label: item.text,
    disabled: item.disabled,
    icon: IconCom ? <IconCom /> : null,
    extra: item.subText,
    danger: item.tone === 'danger',
    className: item.tone === 'warning' ? 'sftp-menu-item-warning' : undefined
  }
  if (item.children?.length) {
    result.popupClassName = 'shellpilot-context-menu'
    result.children = item.children.map(this.itemToMenuFormat)
  }
  return result
}
```

`renderContextMenu()` 先映射分组结果，再调用现有 `splitOverflowMenu()`；不再专门判断单一 `more-submenu`。

- [ ] **Step 5: 增加键盘打开和焦点恢复**

在 `handleRowKeyDown` 最前面增加：

```js
const openContextMenu = (
  (event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu'
)
if (openContextMenu) {
  event.preventDefault()
  this.contextMenuOpenedByKeyboard = true
  const rect = this.domRef.current?.getBoundingClientRect()
  this.domRef.current?.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: rect ? rect.left + 24 : 0,
    clientY: rect ? rect.bottom : 0
  }))
  return
}
```

在 `list-table-ui.jsx` 的 `handleDropdownOpenChange(false)` 中保留关闭前的文件实例；若 `contextMenuOpenedByKeyboard` 为真，则清除标志并通过 `requestAnimationFrame()` 恢复该行焦点。

- [ ] **Step 6: 添加菜单文案和警示样式**

增加中英文：

```js
shellpilotSftpBackupRecoveryMenu: '备份与恢复',
shellpilotSftpMoreActionsMenu: '更多操作'
```

英文为 `Backup & Recovery` 和 `More Actions`。在 `context-menu.styl` 为 `.sftp-menu-item-warning` 使用 `var(--warning)`，危险项继续使用 `var(--sp-danger)`。

- [ ] **Step 7: 更新双语动作断言并运行测试**

`sftp-file-context-i18n.spec.js` 使用递归函数展开菜单：

```js
function flattenActions (items) {
  return items.flatMap(item => item?.children?.length
    ? flattenActions(item.children)
    : item?.func ? [item.func] : [])
}
```

断言两个删除动作仍位于一级、所有旧动作都存在、两个语言的结构一致。

Run:

```powershell
node --test test/unit-ci/sftp-context-menu.spec.js test/unit-ci/sftp-file-context-i18n.spec.js
.\node_modules\.bin\standard.cmd src/client/components/sftp/context-menu-utils.js src/client/components/sftp/sftp-file-context-menu.js src/client/components/sftp/file-item.jsx src/client/components/sftp/list-table-ui.jsx
```

Expected: 全部 PASS，StandardJS 无输出。

- [ ] **Step 8: 提交菜单改动**

```powershell
git add src/client/components/sftp/context-menu-utils.js src/client/components/sftp/sftp-file-context-menu.js src/client/components/sftp/file-item.jsx src/client/components/sftp/list-table-ui.jsx src/client/components/common/context-menu.styl src/client/common/shellpilot-i18n-overrides.js test/unit-ci/sftp-context-menu.spec.js test/unit-ci/sftp-file-context-i18n.spec.js
git commit -m "feat(sftp): streamline context actions"
```

## Task 4：安全默认焦点与快速删除确认

**Files:**
- Create: `src/client/components/sftp/sftp-delete-dialog-model.js`
- Create: `test/unit-ci/sftp-delete-dialog.spec.js`
- Modify: `src/client/components/common/modal.jsx`
- Modify: `src/client/components/common/modal.styl`
- Modify: `src/client/components/sftp/sftp-entry.jsx`
- Modify: `src/client/components/sftp/sftp.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `test/unit-ci/ui-accessibility-contract.spec.js`
- Modify: `test/unit-ci/sftp-safety-transaction.spec.js`

- [ ] **Step 1: 写入 Modal 与目标摘要失败测试**

`sftp-delete-dialog.spec.js`：

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('delete target preview lists three names and the remaining count', async () => {
  const { buildDeleteTargetPreview } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-delete-dialog-model.js'
  )).href)
  const preview = buildDeleteTargetPreview(
    ['a.log', 'b.log', 'c.log', 'd.log'].map(name => ({ name })),
    { separator: '、' }
  )
  assert.equal(preview.names, 'a.log、b.log、c.log')
  assert.equal(preview.remaining, 1)
  assert.equal(preview.count, 4)
})
```

`ui-accessibility-contract.spec.js` 增加：

```js
assert.match(modal, /initialFocusSelector/)
assert.match(modal, /okButtonProps\?\.disabled/)
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/ui-accessibility-contract.spec.js
```

Expected: FAIL，新模型和 Modal 能力尚不存在。

- [ ] **Step 3: 实现删除目标摘要**

新建 `sftp-delete-dialog-model.js`：

```js
export function buildDeleteTargetPreview (files = [], options = {}) {
  const separator = options.separator || ', '
  const names = files.slice(0, 3)
    .map(file => String(file?.name || file?.path || ''))
    .filter(Boolean)
  return {
    count: files.length,
    names: names.join(separator),
    remaining: Math.max(0, files.length - names.length)
  }
}
```

- [ ] **Step 4: 扩展 Modal 的禁用和初始焦点能力**

`Modal` props 增加 `initialFocusSelector`，effect 中使用：

```js
const requestedFocus = initialFocusSelector
  ? content?.querySelector(initialFocusSelector)
  : null
const initialFocus = requestedFocus || getFocusableElements(content)[0] || content
initialFocus?.focus()
```

创建和更新确认按钮都加入：

```jsx
disabled={okButtonProps?.disabled}
```

与更新分支对应使用 `newOkButtonProps?.disabled`。禁用按钮样式使用 `cursor not-allowed`、`opacity .55`，并保持危险按钮色彩含义。

- [ ] **Step 5: 增强快速删除确认**

`confirmQuickDelete()` 调用 `buildDeleteTargetPreview()`，内容包含风险说明和目标列表：

```jsx
const preview = buildDeleteTargetPreview(files, {
  separator: e('shellpilotListSeparator')
})
content: (
  <div className='sftp-fast-delete-confirmation'>
    <div className='sftp-delete-risk-badge'>
      {e('shellpilotSftpFastDeleteRisk')}
    </div>
    <div>{formatShellPilotTranslation(e, 'shellpilotSftpFastDeleteConfirmBody', { count: preview.count })}</div>
    <code className='sftp-delete-targets'>{preview.names}</code>
    {preview.remaining > 0 && (
      <div>{formatShellPilotTranslation(e, 'shellpilotSftpDeleteMoreTargets', { count: preview.remaining })}</div>
    )}
  </div>
),
keyboardConfirm: false,
initialFocusSelector: '.custom-modal-cancel-btn'
```

新增中英文风险、剩余目标文案；保留 `okButtonProps: { danger: true }` 和单次确认。

- [ ] **Step 6: 运行测试并提交**

Run:

```powershell
node --test test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/ui-accessibility-contract.spec.js test/unit-ci/sftp-safety-transaction.spec.js
.\node_modules\.bin\standard.cmd src/client/components/common/modal.jsx src/client/components/sftp/sftp-delete-dialog-model.js src/client/components/sftp/sftp-entry.jsx
```

Expected: 全部 PASS，StandardJS 无输出。

```powershell
git add src/client/components/common/modal.jsx src/client/components/common/modal.styl src/client/components/sftp/sftp-delete-dialog-model.js src/client/components/sftp/sftp-entry.jsx src/client/components/sftp/sftp.styl src/client/common/shellpilot-i18n-overrides.js test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/ui-accessibility-contract.spec.js test/unit-ci/sftp-safety-transaction.spec.js
git commit -m "feat(sftp): strengthen delete confirmation UX"
```

## Task 5：立即出现的安全删除准备态

**Files:**
- Create: `src/client/components/sftp/sftp-delete-dialog.jsx`
- Modify: `src/client/components/sftp/sftp-entry.jsx`
- Modify: `src/client/components/sftp/sftp.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `test/unit-ci/sftp-delete-dialog.spec.js`
- Modify: `test/unit-ci/sftp-safety-transaction.spec.js`

- [ ] **Step 1: 写入阶段式对话框失败测试**

在 `sftp-delete-dialog.spec.js` 增加源码契约：

```js
const fs = require('node:fs')
const projectRoot = path.resolve(__dirname, '../..')

test('safe delete dialog starts disabled and exposes ready, fail, and retry states', () => {
  const source = fs.readFileSync(path.join(
    projectRoot,
    'src/client/components/sftp/sftp-delete-dialog.jsx'
  ), 'utf8')
  assert.match(source, /shellpilotSftpSafeDeletePreparing/)
  assert.match(source, /okButtonProps:\s*\{\s*disabled:\s*true/)
  assert.match(source, /ready\s*\(/)
  assert.match(source, /fail\s*\(/)
  assert.match(source, /'retry'/)
  assert.match(source, /keyboardConfirm:\s*false/)
})
```

在 `sftp-safety-transaction.spec.js` 断言安全删除先打开对话框，再并行调用 `prepareSftpSafetyOperation`，并且验证前不执行 `sftpSafetyRunner.execute`。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/sftp-safety-transaction.spec.js
```

Expected: FAIL，阶段式控制器不存在。

- [ ] **Step 3: 实现安全删除对话框控制器**

新建 `sftp-delete-dialog.jsx`，导出：

```jsx
export function openSafeDeleteDialog ({ files, externalSignal, translate }) {
  const controller = new AbortController()
  let settled = false
  let resolveDecision
  const decision = new Promise(resolve => { resolveDecision = resolve })
  const settle = value => {
    if (settled) return
    settled = true
    externalSignal?.removeEventListener('abort', onExternalAbort)
    resolveDecision(value)
  }
  const onExternalAbort = () => {
    controller.abort()
    modal.destroy()
    settle('cancel')
  }
  if (externalSignal?.aborted) {
    queueMicrotask(onExternalAbort)
  } else {
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
  }

  const modal = Modal.confirm({
    title: translate('shellpilotSftpSafeDeleteTitle'),
    content: <SafeDeleteDialogBody state='preparing' files={files} translate={translate} />,
    okText: translate('shellpilotSftpSafeDeleteAction'),
    cancelText: translate('cancel'),
    okButtonProps: { disabled: true },
    keyboardConfirm: false,
    initialFocusSelector: '.custom-modal-cancel-btn',
    onOk: () => {},
    onCancel: () => {
      controller.abort()
      settle('cancel')
    }
  })

  return {
    signal: controller.signal,
    decision,
    ready (count) {
      if (settled) return
      modal.update({
        content: <SafeDeleteDialogBody state='ready' files={files} count={count} translate={translate} />,
        okButtonProps: { disabled: false },
        onOk: () => settle('confirm')
      })
    },
    fail (error) {
      if (settled) return
      modal.update({
        content: <SafeDeleteDialogBody state='failed' files={files} error={error} translate={translate} />,
        okText: translate('shellpilotRetry'),
        okButtonProps: { disabled: false },
        onOk: () => settle('retry')
      })
    },
    destroy () {
      modal.destroy()
      controller.abort()
      settle('cancel')
    }
  }
}
```

`SafeDeleteDialogBody` 渲染准备、已验证和失败三种文字，目标摘要复用 `buildDeleteTargetPreview()`。

- [ ] **Step 4: 改造安全删除流程**

`deleteRemoteFilesWithSafety()` 的 SSH/SFTP 分支使用循环处理重试：

```js
const targets = this.getRemoteSafetyTargets(files)
while (targets.length) {
  const dialog = openSafeDeleteDialog({
    files: targets,
    externalSignal: options.signal,
    translate: e
  })
  const prepared = await Promise.allSettled(targets.map(file => {
    const source = resolve(file.path, file.name)
    return this.prepareSftpSafetyOperation({
      action: 'delete',
      paths: { source },
      type: file.isDirectory ? 'directory' : 'file',
      expected: { absent: true },
      title: e('shellpilotSftpDelete'),
      signal: dialog.signal
    })
  }))
  const operations = prepared
    .filter(item => item.status === 'fulfilled')
    .map(item => item.value)
  const failed = prepared.find(item => item.status === 'rejected')

  if (dialog.signal.aborted) {
    await Promise.allSettled(operations.map(operation => this.sftpSafetyRunner.cancel(operation.id)))
    return false
  }

  if (failed) {
    await Promise.allSettled(operations.map(operation => this.sftpSafetyRunner.cancel(operation.id)))
    dialog.fail(failed.reason)
    if (await dialog.decision === 'retry') continue
    return false
  }
  dialog.ready(operations.length)
  if (await dialog.decision !== 'confirm') {
    await Promise.allSettled(operations.map(operation => this.sftpSafetyRunner.cancel(operation.id)))
    return false
  }
  for (const operation of operations) {
    await this.sftpSafetyRunner.execute(operation.id, {
      confirmed: true,
      signal: options.signal
    })
  }
  message.success(formatShellPilotTranslation(e, 'shellpilotSftpDeletedWithRecovery', {
    count: operations.length
  }))
  return true
}
return false
```

保留外部取消、已准备事务清理、端点验证和 FTP 原路径。若取消发生在准备期间，等待 `Promise.allSettled()` 收束后取消所有已创建事务。

- [ ] **Step 5: 添加准备、就绪、失败和重试文案及样式**

新增中英文键：`shellpilotSftpSafeDeleteTitle`、`shellpilotSftpSafeDeletePreparing`、`shellpilotSftpSafeDeleteReady`、`shellpilotSftpSafeDeleteFailed`、`shellpilotSftpSafeDeleteAction`、`shellpilotRetry`。准备态使用可访问的忙碌状态，失败态显示错误文本但不泄露凭据。

- [ ] **Step 6: 运行测试并提交**

Run:

```powershell
node --test test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/sftp-safety-transaction.spec.js
.\node_modules\.bin\standard.cmd src/client/components/sftp/sftp-delete-dialog.jsx src/client/components/sftp/sftp-entry.jsx
```

Expected: 全部 PASS，StandardJS 无输出。

```powershell
git add src/client/components/sftp/sftp-delete-dialog.jsx src/client/components/sftp/sftp-entry.jsx src/client/components/sftp/sftp.styl src/client/common/shellpilot-i18n-overrides.js test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/sftp-safety-transaction.spec.js
git commit -m "feat(sftp): show safe delete preparation immediately"
```

## Task 6：结构化 SSH 主机指纹确认

**Files:**
- Create: `src/client/components/terminal/ssh-host-key-confirmation.jsx`
- Create: `src/client/components/terminal/ssh-host-key-confirmation.styl`
- Create: `test/unit-ci/ssh-host-key-confirmation.spec.js`
- Modify: `src/app/server/ssh-known-hosts.js`
- Modify: `src/client/components/terminal/terminal-interactive-ui.jsx`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `test/unit-ci/session-ssh-known-hosts.spec.js`

- [ ] **Step 1: 写入结构化数据失败测试**

在 `session-ssh-known-hosts.spec.js` 的未知主机和变化主机断言中加入：

```js
assert.deepEqual(unknownPrompt.hostKeyDetails, {
  target: 'new-host.test',
  keyType: 'ssh-ed25519',
  fingerprint: 'SHA256:AAABBBCCC123',
  knownHostsPath: 'C:\\Users\\test\\.ssh\\known_hosts',
  hostKeyChanged: false
})
assert.equal(mismatchPrompt.hostKeyDetails.hostKeyChanged, true)
assert.equal(mismatchPrompt.hostKeyDetails.target, '[router.test]:2222')
```

新建 `ssh-host-key-confirmation.spec.js`，读取组件源码并断言：

```js
assert.match(source, /hostKeyDetails/)
assert.match(source, /copyToClipboard\(details\.fingerprint\)/)
assert.match(source, /copyToClipboard\(details\.knownHostsPath\)/)
assert.match(source, /shellpilotCopyHostFingerprint/)
assert.match(source, /shellpilotCopyKnownHostsPath/)
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test test/unit-ci/session-ssh-known-hosts.spec.js test/unit-ci/ssh-host-key-confirmation.spec.js
```

Expected: FAIL，`hostKeyDetails` 和展示组件不存在。

- [ ] **Step 3: 在服务器提示中增加兼容字段**

`buildUnknownHostPrompt()` 增加：

```js
hostKeyDetails: {
  target,
  keyType: meta.keyType,
  fingerprint: formatSha256Fingerprint(meta.sha256),
  knownHostsPath,
  hostKeyChanged: false
}
```

`buildHostMismatchPrompt()` 增加同样字段并设置 `hostKeyChanged: true`。保留现有 `instructions`、`submitText`、`cancelText` 和 `confirmResult`。

- [ ] **Step 4: 创建结构化展示组件**

`ssh-host-key-confirmation.jsx` 使用现有剪贴板工具：

```jsx
import { Button } from 'antd'
import React from 'react'
import { copy as copyToClipboard } from '../../common/clipboard'
import './ssh-host-key-confirmation.styl'

export default function SshHostKeyConfirmation ({ details, instructions, translate }) {
  if (!details) {
    return <div>{instructions.map(note => <pre key={note}>{note}</pre>)}</div>
  }
  return (
    <div className={`ssh-host-key-confirmation${details.hostKeyChanged ? ' is-changed' : ''}`}>
      {details.hostKeyChanged && (
        <div className='ssh-host-key-warning'>{translate('shellpilotHostKeyChangedWarning')}</div>
      )}
      <dl>
        <dt>{translate('shellpilotHostKeyTarget')}</dt><dd>{details.target}</dd>
        <dt>{translate('shellpilotHostKeyType')}</dt><dd>{details.keyType}</dd>
        <dt>{translate('shellpilotHostFingerprint')}</dt>
        <dd className='ssh-host-key-copy-row'>
          <code>{details.fingerprint}</code>
          <Button size='small' onClick={() => copyToClipboard(details.fingerprint)}>
            {translate('shellpilotCopyHostFingerprint')}
          </Button>
        </dd>
        <dt>known_hosts</dt>
        <dd className='ssh-host-key-copy-row'>
          <code>{details.knownHostsPath}</code>
          <Button size='small' onClick={() => copyToClipboard(details.knownHostsPath)}>
            {translate('shellpilotCopyKnownHostsPath')}
          </Button>
        </dd>
      </dl>
    </div>
  )
}
```

样式要求 `code` 使用等宽字体、`overflow-wrap anywhere`、路径完整换行；变化状态使用危险边框，不出现横向滚动条。

- [ ] **Step 5: 将确认按钮移入标准页脚并设置安全焦点**

`terminal-interactive-ui.jsx` 的 confirm 模式：

- body 渲染 `SshHostKeyConfirmation`。
- footer DOM 顺序为拒绝、信任/更新。
- 拒绝按钮类名为 `terminal-interactive-cancel`。
- Modal props 设置：

```jsx
keyboardConfirm={false}
initialFocusSelector='.terminal-interactive-cancel'
```

Escape 和关闭继续调用 `onCancel()` 并返回空结果。

- [ ] **Step 6: 添加中英文文案并运行测试**

新增：`shellpilotHostKeyTarget`、`shellpilotHostKeyType`、`shellpilotCopyHostFingerprint`、`shellpilotCopyKnownHostsPath`、`shellpilotHostKeyChangedWarning`。

Run:

```powershell
node --test test/unit-ci/session-ssh-known-hosts.spec.js test/unit-ci/ssh-host-key-confirmation.spec.js test/unit-ci/ui-accessibility-contract.spec.js
.\node_modules\.bin\standard.cmd src/app/server/ssh-known-hosts.js src/client/components/terminal/ssh-host-key-confirmation.jsx src/client/components/terminal/terminal-interactive-ui.jsx
```

Expected: 全部 PASS，StandardJS 无输出。

- [ ] **Step 7: 提交主机指纹改动**

```powershell
git add src/app/server/ssh-known-hosts.js src/client/components/terminal/ssh-host-key-confirmation.jsx src/client/components/terminal/ssh-host-key-confirmation.styl src/client/components/terminal/terminal-interactive-ui.jsx src/client/common/shellpilot-i18n-overrides.js test/unit-ci/session-ssh-known-hosts.spec.js test/unit-ci/ssh-host-key-confirmation.spec.js test/unit-ci/ui-accessibility-contract.spec.js
git commit -m "feat(ssh): improve host key confirmation UX"
```

## Task 7：完整交互回归与视觉验收

**Files:**
- Modify: `test/e2e/027.quality-core-flows.spec.js`

- [ ] **Step 1: 扩展 E2E 的主机指纹断言**

在接受主机指纹前断言：

```js
await expect(modal).toContainText(/主机指纹|Host fingerprint/i)
await expect(modal.locator('.ssh-host-key-copy-row')).toHaveCount(2)
await expect(modal.locator('code')).toContainText('SHA256:')
await expect(modal.locator('.terminal-interactive-cancel')).toBeFocused()
```

- [ ] **Step 2: 扩展键盘菜单断言**

聚焦远程文件行后执行：

```js
await remoteSeed.focus()
await page.keyboard.press('Shift+F10')
const keyboardMenu = page.locator('.ant-dropdown:visible').last()
await expect(keyboardMenu).toBeVisible()
await expect(keyboardMenu.getByText(/安全删除.*可恢复|Safe Delete.*Recoverable/i)).toBeVisible()
await expect(keyboardMenu.getByText(/快速删除.*不可恢复|Fast Delete.*Permanent/i)).toBeVisible()
await page.keyboard.press('Escape')
await expect(remoteSeed).toBeFocused()
```

- [ ] **Step 3: 扩展锁定文件部分完成断言**

将原先 completed 断言替换为：

```js
await expect(lockedDock).toHaveClass(/sftp-transfer-progress-dock-partial/)
await expect(lockedDock).toContainText(/成功\s*1.*跳过\s*1|1 successful.*1 skipped/i)
await expect(lockedDock).not.toContainText(/总量计算中|Calculating total|\/\s*0 B/i)
await expect(lockedDock.getByRole('button', { name: /关闭传输结果|Dismiss transfer result/i })).toBeVisible()
```

- [ ] **Step 4: 扩展安全删除立即反馈断言**

点击安全删除后立即检查：

```js
const safeDeleteConfirm = page.locator('.custom-modal-wrap:visible').last()
await expect(safeDeleteConfirm).toBeVisible({ timeout: 1000 })
await expect(safeDeleteConfirm).toContainText(/正在准备恢复快照|Preparing recovery snapshot/i)
await expect(safeDeleteConfirm.locator('.custom-modal-ok-btn')).toBeDisabled()
await expect(safeDeleteConfirm).toContainText(/恢复快照已验证|Recovery snapshot verified/i, {
  timeout: 30000
})
await expect(safeDeleteConfirm.locator('.custom-modal-ok-btn')).toBeEnabled()
```

- [ ] **Step 5: 运行更新后的完整核心 E2E**

Run:

```powershell
.\node_modules\.bin\playwright.cmd test test/e2e/027.quality-core-flows.spec.js --workers=1 --reporter=line
```

Expected: 1 passed；连接、终端、上传下载、锁定文件、快速删除、安全删除和恢复全部通过。

- [ ] **Step 6: 运行相关单元测试集合**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/sftp-context-menu.spec.js test/unit-ci/sftp-file-context-i18n.spec.js test/unit-ci/sftp-delete-dialog.spec.js test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/session-ssh-known-hosts.spec.js test/unit-ci/ssh-host-key-confirmation.spec.js test/unit-ci/ui-accessibility-contract.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
```

Expected: 全部 PASS，无跳过和未处理 rejection。

- [ ] **Step 7: 运行全量常规自检**

Run:

```powershell
npm run lint
npm run test-unit-ci
npm run compile
npm run test-quality-e2e
```

Expected: 四条命令全部退出码 0；质量 E2E 中 `027` 和 `028` 均通过。

- [ ] **Step 8: 使用隔离 Playwright 环境复查视觉状态**

重新捕获并人工检查以下状态：

- SSH 主机指纹首次连接与指纹变化。
- SFTP 一级菜单及两个子菜单。
- 传输中、完全成功、部分完成和失败进度坞。
- 快速删除风险确认。
- 安全删除准备、就绪和失败状态。

验收时确认无截断、无横向滚动、无相互矛盾文案、焦点环清楚、浅色和深色主题均可读。

- [ ] **Step 9: 提交集成回归**

```powershell
git add test/e2e/027.quality-core-flows.spec.js
git commit -m "test: cover polished SSH and SFTP workflows"
```

- [ ] **Step 10: 最终工作树检查**

Run:

```powershell
git status --short
git log -8 --oneline
```

Expected: 仅保留未提交的 `.superpowers/` 和 `audit-results/` 审计工件；所有产品、测试和文档改动均已按任务提交。
