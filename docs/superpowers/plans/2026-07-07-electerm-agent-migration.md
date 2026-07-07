# Electerm Agent Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current self-built SSH prototype with an Electerm-based Windows SSH client that keeps mature SSH/SFTP behavior and adds Chinese UI, model API access, server backup, online updates, and AI-assisted troubleshooting tied directly to SSH sessions.

**Architecture:** Electerm becomes the product base and owns terminal, SSH, SFTP, tabs, shortcuts, and file transfer behavior. New product value is added as isolated Agent modules, model-provider modules, backup/export modules, update-channel packaging, and a right-side AI assistant panel that reads terminal/SFTP context through Electerm's existing renderer/main-process/MCP surfaces.

**Tech Stack:** Electerm, Electron, React, Vite, Ant Design, xterm.js, `@electerm/ssh2`, `node-pty`, Electerm MCP server surface, GitHub Releases update channel, current `apps/ssh-agent-ui-preview` as reference only.

---

## Decision Summary

Current final direction:

- Stop treating `apps/ssh-agent-ui-preview` as the formal SSH client base.
- Use Electerm as the preferred open-source SSH client base.
- Use Tabby as a fallback reference for plugin architecture and terminal UX, not the first base.
- Keep `apps/ssh-agent-ui-preview` as a requirement prototype and reference implementation only.
- Do not continue adding production SSH terminal features to the prototype except emergency reference fixes.

Evidence:

- Electerm is MIT licensed and describes itself as a terminal/SSH/SFTP/FTP/Telnet/serial/RDP/VNC client for Windows/macOS/Linux.
- Electerm uses Electron, React, Vite, xterm.js, `@electerm/ssh2`, `node-pty`, and SFTP/file-transfer modules.
- Local scan found `external/electerm/src/app/widgets/widget-mcp-server.js` and `external/electerm/src/client/store/mcp-handler.js`, including tools for terminal command send/cancel/output/status, SSH tab opening, bookmark listing, and SFTP list/stat/read/upload/download.
- Tabby is also MIT and mature, but its Angular/plugin monorepo is broader and less directly aligned with SSH+SFTP file-manager requirements.

External references checked on 2026-07-07:

- Electerm GitHub: `https://github.com/electerm/electerm`
- Tabby GitHub: `https://github.com/Eugeny/tabby`

---

## File Structure

Create and maintain these files:

- `docs/evaluations/open-source-base/electerm-tabby-recheck.md`: records the July 2026 re-evaluation and why Electerm replaces the earlier WinkTerm direction.
- `docs/evaluations/open-source-base/decision.md`: update the decision so future work does not accidentally continue the prototype/WinkTerm path.
- `apps/ssh-agent-ui-preview/`: keep as reference only; no new formal SSH-client features.
- `external/electerm/`: local upstream clone for evaluation only; do not commit.
- `apps/electerm-agent/`: future fork/import workspace for the Electerm-based product.
- `apps/electerm-agent/AGENT_MIGRATION.md`: fork-specific migration notes after the base is imported.
- `apps/electerm-agent/src/client/components/ai-assistant/`: right-side AI panel and chat UI.
- `apps/electerm-agent/src/client/store/agent-context.js`: reads terminal/SFTP/bookmark context without secrets.
- `apps/electerm-agent/src/app/agent/model-providers.js`: OpenAI-compatible provider configuration and model-list fetching.
- `apps/electerm-agent/src/app/agent/policy.js`: read-only/confirmation policy for AI-proposed commands.
- `apps/electerm-agent/src/app/agent/backup.js`: server metadata backup/export/import without leaking secrets.
- `apps/electerm-agent/build/agent-release.js`: online update release packaging against GitHub Releases.

---

### Task 1: Record The Product Pivot

**Files:**
- Create: `docs/evaluations/open-source-base/electerm-tabby-recheck.md`
- Modify: `docs/evaluations/open-source-base/decision.md`

- [ ] **Step 1: Create the recheck document**

Create `docs/evaluations/open-source-base/electerm-tabby-recheck.md` with:

