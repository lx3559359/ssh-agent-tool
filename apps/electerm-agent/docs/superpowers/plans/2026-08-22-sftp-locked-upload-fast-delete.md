# SFTP Locked Upload and Fast Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SFTP uploads continue past Windows-locked local files with one accurate batch summary, and add an explicit permanent fast-delete path that bypasses recovery snapshots.

**Architecture:** Add a main-process local source planner that separates a verified descriptor tree from skippable unreadable entries. Bind that immutable plan to the renderer transfer and use the descriptor tree as the local directory upload allowlist. Add a separate pure fast-delete executor and wire it to a new context-menu action; the existing safety transaction path remains unchanged.

**Tech Stack:** Electron, React class components, Node.js `fs`, SSH2/SFTP, Ant Design-compatible menus/modals, Node test runner, Playwright, StandardJS.

---

## File Structure

- Create `src/app/lib/local-transfer-source-plan.js`: scan/digest a local source, classify only approved unreadable errors as skipped, and support pinned skip verification.
- Modify `src/app/lib/fs.js`: delegate strict descriptors to the new planner and export the skip-aware plan API.
- Modify `src/app/lib/ipc-sync.js`: expose `prepareTransferEntry` to the renderer.
- Create `src/client/components/file-transfer/transfer-source-plan.js`: compare source plans and filter live local directory listings through the descriptor allowlist.
- Create `src/client/components/file-transfer/transfer-batch-results.js`: aggregate terminal results by `transferBatch` and produce one skip summary.
- Modify `src/client/store/transfer-list.js`: annotate every batch item with the expected batch size.
- Modify `src/client/components/file-transfer/transfer.jsx`: prepare/verify source plans, skip unreadable roots without remote writes, drive protected directory uploads from the descriptor tree, and record one batch result.
- Modify `src/client/components/file-transfer/folder-transfer-results.js`: represent planned skipped children in transfer history.
- Create `src/client/components/sftp/sftp-fast-delete.js`: validate protected paths, run bounded parallel permanent deletion, and retain per-item outcomes.
- Modify `src/client/components/sftp/sftp-file-context-menu.js`: add the explicit dangerous fast-delete item next to safe delete.
- Modify `src/client/components/sftp/file-item.jsx`: dispatch fast delete for the clicked or selected remote items.
- Modify `src/client/components/sftp/sftp-entry.jsx`: show one irreversible confirmation, invoke the fast executor, report partial results, and refresh once.
- Modify `src/client/common/shellpilot-i18n-overrides.js`: add Chinese and English labels/messages.
- Modify focused unit tests and `test/e2e/027.quality-core-flows.spec.js`: cover source skipping, allowlist enforcement, menu behavior, permanent deletion, and real Electron SFTP flows.

### Task 1: Build the skip-aware local source planner

**Files:**
- Create: `src/app/lib/local-transfer-source-plan.js`
- Modify: `src/app/lib/fs.js`
- Modify: `src/app/lib/ipc-sync.js`
- Test: `test/unit-ci/local-transfer-descriptor.spec.js`

- [ ] **Step 1: Write failing tests for locked roots, locked children, pinned skips, and hard failures**

Extend `test/unit-ci/local-transfer-descriptor.spec.js` with a deterministic injected file adapter. The stream factory throws a chosen Windows-style error without depending on the CI account profile:

