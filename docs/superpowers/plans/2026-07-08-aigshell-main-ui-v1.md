# AIGShell Main UI V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first AIGShell desktop shell matching the approved minimal tool-style reference: terminal-first center, narrow Chinese tool rail, top command toolbar, and clean AI assistant panel.

**Architecture:** Keep Electerm SSH/SFTP/terminal internals intact. Add a thin AIGShell shell layer around existing layout components, adjust layout offsets through a small tested helper, and restyle existing sidebar/right AI panel instead of replacing terminal logic.

**Tech Stack:** React 19, Ant Design 6, Stylus, Manate store, Node test runner, StandardJS.

---

### Task 1: Layout Chrome Contract

**Files:**
- Create: `apps/electerm-agent/src/client/components/main/aigshell-layout.js`
- Test: `apps/electerm-agent/test/unit-ci/aigshell-layout.spec.js`
- Modify: `apps/electerm-agent/src/client/common/constants.js`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  aigshellTopBarHeight,
  getAIGShellContentFrame
} = require('../../src/client/components/main/aigshell-layout.js')

test('computes terminal content frame below AIGShell top bar', () => {
  const frame = getAIGShellContentFrame({
    width: 1600,
    height: 900,
    footerHeight: 36,
    sidebarWidth: 43,
    leftSidebarWidth: 280,
    rightPanelWidth: 360,
    pinned: true,
    rightPanelVisible: true,
    rightPanelPinned: true,
    pinnedQuickCommandBar: false,
    inActiveTerminal: true,
    quickCommandBoxHeight: 180,
    resizeTrigger: 0
  })

  assert.equal(aigshellTopBarHeight, 44)
  assert.deepEqual(frame, {
    top: 44,
    left: 323,
    width: 917,
    height: 820
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit-ci/aigshell-layout.spec.js`

Expected: FAIL because `aigshell-layout.js` does not exist.

- [ ] **Step 3: Add the helper**

```js
export const aigshellTopBarHeight = 44

export function getAIGShellContentFrame ({
  width,
  height,
  footerHeight,
  sidebarWidth,
  leftSidebarWidth,
  rightPanelWidth,
  pinned,
  rightPanelVisible,
  rightPanelPinned,
  pinnedQuickCommandBar,
  inActiveTerminal,
  quickCommandBoxHeight,
  resizeTrigger = 0
}) {
  const left = pinned ? sidebarWidth + leftSidebarWidth : sidebarWidth
  const right = rightPanelVisible && rightPanelPinned ? rightPanelWidth : 0
  const quickBarHeight = inActiveTerminal && pinnedQuickCommandBar ? quickCommandBoxHeight : 0
  return {
    top: aigshellTopBarHeight,
    left,
    width: width - left - right,
    height: height - aigshellTopBarHeight - footerHeight - quickBarHeight + resizeTrigger
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit-ci/aigshell-layout.spec.js`

Expected: PASS.

### Task 2: Top Toolbar

**Files:**
- Create: `apps/electerm-agent/src/client/components/main/aigshell-topbar.jsx`
- Create: `apps/electerm-agent/src/client/components/main/aigshell-topbar.styl`
- Modify: `apps/electerm-agent/src/client/components/main/main.jsx`

- [ ] **Step 1: Add topbar component**

Topbar renders logo, `AIGShell`, current tab title, online dot, and buttons: `新建`, `快连`, `模型API`, `备份`, `更新`, `设置`.

- [ ] **Step 2: Wire actions to existing store**

Use existing methods only: `store.onNewSsh`, `store.toggleAIConfig`, `store.openSetting`, `store.openSettingSync`, `store.onCheckUpdate`. For quick connect, trigger `store.addTab` when local terminal is available, otherwise `store.onNewSsh`.

- [ ] **Step 3: Render topbar in `main.jsx`**

Place it inside `#outside-context` before `Sidebar` and `Layout` so it behaves as client chrome.

### Task 3: Layout Offset

**Files:**
- Modify: `apps/electerm-agent/src/client/components/layout/layout.jsx`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/sidebar.styl`
- Modify: `apps/electerm-agent/src/client/components/footer/footer.styl`

- [ ] **Step 1: Use `getAIGShellContentFrame` in `Layout.calcLayoutStyle`**

Replace the inline frame calculation with the helper so terminal tabs and sessions start under the new topbar.

- [ ] **Step 2: Adjust split layout height**

Subtract `aigshellTopBarHeight` from split layout height to avoid terminal overflow.

- [ ] **Step 3: Offset side panels**

Make left panel and right AI panel start below the 44px topbar while keeping the narrow rail full height.

### Task 4: Tool Rail and Footer Polish

**Files:**
- Modify: `apps/electerm-agent/src/client/components/sidebar/index.jsx`
- Modify: `apps/electerm-agent/src/client/components/sidebar/sidebar.styl`
- Modify: `apps/electerm-agent/src/client/components/footer/footer-entry.jsx`
- Modify: `apps/electerm-agent/src/client/components/footer/footer.styl`

- [ ] **Step 1: Rename visible tooltips to Chinese tool terms**

Use labels: `服务器`, `新建`, `快连`, `SFTP`, `历史`, `密钥`, `日志`, `设置`, `工具`.

- [ ] **Step 2: Keep icon rail compact**

Use the existing rail width and style it as a light Windows tool strip with clear selected state.

- [ ] **Step 3: Make footer status-like**

Show useful status text without adding new backend behavior: `SSH 已连接`, active user/host when available, encoding, and current terminal info icon.

### Task 5: AI Assistant Panel

**Files:**
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/side-panel-r.jsx`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel.styl`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai.styl`

- [ ] **Step 1: Change right panel header for AI**

Render title `AI 助手`, online status, model text from config, and collapse/close controls.

- [ ] **Step 2: Simplify input action row**

Use compact chips: `终端`, `选中`, `文件`, `联网`, `MCP`, `CLI`, and keep send button on the right.

- [ ] **Step 3: Keep chat as chat**

Do not add plan cards or diagnostic cards in the chat area. Existing tool call cards remain collapsed/compact for agent mode only.

### Task 6: Verification

**Files:**
- No new production files.

- [ ] **Step 1: Run targeted tests**

Run: `node --test test/unit-ci/aigshell-layout.spec.js`

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```powershell
$env:XDG_CACHE_HOME = (Join-Path (Get-Location) '.tmp-cache'); $env:LOCALAPPDATA = (Join-Path (Get-Location) '.tmp-cache'); npx.cmd standard src/client/components/main/aigshell-layout.js src/client/components/main/aigshell-topbar.jsx src/client/components/main/main.jsx src/client/components/layout/layout.jsx src/client/components/sidebar/index.jsx src/client/components/footer/footer-entry.jsx src/client/components/side-panel-r/side-panel-r.jsx src/client/components/ai/ai-chat.jsx test/unit-ci/aigshell-layout.spec.js; $code=$LASTEXITCODE; if (Test-Path -LiteralPath '.tmp-cache') { Remove-Item -LiteralPath '.tmp-cache' -Recurse -Force }; exit $code
```

Expected: exit code 0.

- [ ] **Step 3: Run full unit CI**

Run: `npm.cmd run test-unit-ci`

Expected: all unit CI tests pass.