```markdown
# Electerm / Tabby Recheck

Date: 2026-07-07

## Reason

The current self-built SSH client prototype does not meet formal SSH client expectations. It is kept as a requirement prototype only. The formal product must be based on a mature open-source SSH client.

## Decision

Primary base: Electerm.

Fallback/reference: Tabby.

## Electerm Evidence

- Repository: https://github.com/electerm/electerm
- License: MIT.
- Local snapshot: record `git -C external/electerm rev-parse --short HEAD`.
- Desktop stack: Electron, React, Vite, Ant Design.
- Terminal stack: xterm.js and node-pty.
- SSH/SFTP stack: `@electerm/ssh2`, `ssh2-scp`, SFTP/file-transfer modules.
- Existing MCP bridge evidence:
  - `external/electerm/src/app/widgets/widget-mcp-server.js`
  - `external/electerm/src/client/store/mcp-handler.js`
- Existing MCP bridge includes terminal command send/cancel/output/status, SSH tab creation, bookmark listing, and SFTP list/stat/read/upload/download.

## Tabby Evidence

- Repository: https://github.com/Eugeny/tabby
- License: MIT.
- Local snapshot: record `git -C external/tabby rev-parse --short HEAD`.
- Desktop stack: Electron and Angular monorepo.
- Strength: mature terminal and plugin architecture.
- Reason not first base: less direct fit for SSH+SFTP file-manager-first workflow and larger integration surface.

## Product Impact

The formal client will be rebuilt from Electerm. `apps/ssh-agent-ui-preview` remains a reference for Chinese product copy, model API flows, backup flows, and release/update lessons.
```

- [ ] **Step 2: Fill local snapshot values**

Run:

```powershell
git -C external/electerm rev-parse --short HEAD
git -C external/electerm log -1 --format="%ci %s"
git -C external/tabby rev-parse --short HEAD
git -C external/tabby log -1 --format="%ci %s"
```

Expected:

- Electerm snapshot is recorded as `2db0c56`, latest subject `Update logo`.
- Tabby snapshot is recorded as `6955c4f`, latest subject `another attempt at tab blanking/flicker`.

- [ ] **Step 3: Update the previous decision**

At the top of `docs/evaluations/open-source-base/decision.md`, insert:

```markdown
> Superseded on 2026-07-07: The formal product direction is now Electerm-based secondary development. The earlier WinkTerm/prototype route is retained only as historical evaluation context because the self-built SSH client path did not satisfy formal SSH client expectations.
```

- [ ] **Step 4: Commit the pivot**

Run:

```powershell
git add docs/evaluations/open-source-base/electerm-tabby-recheck.md docs/evaluations/open-source-base/decision.md
git commit -m "docs: pivot formal SSH client base to Electerm"
```

Expected: commit succeeds.

---

### Task 2: Import Electerm As The Formal Base

**Files:**
- Create: `apps/electerm-agent/`
- Create: `apps/electerm-agent/AGENT_MIGRATION.md`
- Modify: `.gitignore`

- [ ] **Step 1: Verify Electerm clone exists**

Run:

```powershell
Test-Path external/electerm
git -C external/electerm status --short
```

Expected:

- First command prints `True`.
- Second command is clean or only shows ignored local build files.

- [ ] **Step 2: Copy Electerm into the product workspace**

Run:

```powershell
robocopy external\electerm apps\electerm-agent /E /XD .git node_modules dist build out release .tmp /XF .env *.log
if ($LASTEXITCODE -le 7) { exit 0 } else { exit $LASTEXITCODE }
```

Expected:

- `apps/electerm-agent/package.json` exists.
- `apps/electerm-agent/src/app/widgets/widget-mcp-server.js` exists.
- `apps/electerm-agent/src/client/store/mcp-handler.js` exists.

- [ ] **Step 3: Add migration notes**

Create `apps/electerm-agent/AGENT_MIGRATION.md` with:

```markdown
# Electerm Agent Migration

Base: Electerm
Imported from: https://github.com/electerm/electerm
Import date: 2026-07-07
Initial upstream snapshot: 2db0c56

## Product Rules

- Preserve upstream SSH, SFTP, terminal, tab, shortcut, and file-transfer behavior.
- Add Agent features beside existing flows instead of rewriting SSH internals.
- Keep product-specific code under `src/app/agent`, `src/client/components/ai-assistant`, and `src/client/store/agent-*`.
- Keep Chinese UI copy in localization files where Electerm already supports localization.
- Use Electerm's MCP bridge and terminal context APIs before introducing new IPC contracts.

## Prototype Reference

The previous prototype at `apps/ssh-agent-ui-preview` is reference-only for:

- Chinese layout and copy.
- Model API configuration.
- Server backup/export/import ideas.
- Online update release lessons.
- Agent approval and audit workflow ideas.

It is not the formal SSH terminal base.
```