```js
const nodeFs = require('node:fs')
const { Readable } = require('node:stream')

function injectedIo ({ failNames = new Map() } = {}) {
  return {
    lstat: fs.lstat,
    readdir: fs.readdir,
    createReadStream (filePath, options) {
      const code = failNames.get(path.basename(filePath))
      if (!code) return nodeFs.createReadStream(filePath, options)
      return Readable.from((async function * () {
        const error = new Error(`${code}: simulated unreadable file`)
        error.code = code
        throw error
      })())
    }
  }
}

test('local transfer plan skips approved unreadable children and keeps readable descriptors', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-skip-plan-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, 'normal.txt'), 'normal')
  await fs.writeFile(path.join(root, 'NTUSER.DAT'), 'locked')

  const plan = await fsExport.prepareTransferEntry(root, {
    io: injectedIo({ failNames: new Map([['NTUSER.DAT', 'EBUSY']]) })
  })

  assert.deepEqual(plan.descriptor.entries.map(item => item.name), ['normal.txt'])
  assert.deepEqual(plan.skipped.map(item => ({
    relativePath: item.relativePath,
    code: item.code,
    reason: item.reason
  })), [{ relativePath: 'NTUSER.DAT', code: 'EBUSY', reason: 'locked' }])
})

test('local transfer plan skips an unreadable root without producing a descriptor', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-skip-root-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const locked = path.join(root, 'ntuser.dat.LOG1')
  await fs.writeFile(locked, 'locked')

  const plan = await fsExport.prepareTransferEntry(locked, {
    io: injectedIo({ failNames: new Map([['ntuser.dat.LOG1', 'EBUSY']]) })
  })

  assert.equal(plan.descriptor, null)
  assert.equal(plan.skipped.length, 1)
  assert.equal(plan.skipped[0].relativePath, 'ntuser.dat.LOG1')
})

test('local transfer plan preserves pinned skips and rejects newly unreadable content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-pinned-skip-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, 'locked.dat'), 'locked')
  await fs.writeFile(path.join(root, 'normal.txt'), 'normal')
  const pinnedSkips = [{
    path: path.join(root, 'locked.dat'),
    relativePath: 'locked.dat',
    code: 'EBUSY',
    reason: 'locked'
  }]

  const stable = await fsExport.prepareTransferEntry(root, { pinnedSkips })
  assert.deepEqual(stable.skipped, pinnedSkips)

  await assert.rejects(
    fsExport.describeTransferEntry(root, {
      io: injectedIo({ failNames: new Map([['normal.txt', 'EIO']]) })
    }),
    error => error.code === 'EIO'
  )
})

test('skip-aware local source plan is exposed through the renderer fs allowlist', async () => {
  const ipcSource = await fs.readFile(path.resolve(
    __dirname,
    '../../src/app/lib/ipc-sync.js'
  ), 'utf8')
  assert.match(ipcSource, /'prepareTransferEntry'/)
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
node --test test/unit-ci/local-transfer-descriptor.spec.js
```

Expected: FAIL because `fsExport.prepareTransferEntry` does not exist and the allowlist lacks `prepareTransferEntry`.

- [ ] **Step 3: Extract the descriptor scanner and implement approved skipping**

Create `src/app/lib/local-transfer-source-plan.js`. Move the existing bounded digest and limit logic from `src/app/lib/fs.js` into this module without changing its digest algorithm. Add these planner rules:

```js
const nodeFs = require('fs')
const fsp = require('fs/promises')
const path = require('path')

const SKIPPABLE_SOURCE_CODES = new Set(['EBUSY', 'EACCES', 'EPERM'])

function skippedReason (code) {
  return code === 'EBUSY' ? 'locked' : 'unreadable'
}

function isSkippableTransferSourceError (error) {
  return SKIPPABLE_SOURCE_CODES.has(String(error?.code || '').toUpperCase())
}

function displayRelativePath (rootPath, filePath) {
  if (path.resolve(rootPath) === path.resolve(filePath)) {
    return path.basename(rootPath)
  }
  return path.relative(rootPath, filePath).split(path.sep).join('/')
}

function skipRecord (rootPath, filePath, error) {
  const code = String(error?.code || '').toUpperCase()
  return {
    path: filePath,
    relativePath: displayRelativePath(rootPath, filePath),
    code,
    reason: skippedReason(code)
  }
}

function pinnedSkipMap (records = []) {
  return new Map(records.map(record => [
    String(record.relativePath || '').replace(/\\/g, '/'),
    { ...record }
  ]))
}
```

The recursive scanner must receive `{ rootPath, allowSkips, pinned, skipped, io, budget }`. Before reading a child, consume an exact pinned relative path into `skipped` and return `null`. Wrap `lstat`, `readdir`, and stream iteration separately; only `isSkippableTransferSourceError(error) && allowSkips` returns a skip record. Every other error is rethrown. Directory `entries` only receives children whose descriptor is not `null`.

Export strict compatibility and skip-aware APIs:

```js
async function describeTransferEntry (filePath, options = {}) {
  const plan = await buildTransferEntryPlan(filePath, {
    ...options,
    allowSkips: false
  })
  return plan.descriptor
}

async function prepareTransferEntry (filePath, options = {}) {
  return buildTransferEntryPlan(filePath, {
    ...options,
    allowSkips: true
  })
}

module.exports = {
  describeTransferEntry,
  isSkippableTransferSourceError,
  prepareTransferEntry
}
```

In `src/app/lib/fs.js`, remove the moved digest implementation, import both functions, and export both through `fsExport`. In `src/app/lib/ipc-sync.js`, add `'prepareTransferEntry'` immediately after `'describeTransferEntry'`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
node --test test/unit-ci/local-transfer-descriptor.spec.js
```

Expected: all descriptor tests PASS; strict `describeTransferEntry` still rejects unreadable input while `prepareTransferEntry` returns planned skips.

- [ ] **Step 5: Commit the planner**

```powershell
git add src/app/lib/local-transfer-source-plan.js src/app/lib/fs.js src/app/lib/ipc-sync.js test/unit-ci/local-transfer-descriptor.spec.js
git commit -m "fix(sftp): plan uploads around locked local files"
```

### Task 2: Add pure renderer plan and batch-result helpers

**Files:**
- Create: `src/client/components/file-transfer/transfer-source-plan.js`
- Create: `src/client/components/file-transfer/transfer-batch-results.js`
- Modify: `src/client/store/transfer-list.js`
- Test: `test/unit-ci/sftp-upload-skip-plan.spec.js`

- [ ] **Step 1: Write failing tests for descriptor allowlists and one batch summary**

Create `test/unit-ci/sftp-upload-skip-plan.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const sourcePlanUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/file-transfer/transfer-source-plan.js'
)).href
const batchUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/file-transfer/transfer-batch-results.js'
)).href

test('local upload listing is restricted to the verified descriptor tree', async () => {
  const { filterPlannedDirectoryEntries } = await import(sourcePlanUrl)
  const descriptor = {
    type: 'directory',
    entries: [{ name: 'allowed.txt', entry: { type: 'file', size: 7 } }]
  }
  const result = filterPlannedDirectoryEntries([
    { name: 'allowed.txt', size: 7 },
    { name: 'unlocked-later.dat', size: 9 }
  ], descriptor)

  assert.deepEqual(result, [{
    name: 'allowed.txt',
    size: 7,
    sourceDescriptor: { type: 'file', size: 7 }
  }])
})

test('source plan verification binds both descriptors and pinned skips', async () => {
  const { assertSameLocalTransferPlan } = await import(sourcePlanUrl)
  const expected = {
    descriptor: { type: 'file', size: 3, digest: 'abc' },
    skipped: [{ relativePath: 'locked.dat', code: 'EBUSY', reason: 'locked' }]
  }
  assert.equal(assertSameLocalTransferPlan(expected, structuredClone(expected)), true)
  assert.throws(
    () => assertSameLocalTransferPlan(expected, { ...expected, skipped: [] }),
    /发生变化/
  )
})

test('batch collector emits one terminal summary after every item settles', async () => {
  const { createTransferBatchResultCollector } = await import(batchUrl)
  const collector = createTransferBatchResultCollector()
  assert.equal(collector.record({
    batchId: 'b1',
    transferId: 't1',
    expected: 2,
    status: 'success'
  }), null)
  const summary = collector.record({
    batchId: 'b1',
    transferId: 't2',
    expected: 2,
    status: 'skipped',
    skipped: [{ relativePath: 'NTUSER.DAT', code: 'EBUSY' }]
  })
  assert.equal(summary.completed, 1)
  assert.equal(summary.skippedCount, 1)
  assert.deepEqual(summary.skipped.map(item => item.relativePath), ['NTUSER.DAT'])
  assert.equal(collector.size, 0)
})
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```powershell
node --test test/unit-ci/sftp-upload-skip-plan.spec.js
```

Expected: FAIL because both helper modules are missing.

- [ ] **Step 3: Implement descriptor filtering and exact plan comparison**

Create `src/client/components/file-transfer/transfer-source-plan.js`:

```js
function stableValue (value) {
  return JSON.stringify(value ?? null)
}

export function assertSameLocalTransferPlan (expected, actual) {
  if (stableValue(expected) !== stableValue(actual)) {
    throw new Error('本地上传源在传输期间发生变化，远程目标可执行回滚。')
  }
  return true
}

export function filterPlannedDirectoryEntries (liveEntries = [], descriptor) {
  if (descriptor?.type !== 'directory' || !Array.isArray(descriptor.entries)) {
    throw new Error('本地上传目录缺少已验证的描述树。')
  }
  const allowed = new Map(descriptor.entries.map(item => [item.name, item.entry]))
  return liveEntries
    .filter(item => allowed.has(item.name))
    .map(item => ({
      ...item,
      sourceDescriptor: allowed.get(item.name)
    }))
}
```