- [ ] **Step 4: Update ignore rules for Electerm build outputs**

Append to `.gitignore`:

```gitignore
/apps/electerm-agent/node_modules/
/apps/electerm-agent/dist/
/apps/electerm-agent/build/
/apps/electerm-agent/out/
/apps/electerm-agent/release/
/apps/electerm-agent/.tmp/
```

- [ ] **Step 5: Commit the base import**

Run:

```powershell
git add .gitignore apps/electerm-agent
git commit -m "feat: import Electerm as SSH agent base"
```

Expected: commit succeeds without adding `node_modules`, build outputs, or `.git`.

---

### Task 3: Validate Electerm Base Runtime On Windows

**Files:**
- Create: `docs/evaluations/electerm-agent-runtime.md`

- [ ] **Step 1: Install dependencies**

Run:

```powershell
Set-Location apps/electerm-agent
npm install
```

Expected:

- `node_modules` is created locally and remains ignored.
- Native modules install or print a concrete error to record.

- [ ] **Step 2: Run unit/build checks available in Electerm**

Run:

```powershell
Set-Location apps/electerm-agent
npm run test-unit-ci
npm run build
```

Expected:

- PASS: commands exit 0.
- If native Windows build fails, record exact module and error.

- [ ] **Step 3: Start Electerm dev app**

Run:

```powershell
Set-Location apps/electerm-agent
npm run start
```

Expected:

- Electerm window starts.
- SSH bookmark creation and terminal open can be manually tested.
- SFTP panel opens for an SSH session.

- [ ] **Step 4: Create runtime report**

Create `docs/evaluations/electerm-agent-runtime.md` with:

```markdown
# Electerm Agent Runtime Validation

Date: 2026-07-07

## Commands

| Command | Result | Notes |
|---|---|---|
| `npm install` | PASS or FAIL | exact note |
| `npm run test-unit-ci` | PASS or FAIL | exact note |
| `npm run build` | PASS or FAIL | exact note |
| `npm run start` | PASS or FAIL | exact note |

## Manual SSH Checks

| Check | Result | Notes |
|---|---|---|
| Add SSH host | PASS or FAIL | exact note |
| Open SSH terminal | PASS or FAIL | exact note |
| Press Enter after command | PASS or FAIL | exact note |
| Ctrl+C interrupts command | PASS or FAIL | exact note |
| SFTP list directory | PASS or FAIL | exact note |
| Upload/download small file | PASS or FAIL | exact note |

## Decision

Proceed only if SSH terminal and SFTP basics pass. If they fail because of Electerm upstream behavior, evaluate Tabby before custom Agent work.
```

- [ ] **Step 5: Commit runtime validation**

Run:

```powershell
git add docs/evaluations/electerm-agent-runtime.md
git commit -m "test: validate Electerm base runtime"
```

Expected: commit succeeds.

---

### Task 4: Add AI Assistant Panel Without Touching SSH Internals

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai-assistant/index.jsx`
- Create: `apps/electerm-agent/src/client/components/ai-assistant/assistant.styl`
- Create: `apps/electerm-agent/src/client/store/agent-context.js`
- Modify: `apps/electerm-agent/src/client/store/mcp-handler.js`
- Modify: the Electerm main layout component identified during runtime validation.

- [ ] **Step 1: Add terminal context reader**

Create `apps/electerm-agent/src/client/store/agent-context.js` with:

```javascript
export function redactAgentText (text = '') {
  return String(text)
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/(?<=password=)[^\s&]+/ig, '[REDACTED_PASSWORD]')
}

export function buildAgentTerminalContext ({ tabId, refsTabs, lines = 120 }) {
  const tabRef = refsTabs.get('tab-' + tabId)
  const output = tabRef?.state?.terminalOnData || ''
  const safeLines = redactAgentText(output).split(/\r?\n/).slice(-lines)
  return {
    tabId,
    output: safeLines.join('\n')
  }
}
```

- [ ] **Step 2: Add AI assistant panel component**

Create `apps/electerm-agent/src/client/components/ai-assistant/index.jsx` with:

```jsx
import React, { useState } from 'react'
import './assistant.styl'