- [ ] **Step 4: Implement batch aggregation and batch-size annotation**

Create `src/client/components/file-transfer/transfer-batch-results.js` with a `Map` scoped inside `createTransferBatchResultCollector`. `record()` must deduplicate by `transferId`, count `success`, `skipped`, and `exception`, flatten at most 1000 skipped entries, return `null` until `results.size === expected`, then delete the batch and return the summary. Export one shared collector for production plus the factory for tests.

Modify `src/client/store/transfer-list.js` so every item receives both identifiers:

```js
const transferBatchSize = items.length
const nextItems = items.map(t => {
  t.transferBatch = transferBatch
  t.transferBatchSize = transferBatchSize
  return t
})
```

- [ ] **Step 5: Run helper and store tests and verify GREEN**

Run:

```powershell
node --test test/unit-ci/sftp-upload-skip-plan.spec.js test/unit-ci/transfer-task-integration.spec.js
```

Expected: PASS with no leaked batch state after the terminal summary.

- [ ] **Step 6: Commit the renderer helpers**

```powershell
git add src/client/components/file-transfer/transfer-source-plan.js src/client/components/file-transfer/transfer-batch-results.js src/client/store/transfer-list.js test/unit-ci/sftp-upload-skip-plan.spec.js
git commit -m "feat(sftp): aggregate skipped upload results"
```

### Task 3: Integrate source plans into the protected upload pipeline

**Files:**
- Modify: `src/client/components/file-transfer/file-transfer-safety.js`
- Modify: `src/client/components/file-transfer/folder-transfer-results.js`
- Modify: `src/client/components/file-transfer/transfer.jsx`
- Test: `test/unit-ci/sftp-transfer-safety.spec.js`
- Test: `test/unit-ci/sftp-folder-transfer-results.spec.js`
- Test: `test/unit-ci/sftp-upload-skip-plan.spec.js`

- [ ] **Step 1: Write failing integration-contract tests**

Add assertions that require the transfer component to call the skip-aware API before safety preparation, bypass remote work for a `null` descriptor, use the descriptor allowlist for protected local directories, and verify with pinned skips:

```js
test('protected uploads bind a skip-aware source plan before remote safety work', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')
  const start = source.slice(
    source.indexOf('startTransfer = async'),
    source.indexOf('assertCurrentAttempt =', source.indexOf('startTransfer = async'))
  )

  assert.match(source, /window\.fs\.prepareTransferEntry/)
  assert.match(source, /pinnedSkips:\s*this\.localSourcePlan\.skipped/)
  assert.match(start, /if \(!this\.localSourcePlan\?\.descriptor\)/)
  assert.match(start, /status:\s*'skipped'/)
  assert.ok(
    start.indexOf("status: 'skipped'") < start.indexOf('this.transferSafety.begin()')
  )
  assert.match(source, /filterPlannedDirectoryEntries/)
  assert.match(source, /transfer\.sourceDescriptor/)
})
```

Extend `sftp-folder-transfer-results.spec.js`:

```js
test('folder results retain planned skipped entries without treating them as failures', async () => {
  const { createSkippedFolderResults } = await import(moduleUrl)
  assert.deepEqual(createSkippedFolderResults([
    { relativePath: 'locked.dat', code: 'EBUSY', reason: 'locked' }
  ]), [{
    name: 'locked.dat',
    size: 0,
    status: 'skipped',
    error: 'EBUSY'
  }])
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-safety.spec.js test/unit-ci/sftp-folder-transfer-results.spec.js test/unit-ci/sftp-upload-skip-plan.spec.js
```

Expected: FAIL because the transfer component still calls `describeTransferEntry` and has no skipped terminal path or descriptor filtering.

- [ ] **Step 3: Add source-plan capture and verification helpers**

In `file-transfer-safety.js`, preserve existing strict `captureLocalTransferSource` for MCP compatibility and add UI helpers:

```js
export async function captureLocalTransferPlan ({ transfer = {}, prepareLocal } = {}) {
  if (!needsLocalSourceDescriptor(transfer)) return null
  if (typeof prepareLocal !== 'function') {
    throw new Error('受保护上传缺少本地源计划能力，已停止远程写入。')
  }
  return prepareLocal(transfer.fromPath)
}

export async function verifyLocalTransferPlan ({
  transfer = {},
  sourcePlan,
  prepareLocal,
  assertSame
} = {}) {
  if (!sourcePlan || !needsLocalSourceDescriptor(transfer)) return true
  const current = await prepareLocal(transfer.fromPath, {
    pinnedSkips: sourcePlan.skipped || []
  })
  return assertSame(sourcePlan, current)
}
```

Keep `buildTransferSafetyPlan` unchanged except that `transfer.sourceDescriptor` is now populated from `sourcePlan.descriptor` before `begin()`.

- [ ] **Step 4: Drive protected directory uploads from the descriptor tree**

In `transfer.jsx`:

- store `this.localSourcePlan` from `props.transfer.sourcePlan`;
- make `prepareLocalSource()` call `captureLocalTransferPlan` with `window.fs.prepareTransferEntry`;
- assign `transfer.sourcePlan` and `transfer.sourceDescriptor` after capture;
- make `verifyLocalSource()` call `verifyLocalTransferPlan` with the original pinned skips;
- initialize `folderItemResults` with `createSkippedFolderResults(plan.skipped)`;
- before `transferSafety.begin()`, finish a `descriptor === null` root as `{ status: 'skipped', skipped: plan.skipped }`;
- for local-to-remote protected directories, call `transferFolderRecursive` instead of the raw SSH2 folder transfer;
- in `transferFolderRecursive`, filter the live local list with `filterPlannedDirectoryEntries(list, transfer.sourceDescriptor)`;
- carry each child's `sourceDescriptor` into file and directory sub-transfers.

The skipped root path must call `onEnd` without calling `window.store.onError`. In `onEnd`, skip source re-verification only for the root-skipped terminal state, preserve `status: 'skipped'` in history, and record the terminal result with the shared batch collector. When the collector returns a summary with skipped items, emit exactly one localized warning.

- [ ] **Step 5: Verify the source-plan pipeline is GREEN**

Run:

```powershell
node --test test/unit-ci/local-transfer-descriptor.spec.js test/unit-ci/sftp-upload-skip-plan.spec.js test/unit-ci/sftp-transfer-safety.spec.js test/unit-ci/sftp-folder-transfer-results.spec.js test/unit-ci/transfer-progress.spec.js test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: PASS; existing strict transfer safety tests remain green and skipped roots produce no remote operation contract.

- [ ] **Step 6: Commit the upload integration**

```powershell
git add src/client/components/file-transfer/file-transfer-safety.js src/client/components/file-transfer/folder-transfer-results.js src/client/components/file-transfer/transfer.jsx test/unit-ci/sftp-transfer-safety.spec.js test/unit-ci/sftp-folder-transfer-results.spec.js test/unit-ci/sftp-upload-skip-plan.spec.js
git commit -m "fix(sftp): skip locked files without weakening upload checks"
```

### Task 4: Implement the permanent fast-delete executor

**Files:**
- Create: `src/client/components/sftp/sftp-fast-delete.js`
- Create: `test/unit-ci/sftp-fast-delete.spec.js`

- [ ] **Step 1: Write failing tests for validation, concurrency, and partial failure**

Create `test/unit-ci/sftp-fast-delete.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/sftp/sftp-fast-delete.js'
)).href

function remoteFile (name, extra = {}) {
  return { type: 'remote', path: '/srv/app', name, isDirectory: false, ...extra }
}

test('fast delete rejects protected or ambiguous targets before remote work', async () => {
  const { executeFastRemoteDelete } = await import(moduleUrl)
  let calls = 0
  const sftp = {
    rm: async () => { calls += 1 },
    rmdir: async () => { calls += 1 }
  }
  for (const file of [
    remoteFile('..'),
    remoteFile('.shellpilot-transactions', { isDirectory: true }),
    { type: 'remote', path: '/', name: '', isDirectory: true, isEmpty: true },
    { type: 'local', path: 'C:\\temp', name: 'local.txt' }
  ]) {
    await assert.rejects(executeFastRemoteDelete({ sftp, files: [file] }), /拒绝|不可|远程|事务/)
  }
  assert.equal(calls, 0)
})