export default function AiAssistant ({ activeTabId, onAsk }) {
  const [text, setText] = useState('')

  async function submit () {
    const value = text.trim()
    if (!value) return
    setText('')
    await onAsk({ question: value, tabId: activeTabId })
  }

  return (
    <div className='ai-assistant-panel'>
      <div className='ai-assistant-head'>
        <b>AI 助手</b>
        <span>关联当前 SSH</span>
      </div>
      <div className='ai-assistant-body' data-testid='ai-assistant-messages' />
      <div className='ai-assistant-input'>
        <textarea
          value={text}
          placeholder='输入问题，让 AI 结合当前 SSH 输出排查...'
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button onClick={submit}>发送</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add panel styles**

Create `apps/electerm-agent/src/client/components/ai-assistant/assistant.styl` with:

```stylus
.ai-assistant-panel
  width 360px
  min-width 300px
  max-width 520px
  border-left 1px solid var(--border-color, #e5e7eb)
  display flex
  flex-direction column
  background var(--background-color, #fff)

.ai-assistant-head
  height 48px
  display flex
  align-items center
  justify-content space-between
  padding 0 14px
  border-bottom 1px solid var(--border-color, #e5e7eb)

.ai-assistant-body
  flex 1
  overflow auto
  padding 12px

.ai-assistant-input
  border-top 1px solid var(--border-color, #e5e7eb)
  padding 10px
  display grid
  gap 8px

.ai-assistant-input textarea
  min-height 72px
  resize vertical

.ai-assistant-input button
  justify-self end
```

- [ ] **Step 4: Wire the panel into the main layout**

In the layout component that owns terminal tabs, import:

```javascript
import AiAssistant from './components/ai-assistant'
import { buildAgentTerminalContext } from './store/agent-context'
```

Add:

```javascript
async function handleAgentAsk ({ question, tabId }) {
  const context = buildAgentTerminalContext({ tabId, refsTabs: window.refsTabs })
  window.pre.runGlobalAsync('agentAsk', { question, context })
}
```

Render `AiAssistant` on the right side of the terminal workspace:

```jsx
<AiAssistant activeTabId={activeTabId} onAsk={handleAgentAsk} />
```

- [ ] **Step 5: Run UI build**

Run:

```powershell
Set-Location apps/electerm-agent
npm run build
```

Expected: build passes.

- [ ] **Step 6: Commit AI panel skeleton**

Run:

```powershell
git add apps/electerm-agent/src/client/components/ai-assistant apps/electerm-agent/src/client/store/agent-context.js
git commit -m "feat: add SSH-aware AI assistant panel"
```

Expected: commit succeeds.

---

### Task 5: Add Model API Provider Settings

**Files:**
- Create: `apps/electerm-agent/src/app/agent/model-providers.js`
- Create: `apps/electerm-agent/src/client/components/ai-assistant/model-settings.jsx`

- [ ] **Step 1: Add OpenAI-compatible provider module**

Create `apps/electerm-agent/src/app/agent/model-providers.js` with:

```javascript
const DEFAULT_TIMEOUT = 30000

export async function listModels ({ baseUrl, apiKey, headers = {} }) {
  const url = new URL('/v1/models', baseUrl).toString()
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...headers
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
  })
  if (!res.ok) {
    throw new Error(`模型列表获取失败：HTTP ${res.status}`)
  }
  const data = await res.json()
  return Array.isArray(data.data) ? data.data.map(item => item.id).filter(Boolean) : []
}

export async function chatCompletion ({ baseUrl, apiKey, model, messages, headers = {} }) {
  const url = new URL('/v1/chat/completions', baseUrl).toString()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify({ model, messages }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
  })
  if (!res.ok) {
    throw new Error(`模型调用失败：HTTP ${res.status}`)
  }
  return res.json()
}
```

- [ ] **Step 2: Add settings UI**

Create `apps/electerm-agent/src/client/components/ai-assistant/model-settings.jsx` with:

```jsx
import React, { useState } from 'react'

export default function ModelSettings ({ value, onSave, onFetchModels }) {
  const [draft, setDraft] = useState(value || { baseUrl: '', apiKey: '', model: '' })
  const [models, setModels] = useState([])

  async function fetchModels () {
    const next = await onFetchModels(draft)
    setModels(next)
  }

  return (
    <div className='model-settings'>
      <input value={draft.baseUrl} placeholder='Base URL' onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} />
      <input value={draft.apiKey} placeholder='API Key' type='password' onChange={e => setDraft({ ...draft, apiKey: e.target.value })} />
      <input value={draft.model} placeholder='模型名称' onChange={e => setDraft({ ...draft, model: e.target.value })} />
      <button onClick={fetchModels}>获取模型列表</button>
      <button onClick={() => onSave(draft)}>保存</button>
      <select value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })}>
        <option value=''>选择模型</option>
        {models.map(model => <option key={model} value={model}>{model}</option>)}
      </select>
    </div>
  )
}
```

- [ ] **Step 3: Store API keys in Electerm's existing secure/config storage**

Use Electerm's existing config/db storage functions identified during runtime validation. Store only encrypted or local-only secrets. Do not send API keys into renderer logs or terminal context.

- [ ] **Step 4: Commit model settings**

Run:

```powershell
git add apps/electerm-agent/src/app/agent/model-providers.js apps/electerm-agent/src/client/components/ai-assistant/model-settings.jsx
git commit -m "feat: add OpenAI-compatible model settings"
```

Expected: commit succeeds.

---

### Task 6: Add Server Backup, Online Update, And Release Channel

**Files:**
- Create: `apps/electerm-agent/src/app/agent/backup.js`
- Create: `apps/electerm-agent/build/agent-release.js`
- Modify: `apps/electerm-agent/package.json`

- [ ] **Step 1: Add backup export module**

Create `apps/electerm-agent/src/app/agent/backup.js` with:

```javascript
export function redactBookmarkForBackup (bookmark) {
  return {
    ...bookmark,
    password: bookmark.password ? '[REDACTED]' : '',
    privateKey: bookmark.privateKey ? '[REDACTED]' : '',
    passphrase: bookmark.passphrase ? '[REDACTED]' : '',
    authType: bookmark.authType || ''
  }
}

export function buildServerBackup ({ bookmarks = [], modelProfiles = [], agentSettings = {} }) {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    servers: bookmarks.map(redactBookmarkForBackup),
    modelProfiles: modelProfiles.map(profile => ({ ...profile, apiKey: profile.apiKey ? '[REDACTED]' : '' })),
    agentSettings
  }
}
```

- [ ] **Step 2: Add release manifest generator**

Create `apps/electerm-agent/build/agent-release.js` with:

```javascript
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'

const [,, version, packagePath, updateCheckUrl, releaseNotesUrl] = process.argv

if (!version || !packagePath || !updateCheckUrl) {
  console.error('Usage: node build/agent-release.js <version> <packagePath> <updateCheckUrl> [releaseNotesUrl]')
  process.exit(1)
}

const data = readFileSync(packagePath)
const sha256 = createHash('sha256').update(data).digest('hex').toUpperCase()
const file = basename(packagePath)

writeFileSync('latest.json', JSON.stringify({
  appName: 'SSH Agent 工具',
  version,
  updateChannel: 'stable',
  updateCheckUrl,
  currentPackageUrl: updateCheckUrl.replace(/latest\.json$/, file),
  releaseNotesUrl: releaseNotesUrl || '',
  packageFile: file,
  packageSha256: sha256,
  packageSizeBytes: statSync(packagePath).size
}, null, 2))
```

- [ ] **Step 3: Add package script**

Modify `apps/electerm-agent/package.json` scripts:

```json
"agent:release-manifest": "node build/agent-release.js"
```

- [ ] **Step 4: Commit backup and update channel**

Run:

```powershell
git add apps/electerm-agent/src/app/agent/backup.js apps/electerm-agent/build/agent-release.js apps/electerm-agent/package.json
git commit -m "feat: add server backup and update manifest support"
```

Expected: commit succeeds.

---

## Verification Checklist

- [ ] `docs/evaluations/open-source-base/decision.md` clearly says Electerm supersedes the earlier direction.
- [ ] `apps/electerm-agent` is imported from Electerm and has no `node_modules` committed.
- [ ] Electerm starts on Windows before Agent features are merged.
- [ ] Basic SSH workflow passes: add host, connect, run command, Enter works, Ctrl+C works.
- [ ] Basic SFTP workflow passes: list, upload, download.
- [ ] AI assistant reads terminal context without secrets.
- [ ] Model API settings support Base URL, API Key, model list fetch, and OpenAI-compatible chat.
- [ ] Backup export does not leak passwords or private keys.
- [ ] Online update manifest can be published through GitHub Releases.