test('fast delete limits concurrency and keeps partial results', async () => {
  const { executeFastRemoteDelete } = await import(moduleUrl)
  let active = 0
  let peak = 0
  const sftp = {
    async rm (target) {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      if (target.endsWith('/bad.txt')) throw new Error('permission denied')
    },
    async rmdir () {}
  }
  const result = await executeFastRemoteDelete({
    sftp,
    files: Array.from({ length: 9 }, (_, index) => remoteFile(
      index === 8 ? 'bad.txt' : `ok-${index}.txt`
    )),
    concurrency: 4
  })

  assert.equal(peak, 4)
  assert.equal(result.completed.length, 8)
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].file.name, 'bad.txt')
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
node --test test/unit-ci/sftp-fast-delete.spec.js
```

Expected: FAIL because `sftp-fast-delete.js` does not exist.

- [ ] **Step 3: Implement target validation and bounded execution**

Create `sftp-fast-delete.js` with these public functions:

```js
import resolve from '../../common/resolve'

const transactionSegment = '.shellpilot-transactions'

export function buildFastDeleteTarget (file = {}) {
  if (file.type !== 'remote' || file.isParent || file.isEmpty) {
    throw new Error('快速删除只支持真实远程文件或目录。')
  }
  const name = String(file.name || '').trim()
  if (!name || name === '.' || name === '..') {
    throw new Error('快速删除拒绝父目录或空目标。')
  }
  const raw = String(resolve(String(file.path || ''), name)).replace(/\\/g, '/')
  if (!raw.startsWith('/') || raw === '/' || raw.split('/').includes('..')) {
    throw new Error('快速删除要求安全的绝对远程路径。')
  }
  const segments = raw.split('/').filter(Boolean)
  if (segments.some(segment => segment.toLowerCase() === transactionSegment)) {
    throw new Error('快速删除不能操作 ShellPilot 事务存储。')
  }
  return { file, path: raw, isDirectory: file.isDirectory === true }
}

export function buildFastDeleteTargets (files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('快速删除没有可执行的远程目标。')
  }
  return files.map(buildFastDeleteTarget)
}
```

Implement an index-based worker pool. `executeFastRemoteDelete({ sftp, files, concurrency })` must call `buildFastDeleteTargets(files)` before starting any worker. Each worker calls `sftp.rmdir(path)` for directories and `sftp.rm(path)` for files. Return `{ completed, failed, total }`, where failed entries retain `{ file, path, error }`. Clamp concurrency to `1..4` so callers cannot exceed the agreed limit.

- [ ] **Step 4: Run the executor tests and verify GREEN**

Run:

```powershell
node --test test/unit-ci/sftp-fast-delete.spec.js test/unit-ci/session-sftp.spec.js
```

Expected: PASS; peak concurrency is four and protected paths produce zero remote calls.

- [ ] **Step 5: Commit the executor**

```powershell
git add src/client/components/sftp/sftp-fast-delete.js test/unit-ci/sftp-fast-delete.spec.js
git commit -m "feat(sftp): add bounded permanent delete executor"
```

### Task 5: Wire fast delete into the SFTP UI and localization

**Files:**
- Modify: `src/client/components/sftp/sftp-file-context-menu.js`
- Modify: `src/client/components/sftp/file-item.jsx`
- Modify: `src/client/components/sftp/sftp-entry.jsx`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `test/unit-ci/sftp-context-menu.spec.js`
- Modify: `test/unit-ci/sftp-file-context-i18n.spec.js`
- Modify: `test/unit-ci/sftp-safety-transaction.spec.js`

- [ ] **Step 1: Write failing menu and dispatch tests**

Extend `sftp-context-menu.spec.js`:

```js
test('remote context menu keeps recoverable delete and adds explicit permanent fast delete', async () => {
  const { buildSftpFileContextItems } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-file-context-menu.js'
  )).href)
  const items = buildSftpFileContextItems({
    file: { id: 'remote-1', type: 'remote', path: '/srv', name: 'cache', isDirectory: true },
    selectedFiles: new Set(['remote-1']),
    tab: { host: 'server.example' },
    translate: key => key
  })
  const safeIndex = items.findIndex(item => item.func === 'del')
  const fastIndex = items.findIndex(item => item.func === 'quickDelete')

  assert.ok(safeIndex > -1)
  assert.equal(fastIndex, safeIndex + 1)
  assert.equal(items[fastIndex].requireConfirm, true)
  assert.equal(items[fastIndex].text, 'shellpilotSftpFastDeletePermanent')
})
```

Extend the SFTP safety source contract to require `quickDeleteRemoteFiles`, exactly one confirmation before `executeFastRemoteDelete`, no call to `prepareSftpSafetyOperation` inside that method, no fixed `wait(500)`, and exactly one `remoteList()` after execution.

- [ ] **Step 2: Run UI contract tests and verify RED**

Run:

```powershell
node --test test/unit-ci/sftp-context-menu.spec.js test/unit-ci/sftp-file-context-i18n.spec.js test/unit-ci/sftp-safety-transaction.spec.js
```

Expected: FAIL because the menu, dispatch method, execution method, and translations are missing.

- [ ] **Step 3: Add menu and file-item dispatch**

In `sftp-file-context-menu.js`, immediately after the existing `del` item add a remote-only item:

```js
if (isRemote && isRealFile) {
  result.push({
    func: 'quickDelete',
    icon: 'DeleteOutlined',
    text: format(
      translate,
      selected ? 'shellpilotSftpFastDeleteSelected' : 'shellpilotSftpFastDeletePermanent',
      { count: selectedCount }
    ),
    requireConfirm: true
  })
}
```

In `file-item.jsx`, add:

```js
quickDelete = async () => {
  await this.props.quickDeleteRemoteFiles(this.getSftpSafetyTargets())
}
```

Pass `quickDeleteRemoteFiles` through the existing `pick(this, [...])` prop list in `sftp-entry.jsx`.

- [ ] **Step 4: Add confirmation, execution, one refresh, and messages**

Import `buildFastDeleteTargets` and `executeFastRemoteDelete` into `sftp-entry.jsx`. Add `confirmQuickDelete(files)` using `Modal.confirm` and localized irreversible wording. Implement:

```js
quickDeleteRemoteFiles = async (files = this.getSelectedFiles()) => {
  const targets = this.getRemoteSafetyTargets(files)
  if (!targets.length) return false

  try {
    buildFastDeleteTargets(targets)
  } catch (error) {
    window.store.onError(error)
    return false
  }

  const confirmed = await this.confirmQuickDelete(targets)
  if (!confirmed) return false

  this.onDelete = true
  let result
  try {
    result = await executeFastRemoteDelete({
      sftp: this.sftp,
      files: targets,
      concurrency: 4
    })
  } catch (error) {
    window.store.onError(error)
  } finally {
    this.onDelete = false
  }

  this.setState({ selectedFiles: new Set(), selectedType: '' })
  await this.remoteList()
  if (!result) return false
  if (result.failed.length === 0) {
    message.success(formatShellPilotTranslation(e, 'shellpilotSftpFastDeleteSucceeded', {
      count: result.completed.length
    }))
    return true
  }
  message.error(formatShellPilotTranslation(e, 'shellpilotSftpFastDeletePartial', {
    completed: result.completed.length,
    failed: result.failed.length
  }))
  return false
}
```

Call `buildFastDeleteTargets` before opening the confirmation modal so protected or ambiguous paths are rejected before the user confirms. `executeFastRemoteDelete` validates the same files again defensively before starting workers. A pre-confirmation validation error is routed once through `window.store.onError` and does not refresh; every confirmed execution attempt refreshes exactly once after the workers settle or an unexpected executor error is reported.

- [ ] **Step 5: Add Chinese and English translations**

Add paired keys near the existing safe-delete translations:

```js
shellpilotSftpFastDeleteSelected: '快速删除所选（{count}，不可恢复）',
shellpilotSftpFastDeletePermanent: '快速删除（不可恢复）',
shellpilotSftpFastDeleteConfirmTitle: '确认永久删除所选内容？',
shellpilotSftpFastDeleteConfirmBody: '此操作不会创建恢复快照，删除后无法从安全操作中心恢复。共 {count} 项。',
shellpilotSftpFastDeleteSucceeded: '已快速删除 {count} 项。',
shellpilotSftpFastDeletePartial: '快速删除部分完成：成功 {completed} 项，失败 {failed} 项。'
```

```js
shellpilotSftpFastDeleteSelected: 'Fast Delete Selected ({count}, Permanent)',
shellpilotSftpFastDeletePermanent: 'Fast Delete (Permanent)',
shellpilotSftpFastDeleteConfirmTitle: 'Permanently delete the selected items?',
shellpilotSftpFastDeleteConfirmBody: 'No recovery snapshot will be created. These {count} items cannot be restored from Safety Center.',
shellpilotSftpFastDeleteSucceeded: 'Permanently deleted {count} items.',
shellpilotSftpFastDeletePartial: 'Fast delete partially completed: {completed} succeeded and {failed} failed.'
```

- [ ] **Step 6: Run UI tests and verify GREEN**

Run:

```powershell
node --test test/unit-ci/sftp-fast-delete.spec.js test/unit-ci/sftp-context-menu.spec.js test/unit-ci/sftp-file-context-i18n.spec.js test/unit-ci/sftp-safety-transaction.spec.js
```

Expected: PASS; safe delete remains recoverable and the new action is explicit, dangerous, and independent.

- [ ] **Step 7: Commit the UI integration**

```powershell
git add src/client/components/sftp/sftp-file-context-menu.js src/client/components/sftp/file-item.jsx src/client/components/sftp/sftp-entry.jsx src/client/common/shellpilot-i18n-overrides.js test/unit-ci/sftp-context-menu.spec.js test/unit-ci/sftp-file-context-i18n.spec.js test/unit-ci/sftp-safety-transaction.spec.js
git commit -m "feat(sftp): add confirmed permanent fast delete"
```

### Task 6: Add real Electron regression coverage and complete verification

**Files:**
- Modify: `test/e2e/027.quality-core-flows.spec.js`
- Modify: `test/e2e/common/local-sftp-fixture.js` only if the existing fixture lacks a directory/file creation helper required by the test.

- [ ] **Step 1: Add a supplemental Windows locked-file and fast-delete quality flow**

In the quality E2E test, create a temporary upload directory with `normal.txt` and `locked.dat`. On Windows, spawn a hidden PowerShell child that opens `locked.dat` with `FileShare.None`, waits on standard input, and releases the handle during cleanup:

```js
const lockScript = [
  '$stream = [System.IO.File]::Open($args[0], "Open", "ReadWrite", "None")',
  '[Console]::Out.WriteLine("READY")',
  '[Console]::Out.Flush()',
  '[Console]::In.ReadLine() | Out-Null',
  '$stream.Dispose()'
].join('; ')
```

Upload the directory through the actual SFTP UI and assert:

- the visible progress dock reaches a terminal state;
- remote `normal.txt` exists;
- remote `locked.dat` does not exist;
- exactly one warning contains one skipped item;
- no interface-error notification contains `EBUSY`.

Create a remote directory with several files, invoke the context-menu “快速删除（不可恢复）” action, confirm once, and assert the directory disappears. Then run one normal safe delete and assert its recovery record still appears in Safety Center.

- [ ] **Step 2: Run the E2E regression after the unit-driven implementation**

Run after a production compile:

```powershell
npm run compile
npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1
```

Expected: both flows PASS. The production behaviors have already been driven through RED/GREEN focused tests in Tasks 1–5; this Electron flow is supplemental integration coverage for real Windows locking and UI wiring.

- [ ] **Step 3: Run focused unit verification**

```powershell
node --test test/unit-ci/local-transfer-descriptor.spec.js test/unit-ci/sftp-upload-skip-plan.spec.js test/unit-ci/sftp-folder-transfer-results.spec.js test/unit-ci/sftp-transfer-safety.spec.js test/unit-ci/sftp-fast-delete.spec.js test/unit-ci/sftp-context-menu.spec.js test/unit-ci/sftp-file-context-i18n.spec.js test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/session-sftp.spec.js test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: all focused tests PASS with zero failures.

- [ ] **Step 4: Run lint, full unit tests, production compile, and Electron quality E2E**

```powershell
npm run lint
npm run test-unit-ci
npm run compile
npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1
```

Expected: StandardJS passes; full unit suite reports zero failures; compile completes; Electron quality flow passes.

- [ ] **Step 5: Check diff quality and commit E2E coverage**

```powershell
git diff --check
git status --short
git add test/e2e/027.quality-core-flows.spec.js test/e2e/common/local-sftp-fixture.js
git commit -m "test(sftp): cover locked uploads and fast delete"
```

Only add `test/e2e/common/local-sftp-fixture.js` if it changed. Expected final status: clean feature branch ahead of `origin/master`; no version bump, release upload, merge, or publication occurs without a separate user request.
