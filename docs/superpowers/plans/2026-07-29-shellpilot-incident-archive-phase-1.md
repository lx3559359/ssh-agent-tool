# ShellPilot 故障档案一期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不影响 SSH、SFTP、AI 和运维工具核心链路的前提下，交付可离线使用的故障档案基础能力，包括手动建档、检索分页、详情编辑、状态流转、文字记录、SQLite 迁移与恢复、空间管理和首页未解决摘要。

**Architecture:** 在 Electron 应用进程中新增独立的故障档案 SQLite 仓库，使用普通索引和 FTS5 完成 10,000 条规模下的筛选、搜索和分页；通过白名单 IPC 暴露纯 JSON 接口。渲染端沿用现有 `mainWorkspaceMode`、懒加载工作区和 Manate store 模式，档案模块仅在用户打开入口或无会话首页加载摘要时初始化，不阻断首个 SSH 终端。

**Tech Stack:** Electron 41、Node.js `node:sqlite`、React 19、Manate、Ant Design 6、Stylus、Node test runner、Playwright

---

## 执行目录

除非步骤明确说明，所有 `node`、`npm`、`npx` 和 `git` 命令都从工作树内的 `apps/electerm-agent` 目录执行。文件清单使用相对该目录的 `src/...`、`test/...` 路径，避免在主工作树和功能 worktree 之间误操作。

## 交付边界

本计划只实现设计规格中的“阶段 1：档案基础”：

- 独立“故障档案”入口、列表、详情和状态流转。
- 手动创建、标签、备注和结论字段。
- SQLite 索引、迁移前备份、损坏恢复、手动备份和空间统计。
- 首页未解决故障摘要。
- 10,000 条档案的搜索和分页。

以下能力不放入本计划，避免一期同时改动终端、AI、SFTP 和安全中心：

- 自动采集终端、AI、SFTP、服务器状态和安全事务证据。
- 完整统一时间线、内容脱敏和内容寻址附件。
- 故障报告、多格式导出和相似故障推荐。
- WebDAV、Git、S3 同步和跨设备冲突处理。

一期只预留稳定的 `incidentId`、`endpointRef`、`sessionRefs`、状态事件和存储策略字段，为后续阶段提供接口。

## 文件结构

### 应用进程

- Create: `apps/electerm-agent/src/app/lib/incidents/incident-model.js`
  - 唯一负责字段校验、默认值、状态机和敏感字段拒绝。
- Create: `apps/electerm-agent/src/app/lib/incidents/incident-migrations.js`
  - 唯一负责 SQLite schema 版本和迁移 SQL。
- Create: `apps/electerm-agent/src/app/lib/incidents/incident-database.js`
  - 唯一负责数据库打开、事务、迁移备份、完整性检查、恢复和空间统计。
- Create: `apps/electerm-agent/src/app/lib/incidents/incident-repository.js`
  - 唯一负责档案、备注、状态事件的 CRUD、FTS 索引、筛选和分页。
- Create: `apps/electerm-agent/src/app/lib/incidents/incident-service.js`
  - 唯一负责组合 repository 与 database，并为 IPC 提供稳定用例接口。
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
  - 注册故障档案白名单 IPC，统一返回可结构化克隆的 `{ ok, value }` 或 `{ ok, error }`。

### 渲染端

- Create: `apps/electerm-agent/src/client/components/incidents/incident-client.js`
  - IPC 客户端和错误解包。
- Create: `apps/electerm-agent/src/client/components/incidents/incident-navigation.js`
  - 工作区打开、关闭、焦点和可访问性行为。
- Create: `apps/electerm-agent/src/client/components/incidents/incident-list.jsx`
  - 搜索、筛选、分页和档案列表。
- Create: `apps/electerm-agent/src/client/components/incidents/incident-detail.jsx`
  - 基本信息、状态流转、备注和验证结果编辑。
- Create: `apps/electerm-agent/src/client/components/incidents/incident-storage-modal.jsx`
  - 空间统计、备份列表、创建备份和安全恢复。
- Create: `apps/electerm-agent/src/client/components/incidents/incident-workspace.jsx`
  - 组合列表、详情、创建表单和错误恢复。
- Create: `apps/electerm-agent/src/client/components/incidents/incident-home-summary.jsx`
  - 无连接首页的未解决摘要。
- Create: `apps/electerm-agent/src/client/components/incidents/entry.jsx`
  - 懒加载入口。
- Create: `apps/electerm-agent/src/client/components/incidents/incidents.styl`
  - 日间/夜间、1366 宽度和 Windows 125%/150% 缩放布局。
- Create: `apps/electerm-agent/src/client/store/incident-archives.js`
  - Manate 状态和业务动作。
- Modify: `apps/electerm-agent/src/client/store/init-state.js`
- Modify: `apps/electerm-agent/src/client/store/store.js`
- Modify: `apps/electerm-agent/src/client/components/main/main.jsx`
- Modify: `apps/electerm-agent/src/client/components/sidebar/index.jsx`
- Modify: `apps/electerm-agent/src/client/components/tabs/no-session.jsx`
- Modify: `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`

### 测试

- Create: `apps/electerm-agent/test/unit-ci/incident-model.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/incident-database.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/incident-repository.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/incident-ipc.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/incident-store.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/incident-navigation.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/incident-ui.spec.js`
- Create: `apps/electerm-agent/test/e2e/034.incident-archive-foundation.spec.js`

## 数据和接口约定

### 档案状态

```js
const INCIDENT_STATES = Object.freeze({
  investigating: 'investigating',
  waitingAction: 'waiting_action',
  verifying: 'verifying',
  resolved: 'resolved',
  unresolved: 'unresolved',
  archived: 'archived',
  falsePositive: 'false_positive'
})
```

允许的流转：

```text
investigating -> waiting_action | verifying | unresolved | false_positive
waiting_action -> investigating | verifying | unresolved
verifying -> investigating | resolved | unresolved | false_positive
resolved -> archived | investigating
unresolved -> archived | investigating
false_positive -> archived | investigating
archived -> investigating
```

`resolved` 必须携带 `verificationStatus = passed_manual | passed_auto`。临时缓解使用 `state = unresolved` 与 `verificationStatus = mitigated`，避免增加与设计状态图冲突的新状态。

### IPC 方法

```text
listIncidentArchives(filters)
getIncidentArchive(id)
createIncidentArchive(draft)
updateIncidentArchive(id, patch)
transitionIncidentArchive(id, transition)
addIncidentNote(id, body)
deleteIncidentNote(id, noteId)
getIncidentArchiveSummary()
getIncidentArchiveStorage()
createIncidentArchiveBackup()
restoreIncidentArchiveBackup(filename, confirmation)
```

所有响应只包含可 JSON 序列化数据。档案创建和更新使用字段白名单，拒绝 `password`、`privateKey`、`apiKey`、`token`、`cookie`、`authorization` 等字段；`endpointRef` 只保存现有服务器 ID，不复制认证信息。

### 分页

```js
{
  items: [],
  page: 1,
  pageSize: 40,
  total: 0,
  pageCount: 0
}
```

`pageSize` 限制为 `20 | 40 | 80`，默认按 `isPinned DESC, updatedAt DESC` 排序。

---

### Task 1: 建立档案模型、字段白名单和状态机

**Files:**
- Create: `apps/electerm-agent/src/app/lib/incidents/incident-model.js`
- Test: `apps/electerm-agent/test/unit-ci/incident-model.spec.js`

- [ ] **Step 1: 写状态流转和敏感字段失败测试**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  INCIDENT_STATES,
  createIncidentRecord,
  createIncidentPatch,
  validateTransition
} = require('../../src/app/lib/incidents/incident-model')

test('creates a bounded incident without copying credentials', () => {
  const record = createIncidentRecord({
    title: 'Nginx 502',
    endpointRef: 'bookmark-1',
    serviceTags: ['nginx', 'nginx'],
    customTags: ['production'],
    summary: 'Upstream unavailable'
  }, { id: 'incident-1', now: 1000 })

  assert.equal(record.id, 'incident-1')
  assert.equal(record.state, INCIDENT_STATES.investigating)
  assert.deepEqual(record.serviceTags, ['nginx'])
  assert.equal(record.storagePolicy, 'standard')
})

test('rejects sensitive and unknown mutation fields', () => {
  assert.throws(
    () => createIncidentRecord({
      title: 'Unsafe',
      password: 'secret'
    }, { id: 'incident-2', now: 1000 }),
    error => error.code === 'INCIDENT_SENSITIVE_FIELD'
  )
  assert.throws(
    () => createIncidentPatch({ archivedAt: 10 }),
    error => error.code === 'INCIDENT_FIELD_READONLY'
  )
  assert.throws(
    () => createIncidentRecord({
      title: 'Unknown field',
      arbitraryField: true
    }, { id: 'incident-3', now: 1000 }),
    error => error.code === 'INCIDENT_FIELD_READONLY'
  )
})

test('requires verification before resolved and records legal reopen', () => {
  assert.throws(
    () => validateTransition('verifying', {
      state: 'resolved',
      verificationStatus: 'pending'
    }),
    error => error.code === 'INCIDENT_VERIFICATION_REQUIRED'
  )
  assert.deepEqual(
    validateTransition('archived', {
      state: 'investigating',
      verificationStatus: 'pending'
    }),
    {
      state: 'investigating',
      verificationStatus: 'pending'
    }
  )
  assert.deepEqual(
    validateTransition(
      'resolved',
      { state: 'archived' },
      'passed_manual'
    ),
    {
      state: 'archived',
      verificationStatus: 'passed_manual'
    }
  )
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run from `apps/electerm-agent`:

```powershell
node --test test/unit-ci/incident-model.spec.js
```

Expected: FAIL with `Cannot find module '../../src/app/lib/incidents/incident-model'`.

- [ ] **Step 3: 实现模型、长度限制和状态机**

`incident-model.js` 必须导出以下接口：

```js
const INCIDENT_STATES = Object.freeze({
  investigating: 'investigating',
  waitingAction: 'waiting_action',
  verifying: 'verifying',
  resolved: 'resolved',
  unresolved: 'unresolved',
  archived: 'archived',
  falsePositive: 'false_positive'
})

const TRANSITIONS = Object.freeze({
  investigating: new Set(['waiting_action', 'verifying', 'unresolved', 'false_positive']),
  waiting_action: new Set(['investigating', 'verifying', 'unresolved']),
  verifying: new Set(['investigating', 'resolved', 'unresolved', 'false_positive']),
  resolved: new Set(['archived', 'investigating']),
  unresolved: new Set(['archived', 'investigating']),
  false_positive: new Set(['archived', 'investigating']),
  archived: new Set(['investigating'])
})

const EDITABLE_FIELDS = new Set([
  'title',
  'endpointRef',
  'sessionRefs',
  'severity',
  'serviceTags',
  'customTags',
  'summary',
  'rootCause',
  'resolution',
  'storagePolicy',
  'isPinned',
  'isFavorite'
])

const CREATE_FIELDS = new Set([
  ...EDITABLE_FIELDS
])

const SENSITIVE_KEYS = /password|passphrase|privatekey|apikey|token|cookie|authorization/i

function incidentError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function boundedText (value, field, max, required = false) {
  const text = String(value ?? '').trim()
  if (required && !text) {
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} is required.`)
  }
  if (text.length > max) {
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} exceeds ${max} characters.`)
  }
  return text
}

function assertSafeKeys (value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.test(key)) {
      throw incidentError('INCIDENT_SENSITIVE_FIELD', `Sensitive field is not allowed: ${path}${key}`)
    }
    assertSafeKeys(child, `${path}${key}.`)
  }
}

function uniqueTags (value, field) {
  if (!Array.isArray(value)) {
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} must be an array.`)
  }
  return [...new Set(value.map(item => boundedText(item, field, 64)).filter(Boolean))].slice(0, 30)
}

function boundedEnum (value, field, allowed, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} is required.`)
  }
  if (!allowed.includes(value)) {
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} is invalid.`)
  }
  return value
}

function assertAllowedFields (value, allowed) {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) {
      throw incidentError('INCIDENT_FIELD_READONLY', `Field cannot be edited: ${key}`)
    }
  }
}

function createIncidentRecord (draft, options) {
  assertSafeKeys(draft)
  assertAllowedFields(draft, CREATE_FIELDS)
  const now = Number(options.now)
  const id = boundedText(options.id, 'id', 128, true)
  return {
    id,
    title: boundedText(draft.title, 'title', 200, true),
    endpointRef: boundedText(draft.endpointRef, 'endpointRef', 128),
    sessionRefs: uniqueTags(draft.sessionRefs || [], 'sessionRefs'),
    state: INCIDENT_STATES.investigating,
    severity: boundedEnum(
      draft.severity,
      'severity',
      ['low', 'medium', 'high', 'critical'],
      'medium'
    ),
    serviceTags: uniqueTags(draft.serviceTags || [], 'serviceTags'),
    customTags: uniqueTags(draft.customTags || [], 'customTags'),
    summary: boundedText(draft.summary, 'summary', 20000),
    rootCause: boundedText(draft.rootCause, 'rootCause', 20000),
    resolution: boundedText(draft.resolution, 'resolution', 20000),
    verificationStatus: 'pending',
    storagePolicy: boundedEnum(
      draft.storagePolicy,
      'storagePolicy',
      ['light', 'standard', 'full'],
      'standard'
    ),
    isPinned: Boolean(draft.isPinned),
    isFavorite: Boolean(draft.isFavorite),
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    archivedAt: null
  }
}

function createIncidentPatch (patch) {
  assertSafeKeys(patch)
  assertAllowedFields(patch, EDITABLE_FIELDS)
  const normalized = {}
  if ('title' in patch) normalized.title = boundedText(patch.title, 'title', 200, true)
  if ('endpointRef' in patch) normalized.endpointRef = boundedText(patch.endpointRef, 'endpointRef', 128)
  if ('sessionRefs' in patch) normalized.sessionRefs = uniqueTags(patch.sessionRefs, 'sessionRefs')
  if ('serviceTags' in patch) normalized.serviceTags = uniqueTags(patch.serviceTags, 'serviceTags')
  if ('customTags' in patch) normalized.customTags = uniqueTags(patch.customTags, 'customTags')
  if ('summary' in patch) normalized.summary = boundedText(patch.summary, 'summary', 20000)
  if ('rootCause' in patch) normalized.rootCause = boundedText(patch.rootCause, 'rootCause', 20000)
  if ('resolution' in patch) normalized.resolution = boundedText(patch.resolution, 'resolution', 20000)
  if ('severity' in patch) {
    normalized.severity = boundedEnum(
      patch.severity,
      'severity',
      ['low', 'medium', 'high', 'critical']
    )
  }
  if ('storagePolicy' in patch) {
    normalized.storagePolicy = boundedEnum(
      patch.storagePolicy,
      'storagePolicy',
      ['light', 'standard', 'full']
    )
  }
  if ('isPinned' in patch) normalized.isPinned = Boolean(patch.isPinned)
  if ('isFavorite' in patch) normalized.isFavorite = Boolean(patch.isFavorite)
  return normalized
}

function validateTransition (
  currentState,
  input,
  currentVerificationStatus = 'pending'
) {
  const nextState = boundedText(input.state, 'state', 32, true)
  if (!TRANSITIONS[currentState]?.has(nextState)) {
    throw incidentError('INCIDENT_TRANSITION_INVALID', `${currentState} cannot transition to ${nextState}.`)
  }
  if (nextState === INCIDENT_STATES.archived) {
    return {
      state: nextState,
      verificationStatus: boundedEnum(
        currentVerificationStatus,
        'verificationStatus',
        ['pending', 'mitigated', 'passed_manual', 'passed_auto'],
        'pending'
      )
    }
  }
  if (nextState === INCIDENT_STATES.resolved) {
    if (!['passed_manual', 'passed_auto'].includes(input.verificationStatus)) {
      throw incidentError(
        'INCIDENT_VERIFICATION_REQUIRED',
        'Resolved incidents require a passed verification.'
      )
    }
    const verificationStatus = boundedEnum(
      input.verificationStatus,
      'verificationStatus',
      ['passed_manual', 'passed_auto']
    )
    return { state: nextState, verificationStatus }
  }
  if (nextState === INCIDENT_STATES.unresolved) {
    const verificationStatus = boundedEnum(
      input.verificationStatus,
      'verificationStatus',
      ['pending', 'mitigated'],
      'pending'
    )
    return { state: nextState, verificationStatus }
  }
  return { state: nextState, verificationStatus: 'pending' }
}

module.exports = {
  INCIDENT_STATES,
  TRANSITIONS,
  createIncidentRecord,
  createIncidentPatch,
  validateTransition,
  incidentError
}
```

- [ ] **Step 4: 运行模型测试**

```powershell
node --test test/unit-ci/incident-model.spec.js
```

Expected: PASS, 3 tests.

- [ ] **Step 5: 提交模型**

```powershell
git add src/app/lib/incidents/incident-model.js test/unit-ci/incident-model.spec.js
git commit -m "feat: add incident archive domain model"
```

---

### Task 2: 建立 SQLite schema、迁移备份和损坏恢复

**Files:**
- Create: `apps/electerm-agent/src/app/lib/incidents/incident-migrations.js`
- Create: `apps/electerm-agent/src/app/lib/incidents/incident-database.js`
- Test: `apps/electerm-agent/test/unit-ci/incident-database.spec.js`

- [ ] **Step 1: 写数据库创建、迁移回退和空间统计失败测试**

测试必须使用 `fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-incidents-'))`，并在 `afterEach` 删除目录。

```js
test('creates version 1 schema with fts and indexes', () => {
  const manager = createIncidentDatabase({ rootPath })
  assert.equal(manager.db.prepare('PRAGMA user_version').get().user_version, 1)
  assert.ok(manager.db.prepare(
    "SELECT name FROM sqlite_master WHERE name = 'incident_search'"
  ).get())
  assert.ok(manager.db.prepare(
    "SELECT name FROM sqlite_master WHERE name = 'idx_incidents_state_updated'"
  ).get())
  manager.close()
})

test('restores pre-migration backup when the next migration fails', () => {
  seedVersionOneDatabase(rootPath)
  assert.throws(() => createIncidentDatabase({
    rootPath,
    migrationSteps: [
      ...INCIDENT_MIGRATIONS,
      {
        version: 2,
        run () {
          throw new Error('forced migration failure')
        }
      }
    ]
  }), /forced migration failure/)
  const reopened = createIncidentDatabase({ rootPath })
  assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 1)
  assert.equal(reopened.listBackups().length, 1)
  reopened.close()
})

test('reports storage and restores a validated manual backup', () => {
  const manager = createIncidentDatabase({ rootPath, now: () => 1000 })
  const backup = manager.createBackup('manual')
  const secondBackup = manager.createBackup('manual')
  assert.notEqual(secondBackup.filename, backup.filename)
  manager.db.exec("INSERT INTO incidents (id, title, state, severity, verification_status, storage_policy, created_at, updated_at) VALUES ('later', 'Later', 'investigating', 'medium', 'pending', 'standard', 2, 2)")
  manager.restoreBackup(backup.filename, 'RESTORE')
  assert.equal(manager.db.prepare("SELECT id FROM incidents WHERE id = 'later'").get(), undefined)
  const storage = manager.getStorageStats()
  assert.equal(storage.backupCount, 3)
  assert.ok(storage.databaseBytes > 0)
  manager.close()
})

test('recovers a corrupt database from the newest healthy backup', () => {
  const manager = createIncidentDatabase({ rootPath, now: () => 2000 })
  manager.db.exec("INSERT INTO incidents (id, title, state, severity, verification_status, storage_policy, created_at, updated_at) VALUES ('saved', 'Saved', 'investigating', 'medium', 'pending', 'standard', 2, 2)")
  manager.createBackup('manual')
  const databasePath = manager.databasePath
  manager.close()
  fs.writeFileSync(databasePath, Buffer.from('not-a-sqlite-database'))

  const recovered = createIncidentDatabase({ rootPath, now: () => 3000 })
  assert.equal(
    recovered.db.prepare("SELECT title FROM incidents WHERE id = 'saved'").get().title,
    'Saved'
  )
  assert.ok(
    fs.readdirSync(rootPath).some(name => name.includes('.corrupt-3000'))
  )
  recovered.close()
})
```

- [ ] **Step 2: 运行数据库测试并确认失败**

```powershell
node --test test/unit-ci/incident-database.spec.js
```

Expected: FAIL because `incident-database.js` and `incident-migrations.js` do not exist.

- [ ] **Step 3: 定义 version 1 schema**

`incident-migrations.js` 使用完整 schema：

```js
const INCIDENT_MIGRATIONS = Object.freeze([
  {
    version: 1,
    run (db) {
      db.exec(`
        CREATE TABLE incidents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          endpoint_ref TEXT NOT NULL DEFAULT '',
          session_refs_json TEXT NOT NULL DEFAULT '[]',
          state TEXT NOT NULL,
          severity TEXT NOT NULL,
          service_tags_json TEXT NOT NULL DEFAULT '[]',
          custom_tags_json TEXT NOT NULL DEFAULT '[]',
          summary TEXT NOT NULL DEFAULT '',
          root_cause TEXT NOT NULL DEFAULT '',
          resolution TEXT NOT NULL DEFAULT '',
          verification_status TEXT NOT NULL DEFAULT 'pending',
          storage_policy TEXT NOT NULL DEFAULT 'standard',
          is_pinned INTEGER NOT NULL DEFAULT 0,
          is_favorite INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          resolved_at INTEGER,
          archived_at INTEGER
        );
        CREATE TABLE incident_notes (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE incident_state_events (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
          from_state TEXT,
          to_state TEXT NOT NULL,
          verification_status TEXT NOT NULL,
          actor TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_incidents_state_updated
          ON incidents(state, updated_at DESC);
        CREATE INDEX idx_incidents_endpoint_updated
          ON incidents(endpoint_ref, updated_at DESC);
        CREATE INDEX idx_incidents_severity_updated
          ON incidents(severity, updated_at DESC);
        CREATE INDEX idx_incidents_pinned_updated
          ON incidents(is_pinned DESC, updated_at DESC);
        CREATE INDEX idx_incidents_updated
          ON incidents(updated_at DESC);
        CREATE INDEX idx_incident_notes_incident_created
          ON incident_notes(incident_id, created_at DESC);
        CREATE INDEX idx_incident_state_events_incident_created
          ON incident_state_events(incident_id, created_at DESC);
        CREATE VIRTUAL TABLE incident_search USING fts5(
          incident_id UNINDEXED,
          title,
          summary,
          root_cause,
          resolution,
          service_tags,
          custom_tags,
          notes,
          tokenize = 'unicode61'
        );
      `)
    }
  }
])

module.exports = {
  CURRENT_INCIDENT_SCHEMA_VERSION: 1,
  INCIDENT_MIGRATIONS
}
```

- [ ] **Step 4: 实现数据库管理器**

`incident-database.js` 必须：

1. 把数据写入 `<DATA_PATH>/incident-archives/incidents.db`。
2. 启用 `foreign_keys`、`WAL` 和 `busy_timeout = 5000`。
3. 按 `PRAGMA user_version` 顺序迁移。
4. 每次升级已有 schema 前调用 `VACUUM INTO` 创建 `pre-migration` 备份。
5. 迁移失败时关闭数据库、用备份原子恢复，再原样抛出错误。
6. `restoreBackup` 先创建 `pre-restore` 备份，校验目标备份 `PRAGMA integrity_check = ok` 后替换数据库。
7. 只接受 `path.basename(filename) === filename` 的备份名。
8. 默认只保留最近 5 个备份。
9. 打开已有数据库时先执行 `PRAGMA quick_check`；损坏时把原文件改名为 `incidents.db.corrupt-<timestamp>`，从最近一个通过 `integrity_check` 的备份恢复。
10. 没有健康备份时把损坏文件原样放回 `incidents.db` 并抛出 `INCIDENT_DATABASE_CORRUPT`，禁止静默创建空库覆盖原始数据。

核心接口：

```js
function createIncidentDatabase ({
  rootPath,
  migrationSteps = INCIDENT_MIGRATIONS,
  now = Date.now,
  maxBackups = 5
}) {
  const databasePath = path.join(rootPath, 'incidents.db')
  const backupsPath = path.join(rootPath, 'backups')
  let db

  function open () {
    fs.mkdirSync(backupsPath, { recursive: true })
    db = new DatabaseSync(databasePath)
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    migrate()
    return db
  }

  function createBackup (reason = 'manual') {
    db.exec('PRAGMA wal_checkpoint(FULL)')
    const stamp = now()
    let sequence = 0
    let filename
    do {
      const suffix = sequence ? `-${sequence}` : ''
      filename = `incidents-${reason}-${stamp}${suffix}.db`
      sequence += 1
    } while (fs.existsSync(path.join(backupsPath, filename)))
    const target = path.join(backupsPath, filename)
    const escaped = target.replaceAll("'", "''")
    db.exec(`VACUUM INTO '${escaped}'`)
    pruneBackups()
    return { filename, bytes: fs.statSync(target).size }
  }

  function assertHealthyDatabase (target) {
    const candidate = new DatabaseSync(target, { readOnly: true })
    try {
      const row = candidate.prepare('PRAGMA integrity_check').get()
      if (row.integrity_check !== 'ok') {
        throw new Error('Incident backup integrity check failed.')
      }
    } finally {
      candidate.close()
    }
  }

  function restoreBackup (filename, confirmation) {
    if (confirmation !== 'RESTORE') {
      throw new Error('Incident backup restore requires confirmation.')
    }
    if (path.basename(filename) !== filename) {
      throw new Error('Incident backup path is invalid.')
    }
    const source = path.join(backupsPath, filename)
    assertHealthyDatabase(source)
    createBackup('pre-restore')
    db.close()
    const replacement = `${databasePath}.${now()}.restore`
    const previous = `${databasePath}.${now()}.previous`
    fs.copyFileSync(source, replacement)
    try {
      fs.renameSync(databasePath, previous)
      fs.renameSync(replacement, databasePath)
      for (const suffix of ['-wal', '-shm']) {
        fs.rmSync(`${databasePath}${suffix}`, { force: true })
      }
    } catch (error) {
      if (fs.existsSync(previous)) {
        fs.rmSync(databasePath, { force: true })
        fs.renameSync(previous, databasePath)
      }
      fs.rmSync(replacement, { force: true })
      open()
      throw error
    }
    fs.rmSync(previous, { force: true })
    open()
    return { restored: true, filename }
  }

  open()
  return {
    get db () { return db },
    databasePath,
    createBackup,
    restoreBackup,
    listBackups,
    getStorageStats,
    close: () => db.close()
  }
}
```

迁移实现必须用 `db.exec('BEGIN IMMEDIATE')`、`COMMIT` 和 `ROLLBACK`，并在成功后执行 `PRAGMA user_version = N`。`getStorageStats()` 返回 `databaseBytes`、`walBytes`、`backupBytes`、`backupCount`、`latestBackupAt`，缺失文件按 0 字节处理。

- [ ] **Step 5: 运行数据库测试**

```powershell
node --test test/unit-ci/incident-database.spec.js
```

Expected: PASS, 4 tests; temporary directories are removed.

- [ ] **Step 6: 提交数据库基础**

```powershell
git add src/app/lib/incidents/incident-migrations.js src/app/lib/incidents/incident-database.js test/unit-ci/incident-database.spec.js
git commit -m "feat: add incident archive sqlite storage"
```

---

### Task 3: 实现档案 repository、FTS 和 10,000 条分页

**Files:**
- Create: `apps/electerm-agent/src/app/lib/incidents/incident-repository.js`
- Test: `apps/electerm-agent/test/unit-ci/incident-repository.spec.js`

- [ ] **Step 1: 写 CRUD、状态事件、FTS 和大数据分页失败测试**

```js
test('creates, edits and transitions an incident transactionally', () => {
  const repository = createRepositoryHarness()
  const created = repository.create({
    title: 'Nginx 502',
    endpointRef: 'server-1',
    serviceTags: ['nginx']
  })
  repository.update(created.id, {
    summary: 'upstream timeout',
    customTags: ['production']
  })
  repository.addNote(created.id, 'upstream-a repeatedly timed out')
  repository.transition(created.id, {
    state: 'verifying',
    verificationStatus: 'pending'
  })
  repository.transition(created.id, {
    state: 'resolved',
    verificationStatus: 'passed_manual'
  })

  const detail = repository.get(created.id)
  assert.equal(detail.state, 'resolved')
  assert.equal(detail.summary, 'upstream timeout')
  assert.equal(
    repository.list({ query: 'upstream-a', page: 1, pageSize: 20 }).total,
    1
  )
  assert.deepEqual(
    detail.stateEvents.map(event => event.toState),
    ['investigating', 'verifying', 'resolved']
  )
})

test('searches and filters with stable pagination', () => {
  const repository = createRepositoryHarness()
  seedIncidents(repository, 120)
  const page = repository.list({
    query: 'nginx timeout',
    state: ['investigating'],
    severity: ['high'],
    serviceTags: ['nginx'],
    customTags: ['production'],
    updatedFrom: 1000,
    updatedTo: 9999999999999,
    favoriteOnly: true,
    page: 2,
    pageSize: 20
  })
  assert.equal(page.page, 2)
  assert.equal(page.pageSize, 20)
  assert.equal(page.items.length, 20)
  assert.ok(page.total >= 40)
  assert.ok(page.items.every(item => item.state === 'investigating'))
})

test('keeps ten thousand incidents pageable without loading all rows', () => {
  const repository = createRepositoryHarness()
  seedIncidents(repository, 10000)
  const startedAt = performance.now()
  const page = repository.list({
    query: 'nginx',
    page: 100,
    pageSize: 40
  })
  const duration = performance.now() - startedAt
  assert.equal(page.items.length, 40)
  assert.ok(page.total > 4000)
  assert.ok(duration < 3000, `paged query took ${duration}ms`)
})

test('rebuilds missing full text rows from incidents and notes', () => {
  const database = createRepositoryDatabaseHarness()
  const repository = createIncidentRepository({
    getDatabase: () => database
  })
  const incident = repository.create({ title: 'Disk alert' })
  repository.addNote(incident.id, 'inode exhaustion')
  database.prepare(
    'DELETE FROM incident_search WHERE incident_id = ?'
  ).run(incident.id)

  assert.equal(repository.ensureSearchIndex(), 1)
  assert.equal(
    repository.list({ query: 'inode', page: 1, pageSize: 20 }).total,
    1
  )
})
```

测试辅助函数 `seedIncidents(repository, count)` 必须生成确定性数据：至少 60 条同时包含 `nginx timeout`、`investigating`、`high`、`serviceTags: ['nginx']`、`customTags: ['production']` 和 `isFavorite: true`，其余数据覆盖其他状态与标签；时间戳由注入的 `now` 单调递增，禁止依赖真实时钟造成分页测试波动。

- [ ] **Step 2: 运行 repository 测试并确认失败**

```powershell
node --test test/unit-ci/incident-repository.spec.js
```

Expected: FAIL because `incident-repository.js` does not exist.

- [ ] **Step 3: 实现行映射、FTS 查询和事务写入**

repository 构造函数：

```js
function createIncidentRepository ({
  getDatabase,
  now = Date.now,
  createId = () => crypto.randomUUID()
}) {
  const db = () => getDatabase()
  return Object.freeze({
    create,
    get,
    update,
    transition,
    addNote,
    deleteNote,
    list,
    summary,
    ensureSearchIndex
  })
}
```

必须实现并导出：

```js
{
  create(draft),
  get(id),
  update(id, patch),
  transition(id, transition),
  addNote(id, body),
  deleteNote(id, noteId),
  list(filters),
  summary(),
  ensureSearchIndex()
}
```

FTS 输入先转换为安全前缀查询，禁止把用户输入直接拼入 SQL：

```js
function toFtsQuery (value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .map(token => `"${token.replaceAll('"', '""')}"*`)
    .join(' AND ')
}
```

列表 SQL 使用参数绑定：

```js
function buildListQuery (filters) {
  const joins = []
  const where = []
  const params = {}
  const fts = toFtsQuery(filters.query)
  if (fts) {
    joins.push('JOIN incident_search ON incident_search.incident_id = i.id')
    where.push('incident_search MATCH $query')
    params.$query = fts
  }
  if (filters.endpointRef) {
    where.push('i.endpoint_ref = $endpointRef')
    params.$endpointRef = filters.endpointRef
  }
  if (filters.state?.length) {
    const names = filters.state.map((_, index) => `$state${index}`)
    where.push(`i.state IN (${names.join(', ')})`)
    filters.state.forEach((state, index) => {
      params[`$state${index}`] = state
    })
  }
  if (filters.severity?.length) {
    const names = filters.severity.map((_, index) => `$severity${index}`)
    where.push(`i.severity IN (${names.join(', ')})`)
    filters.severity.forEach((severity, index) => {
      params[`$severity${index}`] = severity
    })
  }
  if (filters.serviceTags?.length) {
    const names = filters.serviceTags.map((_, index) => `$serviceTag${index}`)
    where.push(`
      EXISTS (
        SELECT 1 FROM json_each(i.service_tags_json)
        WHERE value IN (${names.join(', ')})
      )
    `)
    filters.serviceTags.forEach((tag, index) => {
      params[`$serviceTag${index}`] = tag
    })
  }
  if (filters.customTags?.length) {
    const names = filters.customTags.map((_, index) => `$customTag${index}`)
    where.push(`
      EXISTS (
        SELECT 1 FROM json_each(i.custom_tags_json)
        WHERE value IN (${names.join(', ')})
      )
    `)
    filters.customTags.forEach((tag, index) => {
      params[`$customTag${index}`] = tag
    })
  }
  if (Number.isFinite(filters.updatedFrom)) {
    where.push('i.updated_at >= $updatedFrom')
    params.$updatedFrom = filters.updatedFrom
  }
  if (Number.isFinite(filters.updatedTo)) {
    where.push('i.updated_at <= $updatedTo')
    params.$updatedTo = filters.updatedTo
  }
  if (filters.favoriteOnly) {
    where.push('i.is_favorite = 1')
  }
  return {
    joins: joins.join(' '),
    where: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  }
}
```

`list()` 必须分别执行 `COUNT(*)` 和当前页查询，不能先读取全部记录：

```js
const offset = (page - 1) * pageSize
const total = db().prepare(`
  SELECT COUNT(DISTINCT i.id) AS total
  FROM incidents i ${joins} ${where}
`).get(params).total
const rows = db().prepare(`
  SELECT i.*
  FROM incidents i ${joins} ${where}
  ORDER BY i.is_pinned DESC, i.updated_at DESC, i.id ASC
  LIMIT $limit OFFSET $offset
`).all({ ...params, $limit: pageSize, $offset: offset })
```

每次 `create`、`update`、`transition`、`addNote` 和 `deleteNote` 在同一个 `BEGIN IMMEDIATE` 事务内同步更新 `incident_search`。索引中的 `notes` 是该档案全部备注正文按创建时间拼接后的受限文本；单条备注最大 20,000 字，索引聚合最多保留最近 200 条或 1 MiB 文本，以先达到的限制为准。`create` 同时写入首条 `incident_state_events`，`transition` 写入 from/to 状态事件，并按状态更新 `resolved_at` 和 `archived_at`。

`transition()` 必须把当前记录的 `verification_status` 作为第三个参数传给 `validateTransition(currentState, input, currentVerificationStatus)`，确保已解决档案归档时保留验证结果，重新进入排查时重置为 `pending`。

```js
function refreshSearchIndex (incidentId) {
  const incident = db().prepare(
    'SELECT * FROM incidents WHERE id = ?'
  ).get(incidentId)
  const noteRows = db().prepare(`
    SELECT body FROM incident_notes
    WHERE incident_id = ?
    ORDER BY created_at DESC
    LIMIT 200
  `).all(incidentId)
  let noteText = ''
  for (const row of noteRows.reverse()) {
    const next = noteText ? `${noteText}\n${row.body}` : row.body
    if (Buffer.byteLength(next, 'utf8') > 1024 * 1024) break
    noteText = next
  }
  db().prepare(
    'DELETE FROM incident_search WHERE incident_id = ?'
  ).run(incidentId)
  db().prepare(`
    INSERT INTO incident_search (
      incident_id, title, summary, root_cause, resolution,
      service_tags, custom_tags, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    incident.id,
    incident.title,
    incident.summary,
    incident.root_cause,
    incident.resolution,
    JSON.parse(incident.service_tags_json).join(' '),
    JSON.parse(incident.custom_tags_json).join(' '),
    noteText
  )
}
```

repository 创建完成时先比较 `incidents` 与 `incident_search` 的总数，不一致才调用 `ensureSearchIndex()`。`ensureSearchIndex()` 在单个 `BEGIN IMMEDIATE` 事务中清空并按每批 200 条重建 FTS，返回重建条数；`list()` 遇到 FTS 虚表损坏错误时只允许自动重建并重试一次，第二次失败必须抛出 `INCIDENT_SEARCH_INDEX_CORRUPT`，不得进入无限重试。

`get(id)` 返回：

```js
{
  ...incident,
  notes: [],
  stateEvents: []
}
```

`summary()` 只查询：

- `unresolvedCount`: 不在 `resolved`、`archived`、`false_positive` 的档案数。
- `handledThisWeek`: 本周更新为 resolved、unresolved 或 false_positive 的数量。
- `recentUnresolved`: 最近更新的 3 条未解决档案。

- [ ] **Step 4: 运行 repository 测试**

```powershell
node --test test/unit-ci/incident-repository.spec.js
```

Expected: PASS, including 10,000-row pagination.

- [ ] **Step 5: 提交 repository**

```powershell
git add src/app/lib/incidents/incident-repository.js test/unit-ci/incident-repository.spec.js
git commit -m "feat: add searchable incident archive repository"
```

---

### Task 4: 通过稳定 IPC 暴露档案服务

**Files:**
- Create: `apps/electerm-agent/src/app/lib/incidents/incident-service.js`
- Create: `apps/electerm-agent/src/client/components/incidents/incident-client.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Test: `apps/electerm-agent/test/unit-ci/incident-ipc.spec.js`

- [ ] **Step 1: 写 IPC 纯数据、错误码和延迟初始化失败测试**

```js
test('incident client unwraps plain ipc values and preserves error codes', async () => {
  const calls = []
  const client = loadIncidentClient({
    runGlobalAsync: async (method, ...args) => {
      calls.push([method, ...args])
      if (method === 'getIncidentArchive') {
        return { ok: false, error: { code: 'INCIDENT_NOT_FOUND', message: 'Not found.' } }
      }
      return { ok: true, value: { items: [], page: 1, pageSize: 40, total: 0, pageCount: 0 } }
    }
  })
  await client.list({ page: 1 })
  await assert.rejects(
    () => client.get('missing'),
    error => error.code === 'INCIDENT_NOT_FOUND'
  )
  assert.deepEqual(calls[0], ['listIncidentArchives', { page: 1 }])
})

test('ipc registers incident methods without constructing storage at startup', () => {
  const source = fs.readFileSync(ipcPath, 'utf8')
  assert.match(source, /let incidentArchiveService/)
  assert.match(source, /function getIncidentArchiveService/)
  assert.match(source, /listIncidentArchives/)
  assert.doesNotMatch(source, /const incidentArchiveService = createIncidentArchiveService/)
})
```

- [ ] **Step 2: 运行 IPC 测试并确认失败**

```powershell
node --test test/unit-ci/incident-ipc.spec.js
```

Expected: FAIL because the service, client and IPC methods do not exist.

- [ ] **Step 3: 实现 service**

`incident-service.js`：

```js
function createIncidentArchiveService ({ database, repository }) {
  return Object.freeze({
    list: filters => repository.list(filters || {}),
    get: id => repository.get(id),
    create: draft => repository.create(draft),
    update: (id, patch) => repository.update(id, patch),
    transition: (id, input) => repository.transition(id, input),
    addNote: (id, body) => repository.addNote(id, body),
    deleteNote: (id, noteId) => repository.deleteNote(id, noteId),
    summary: () => repository.summary(),
    storage: () => ({
      ...database.getStorageStats(),
      backups: database.listBackups()
    }),
    createBackup: () => database.createBackup('manual'),
    restoreBackup: (filename, confirmation) => {
      const result = database.restoreBackup(filename, confirmation)
      return { ...result, summary: repository.summary() }
    }
  })
}
```

- [ ] **Step 4: 注册 IPC singleton 和安全错误包装**

在 `ipc.js` 中新增：

```js
let incidentArchiveService

function getIncidentArchiveService () {
  if (incidentArchiveService) return incidentArchiveService
  const dataRoot = process.env.DATA_PATH || path.resolve(appPath, 'electerm')
  const database = createIncidentDatabase({
    rootPath: path.resolve(dataRoot, 'incident-archives')
  })
  incidentArchiveService = createIncidentArchiveService({
    database,
    repository: createIncidentRepository({
      getDatabase: () => database.db
    })
  })
  return incidentArchiveService
}

function safeIncidentResult (operation) {
  return Promise.resolve()
    .then(operation)
    .then(value => ({ ok: true, value: JSON.parse(JSON.stringify(value)) }))
    .catch(error => ({
      ok: false,
      error: {
        code: String(error?.code || '').startsWith('INCIDENT_')
          ? error.code
          : 'INCIDENT_IPC_ERROR',
        message: String(error?.code || '').startsWith('INCIDENT_')
          ? error.message
          : 'Incident archive operation failed.'
      }
    }))
}
```

把数据和 service/repository/database 依赖在文件顶部导入，并把 11 个 IPC 方法加入单独的 `incidentArchiveAsyncGlobals` 后展开到 `asyncGlobals`。禁止把数据库实例或 Error 对象直接返回 renderer。

- [ ] **Step 5: 实现 renderer client**

```js
function incidentIpcError (payload = {}) {
  const error = new Error(payload.message || 'Incident archive operation failed.')
  error.code = payload.code || 'INCIDENT_IPC_ERROR'
  return error
}

function cloneIpcValue (value) {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value))
}

async function call (method, ...args) {
  const result = await window.pre.runGlobalAsync(
    method,
    ...args.map(cloneIpcValue)
  )
  if (!result?.ok) throw incidentIpcError(result?.error)
  return result.value
}

export const incidentClient = Object.freeze({
  list: filters => call('listIncidentArchives', filters || {}),
  get: id => call('getIncidentArchive', id),
  create: draft => call('createIncidentArchive', draft),
  update: (id, patch) => call('updateIncidentArchive', id, patch),
  transition: (id, input) => call('transitionIncidentArchive', id, input),
  addNote: (id, body) => call('addIncidentNote', id, body),
  deleteNote: (id, noteId) => call('deleteIncidentNote', id, noteId),
  summary: () => call('getIncidentArchiveSummary'),
  storage: () => call('getIncidentArchiveStorage'),
  createBackup: () => call('createIncidentArchiveBackup'),
  restoreBackup: (filename, confirmation) => (
    call('restoreIncidentArchiveBackup', filename, confirmation)
  )
})
```

- [ ] **Step 6: 运行 IPC 测试**

```powershell
node --test test/unit-ci/incident-ipc.spec.js
```

Expected: PASS.

- [ ] **Step 7: 提交 IPC 服务**

```powershell
git add src/app/lib/incidents/incident-service.js src/app/lib/ipc.js src/client/components/incidents/incident-client.js test/unit-ci/incident-ipc.spec.js
git commit -m "feat: expose incident archives through safe ipc"
```

---

### Task 5: 增加 renderer store 和工作区导航

**Files:**
- Create: `apps/electerm-agent/src/client/store/incident-archives.js`
- Create: `apps/electerm-agent/src/client/components/incidents/incident-navigation.js`
- Modify: `apps/electerm-agent/src/client/store/init-state.js`
- Modify: `apps/electerm-agent/src/client/store/store.js`
- Test: `apps/electerm-agent/test/unit-ci/incident-store.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/incident-navigation.spec.js`

- [ ] **Step 1: 写 store 初始状态和动作失败测试**

初始状态断言：

```js
assert.match(source, /incidentItems:\s*\[\]/)
assert.match(source, /activeIncidentId:\s*''/)
assert.match(source, /incidentPage:\s*1/)
assert.match(source, /incidentPageSize:\s*40/)
assert.match(source, /incidentSummary:\s*null/)
assert.match(source, /incidentLoading:\s*false/)
assert.match(source, /incidentError:\s*''/)
```

动作测试：

```js
store.openIncidentArchiveWorkspace('incident-1')
assert.equal(store.mainWorkspaceMode, 'incident-archives')
assert.equal(store.activeIncidentId, 'incident-1')
assert.strictEqual(store.tabs, originalTabs)

await store.loadIncidentArchives({ query: 'nginx', page: 2 })
assert.equal(store.incidentItems[0].id, 'incident-1')
assert.equal(store.incidentPage, 2)
assert.equal(store.incidentLoading, false)

await store.transitionActiveIncident({
  state: 'verifying',
  verificationStatus: 'pending'
})
assert.equal(store.activeIncident.state, 'verifying')
```

- [ ] **Step 2: 写导航失败测试**

```js
test('incident workspace opens without replacing terminal tabs', () => {
  const tabs = [{ id: 'ssh-1' }]
  const store = { mainWorkspaceMode: 'terminal', tabs, activeTabId: 'ssh-1' }
  assert.equal(openIncidentArchive(store, 'incident-1'), true)
  assert.equal(store.mainWorkspaceMode, 'incident-archives')
  assert.equal(store.activeIncidentId, 'incident-1')
  assert.strictEqual(store.tabs, tabs)
  assert.equal(closeIncidentArchive(store), true)
  assert.equal(store.mainWorkspaceMode, 'terminal')
})

test('inactive terminal layer is inert while incident workspace is open', () => {
  assert.deepEqual(getIncidentWorkspaceAccessibility(true), {
    inert: true,
    'aria-hidden': true
  })
})
```

- [ ] **Step 3: 运行 store 和导航测试并确认失败**

```powershell
node --test test/unit-ci/incident-store.spec.js test/unit-ci/incident-navigation.spec.js
```

Expected: FAIL because the store extension and navigation module do not exist.

- [ ] **Step 4: 实现导航模块**

```js
const incidentWorkspaceMode = 'incident-archives'

export function openIncidentArchive (store, id = '') {
  const changed = store.mainWorkspaceMode !== incidentWorkspaceMode ||
    store.activeIncidentId !== id
  store.mainWorkspaceMode = incidentWorkspaceMode
  store.activeIncidentId = id
  return changed
}

export function closeIncidentArchive (store) {
  if (store.mainWorkspaceMode !== incidentWorkspaceMode) return false
  store.mainWorkspaceMode = 'terminal'
  return true
}

export function getIncidentWorkspaceAccessibility (active) {
  return { inert: active, 'aria-hidden': active }
}

export function focusIncidentWorkspace (active, element) {
  if (!active || typeof element?.focus !== 'function') return false
  element.focus({ preventScroll: true })
  return true
}
```

- [ ] **Step 5: 增加状态并实现 store 扩展**

`init-state.js` 新增：

```js
activeIncidentId: '',
activeIncident: null,
incidentItems: [],
incidentFilters: {
  query: '',
  endpointRef: '',
  state: [],
  severity: [],
  serviceTags: [],
  customTags: [],
  updatedFrom: null,
  updatedTo: null,
  favoriteOnly: false
},
incidentPage: 1,
incidentPageSize: 40,
incidentTotal: 0,
incidentSummary: null,
incidentLoading: false,
incidentSaving: false,
incidentError: '',
incidentStorage: null,
incidentStorageOpen: false,
```

`incident-archives.js` 实现以下完整动作；写动作成功后统一刷新当前页和首页摘要，恢复备份后清空旧选中项：

```js
import { incidentClient } from '../components/incidents/incident-client'
import {
  openIncidentArchive,
  closeIncidentArchive
} from '../components/incidents/incident-navigation'

function incidentErrorMessage (error) {
  return error?.message || '故障档案操作失败，请稍后重试。'
}

async function refreshIncidentViews (store) {
  await Promise.all([
    store.loadIncidentArchives(),
    store.loadIncidentSummary()
  ])
}

export default Store => {
  Store.prototype.openIncidentArchiveWorkspace = function (id = '') {
    const store = window.store
    openIncidentArchive(store, id)
    store.incidentError = ''
    if (id) store.selectIncidentArchive(id)
    return true
  }

  Store.prototype.closeIncidentArchiveWorkspace = function () {
    return closeIncidentArchive(window.store)
  }

  Store.prototype.loadIncidentArchives = async function (filters = {}) {
    const store = window.store
    store.incidentFilters = {
      ...store.incidentFilters,
      ...filters
    }
    store.incidentPage = filters.page || store.incidentPage
    store.incidentPageSize = filters.pageSize || store.incidentPageSize
    store.incidentLoading = true
    store.incidentError = ''
    try {
      const result = await incidentClient.list({
        ...store.incidentFilters,
        page: store.incidentPage,
        pageSize: store.incidentPageSize
      })
      store.incidentItems = result.items
      store.incidentPage = result.page
      store.incidentPageSize = result.pageSize
      store.incidentTotal = result.total
      return result
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentLoading = false
    }
  }

  Store.prototype.selectIncidentArchive = async function (id) {
    const store = window.store
    store.activeIncidentId = id || ''
    store.incidentError = ''
    if (!id) {
      store.activeIncident = null
      return null
    }
    try {
      store.activeIncident = await incidentClient.get(id)
      return store.activeIncident
    } catch (error) {
      store.activeIncident = null
      store.incidentError = incidentErrorMessage(error)
      return null
    }
  }

  Store.prototype.createIncidentArchive = async function (draft) {
    const store = window.store
    store.incidentSaving = true
    store.incidentError = ''
    try {
      const created = await incidentClient.create(draft)
      store.activeIncidentId = created.id
      store.activeIncident = created
      await refreshIncidentViews(store)
      return created
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentSaving = false
    }
  }

  Store.prototype.updateActiveIncident = async function (patch) {
    const store = window.store
    if (!store.activeIncidentId) return null
    store.incidentSaving = true
    store.incidentError = ''
    try {
      const updated = await incidentClient.update(store.activeIncidentId, patch)
      store.activeIncident = updated
      await refreshIncidentViews(store)
      return updated
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentSaving = false
    }
  }

  Store.prototype.transitionActiveIncident = async function (input) {
    const store = window.store
    if (!store.activeIncidentId) return null
    store.incidentSaving = true
    store.incidentError = ''
    try {
      const updated = await incidentClient.transition(
        store.activeIncidentId,
        input
      )
      store.activeIncident = updated
      await refreshIncidentViews(store)
      return updated
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentSaving = false
    }
  }

  Store.prototype.addActiveIncidentNote = async function (body) {
    const store = window.store
    if (!store.activeIncidentId) return null
    try {
      store.activeIncident = await incidentClient.addNote(
        store.activeIncidentId,
        body
      )
      await refreshIncidentViews(store)
      return store.activeIncident
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    }
  }

  Store.prototype.deleteActiveIncidentNote = async function (noteId) {
    const store = window.store
    if (!store.activeIncidentId) return null
    try {
      store.activeIncident = await incidentClient.deleteNote(
        store.activeIncidentId,
        noteId
      )
      await refreshIncidentViews(store)
      return store.activeIncident
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    }
  }

  Store.prototype.loadIncidentSummary = async function () {
    const store = window.store
    try {
      store.incidentSummary = await incidentClient.summary()
      return store.incidentSummary
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    }
  }

  Store.prototype.loadIncidentStorage = async function () {
    const store = window.store
    try {
      store.incidentStorage = await incidentClient.storage()
      return store.incidentStorage
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    }
  }

  Store.prototype.createIncidentBackup = async function () {
    const store = window.store
    try {
      await incidentClient.createBackup()
      return await store.loadIncidentStorage()
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    }
  }

  Store.prototype.restoreIncidentBackup = async function (
    filename,
    confirmation
  ) {
    const store = window.store
    store.incidentSaving = true
    store.incidentError = ''
    try {
      const result = await incidentClient.restoreBackup(
        filename,
        confirmation
      )
      store.activeIncidentId = ''
      store.activeIncident = null
      await Promise.all([
        store.loadIncidentArchives({ page: 1 }),
        store.loadIncidentSummary(),
        store.loadIncidentStorage()
      ])
      return result
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentSaving = false
    }
  }
}
```

每个保存动作必须：

- 设置 `incidentSaving = true`。
- 清空旧错误。
- 成功后同时更新 `activeIncident`、当前页和 `incidentSummary`。
- 失败时保留表单当前内容，仅设置中文可读错误。
- `finally` 恢复 `incidentSaving = false`。

在 `store.js` 中导入并调用 `incidentArchivesExtend(Store)`，位置紧跟 `aiArtifactsExtend(Store)`。

- [ ] **Step 6: 运行 store 和导航测试**

```powershell
node --test test/unit-ci/incident-store.spec.js test/unit-ci/incident-navigation.spec.js
```

Expected: PASS.

- [ ] **Step 7: 提交 renderer 状态**

```powershell
git add src/client/store/init-state.js src/client/store/store.js src/client/store/incident-archives.js src/client/components/incidents/incident-navigation.js test/unit-ci/incident-store.spec.js test/unit-ci/incident-navigation.spec.js
git commit -m "feat: add incident archive workspace state"
```

---

### Task 6: 构建分页列表、筛选和空状态

**Files:**
- Create: `apps/electerm-agent/src/client/components/incidents/incident-list.jsx`
- Create: `apps/electerm-agent/src/client/components/incidents/incident-workspace.jsx`
- Create: `apps/electerm-agent/src/client/components/incidents/entry.jsx`
- Create: `apps/electerm-agent/src/client/components/incidents/incidents.styl`
- Test: `apps/electerm-agent/test/unit-ci/incident-ui.spec.js`

- [ ] **Step 1: 写列表分页和工作区结构失败测试**

使用 Babel AST 检查：

```js
assertJsxExists('components/incidents/incident-workspace.jsx', 'IncidentList')
assertJsxExists('components/incidents/incident-workspace.jsx', 'IncidentDetail')
assertJsxExists('components/incidents/incident-list.jsx', 'Pagination')
assertSourceMatches(
  'components/incidents/incident-list.jsx',
  /onChange=\{\(page, pageSize\) => store\.loadIncidentArchives/
)
assertSourceMatches(
  'components/incidents/incident-list.jsx',
  /shellpilotIncidentEmpty/
)
```

CSS 约束：

```js
assert.match(styles, /grid-template-columns\s+minmax\(260px,\s*340px\)\s+minmax\(0,\s*1fr\)/)
assert.match(styles, /border-radius\s+6px/)
assert.doesNotMatch(styles, /font-size\s+[2-9]\dpx/)
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

```powershell
node --test test/unit-ci/incident-ui.spec.js
```

Expected: FAIL because incident UI files do not exist.

- [ ] **Step 3: 实现列表组件**

列表工具栏包含：

- 搜索框，300ms 防抖。
- 服务器筛选，来源为 `store.bookmarks` 的 ID 和标题。
- 服务标签多选，选项来自当前查询结果中的 `serviceTags` 汇总。
- 状态多选。
- 严重程度多选。
- 自定义标签多选。
- 更新时间范围。
- “仅收藏”开关。
- “新建档案”主命令。
- “存储与备份”次命令。

列表项固定展示：

```jsx
<button
  type='button'
  className={classnames('incident-list-item', {
    active: item.id === store.activeIncidentId
  })}
  onClick={() => store.selectIncidentArchive(item.id)}
>
  <span className={`incident-severity incident-severity-${item.severity}`} />
  <span className='incident-list-copy'>
    <strong title={item.title}>{item.title}</strong>
    <small>{endpointTitle(item.endpointRef, store.bookmarks)}</small>
    <span>
      <Tag>{e(`shellpilotIncidentState_${item.state}`)}</Tag>
      <time>{formatIncidentTime(item.updatedAt)}</time>
    </span>
  </span>
</button>
```

分页固定使用后端 total：

```jsx
<Pagination
  current={store.incidentPage}
  pageSize={store.incidentPageSize}
  total={store.incidentTotal}
  showSizeChanger
  pageSizeOptions={[20, 40, 80]}
  onChange={(page, pageSize) => store.loadIncidentArchives({ page, pageSize })}
/>
```

- [ ] **Step 4: 实现工作区骨架和懒入口**

`incident-workspace.jsx` 在激活时加载列表和摘要，保留终端 DOM：

```jsx
useEffect(() => {
  if (!active) return
  store.loadIncidentArchives()
  store.loadIncidentSummary()
  focusIncidentWorkspace(true, workspaceRef.current)
}, [active])
```

工作区顶栏只保留标题、刷新、存储与备份、关闭四个命令。错误使用 Ant Design `Alert`，不得覆盖列表和详情。

`entry.jsx`：

```js
export { default } from './incident-workspace'
```

- [ ] **Step 5: 实现基础布局**

`incidents.styl` 基础：

```stylus
.incident-workspace
  display none
  position absolute
  z-index 7
  min-width 0
  min-height 0
  overflow hidden
  color var(--text)
  background var(--main)

.incident-workspace-active
  display flex
  flex-direction column

.incident-workspace-grid
  flex 1
  min-height 0
  display grid
  grid-template-columns minmax(260px, 340px) minmax(0, 1fr)

.incident-list-panel
  min-width 0
  overflow hidden
  display flex
  flex-direction column
  border-right 1px solid var(--main-darker)

.incident-list-scroll
  flex 1
  min-height 0
  overflow auto

.incident-list-item
  width 100%
  min-height 76px
  padding 10px
  border 1px solid transparent
  border-radius 6px
  color var(--text)
  background transparent
  text-align left
```

- [ ] **Step 6: 运行 UI 测试**

```powershell
node --test test/unit-ci/incident-ui.spec.js
```

Expected: PASS for list, pagination, workspace and style structure.

- [ ] **Step 7: 提交列表工作区**

```powershell
git add src/client/components/incidents/incident-list.jsx src/client/components/incidents/incident-workspace.jsx src/client/components/incidents/entry.jsx src/client/components/incidents/incidents.styl test/unit-ci/incident-ui.spec.js
git commit -m "feat: add incident archive list workspace"
```

---

### Task 7: 完成详情编辑、状态流转、备注和存储恢复 UI

**Files:**
- Create: `apps/electerm-agent/src/client/components/incidents/incident-detail.jsx`
- Create: `apps/electerm-agent/src/client/components/incidents/incident-storage-modal.jsx`
- Modify: `apps/electerm-agent/src/client/components/incidents/incident-workspace.jsx`
- Modify: `apps/electerm-agent/src/client/components/incidents/incidents.styl`
- Test: `apps/electerm-agent/test/unit-ci/incident-ui.spec.js`

- [ ] **Step 1: 增加详情与恢复安全测试**

```js
assertSourceMatches(
  'components/incidents/incident-detail.jsx',
  /shellpilotIncidentVerificationRequired/
)
assertSourceMatches(
  'components/incidents/incident-detail.jsx',
  /store\.transitionActiveIncident/
)
assertSourceMatches(
  'components/incidents/incident-detail.jsx',
  /store\.addActiveIncidentNote/
)
assertSourceMatches(
  'components/incidents/incident-storage-modal.jsx',
  /confirmation !== 'RESTORE'/
)
assertSourceMatches(
  'components/incidents/incident-storage-modal.jsx',
  /store\.restoreIncidentBackup/
)
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

```powershell
node --test test/unit-ci/incident-ui.spec.js
```

Expected: FAIL on missing detail and storage behavior.

- [ ] **Step 3: 实现创建与详情表单**

详情使用单层分区，不嵌套卡片：

1. 标题、服务器、严重程度、服务标签、自定义标签、收藏和置顶。
2. 故障摘要。
3. 根因与解决方案。
4. 状态和验证。
5. 文字记录。

表单使用本地 draft，只有点击“保存”时调用 `store.updateActiveIncident()`，输入过程中不得被 store 刷新覆盖。切换档案 ID 时重建 draft：

```js
useEffect(() => {
  setDraft(toIncidentDraft(incident))
  setDirty(false)
}, [incident?.id, incident?.updatedAt])
```

离开脏表单前用 `Modal.confirm` 提示保存或放弃。创建表单只要求标题，服务器、标签和摘要可选。

“收藏”和“置顶”分别写入 `isFavorite`、`isPinned`；置顶档案始终按 `isPinned DESC, updatedAt DESC` 排在当前筛选结果前面，收藏筛选只使用 `is_favorite = 1`，不得在 renderer 读取全部档案后再过滤。

- [ ] **Step 4: 实现状态动作和验证门禁**

状态区根据当前状态只显示合法的下一步：

```js
const transitionActions = {
  investigating: ['waiting_action', 'verifying', 'unresolved', 'false_positive'],
  waiting_action: ['investigating', 'verifying', 'unresolved'],
  verifying: ['investigating', 'resolved', 'unresolved', 'false_positive'],
  resolved: ['archived', 'investigating'],
  unresolved: ['archived', 'investigating'],
  false_positive: ['archived', 'investigating'],
  archived: ['investigating']
}
```

点击 `resolved` 必须先弹出验证方式选择：

```jsx
<Select
  value={verificationStatus}
  options={[
    { value: 'passed_manual', label: e('shellpilotIncidentManualVerification') },
    { value: 'passed_auto', label: e('shellpilotIncidentAutomaticVerification') }
  ]}
/>
```

选择“临时缓解”发送：

```js
{
  state: 'unresolved',
  verificationStatus: 'mitigated'
}
```

- [ ] **Step 5: 实现备注**

备注输入上限 20,000 字，`Ctrl+Enter` 保存，空文本不发送。每条备注显示创建时间和删除图标；删除前使用轻量确认，不需要 SSH 风险确认。

- [ ] **Step 6: 实现存储与备份 Modal**

Modal 展示：

- 数据库、WAL、备份占用。
- 备份数量和最近备份时间。
- “立即备份”按钮。
- 最近 5 个备份。
- “恢复”按钮。

恢复时必须输入 `RESTORE`，按钮在文本不匹配时禁用：

```js
const canRestore = confirmation === 'RESTORE'
```

恢复成功后关闭 Modal，重新加载当前页和首页摘要；失败时保留 Modal 和备份选择。

- [ ] **Step 7: 运行 UI 测试**

```powershell
node --test test/unit-ci/incident-ui.spec.js
```

Expected: PASS for edit draft, transition gate, notes and restore confirmation.

- [ ] **Step 8: 提交详情和存储 UI**

```powershell
git add src/client/components/incidents/incident-detail.jsx src/client/components/incidents/incident-storage-modal.jsx src/client/components/incidents/incident-workspace.jsx src/client/components/incidents/incidents.styl test/unit-ci/incident-ui.spec.js
git commit -m "feat: add incident detail and backup controls"
```

---

### Task 8: 接入主工作区、左侧入口和首页摘要

**Files:**
- Create: `apps/electerm-agent/src/client/components/incidents/incident-home-summary.jsx`
- Modify: `apps/electerm-agent/src/client/components/main/main.jsx`
- Modify: `apps/electerm-agent/src/client/components/sidebar/index.jsx`
- Modify: `apps/electerm-agent/src/client/components/tabs/no-session.jsx`
- Test: `apps/electerm-agent/test/unit-ci/incident-ui.spec.js`

- [ ] **Step 1: 写主界面集成失败测试**

AST 断言：

```js
assertLazyImport(
  'components/main/main.jsx',
  'IncidentArchiveWorkspace',
  '../incidents/entry'
)
assertSourceMatches(
  'components/main/main.jsx',
  /store\.mainWorkspaceMode === 'incident-archives'/
)
assertSourceMatches(
  'components/sidebar/index.jsx',
  /shellpilotSidebarIncidents/
)
assertSourceMatches(
  'components/tabs/no-session.jsx',
  /<IncidentHomeSummary/
)
```

同时断言 `Layout` 仍无条件挂载，`IncidentArchiveWorkspace` 在 `Layout` 后渲染，AI 右栏在档案工作区外：

```js
assert.ok(layout.node.start < incidentWorkspace.node.start)
assert.ok(incidentWorkspace.node.start < rightPanel.node.start)
assert.equal(layoutIsConditional, false)
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

```powershell
node --test test/unit-ci/incident-ui.spec.js
```

Expected: FAIL on missing main, sidebar and home integration.

- [ ] **Step 3: 接入 main.jsx**

新增懒加载：

```js
const IncidentArchiveWorkspace = lazy(() => import('../incidents/entry'))
```

模式：

```js
const incidentWorkspaceActive = store.mainWorkspaceMode === 'incident-archives'
const nonTerminalWorkspaceActive = fleetStatusActive ||
  artifactWorkspaceActive ||
  incidentWorkspaceActive
```

AI scope：

```js
const aiConversationScopeId = fleetStatusActive
  ? 'fleet-status'
  : artifactWorkspaceActive
    ? 'artifacts'
    : incidentWorkspaceActive
      ? `incident:${store.activeIncidentId || 'workspace'}`
      : String(activeTabId || 'global')
```

终端 layer class 增加 `incident-archives-active`。使用现有 `LazyModuleBoundary` 包裹故障档案工作区，模块加载失败只显示“重新加载模块”，不得白屏或卸载 SSH 会话。

- [ ] **Step 4: 增加左侧图标**

在“成果物”和“服务器”之间增加 `AlertOutlined` 图标：

```jsx
<SideIcon
  title={e('shellpilotSidebarIncidents')}
  label={e('shellpilotSidebarIncidents')}
  active={incidentWorkspaceActive}
  onClick={() => store.openIncidentArchiveWorkspace()}
>
  <AlertOutlined className='font20 iblock control-icon' />
</SideIcon>
```

打开服务器、历史或 SFTP 时，现有 `beginTerminalWorkspaceIntent`/`closeFleetStatus()` 会把 `mainWorkspaceMode` 恢复为 `terminal`。增加测试确认不会删除或重建终端 tab。

- [ ] **Step 5: 实现首页未解决摘要**

`incident-home-summary.jsx` 只在无会话首页挂载后调用一次 `store.loadIncidentSummary()`：

```jsx
export default auto(function IncidentHomeSummary ({ store }) {
  useEffect(() => {
    store.loadIncidentSummary()
  }, [])
  const summary = store.incidentSummary
  if (!summary || !summary.unresolvedCount) return null
  return (
    <section className='incident-home-summary'>
      <button
        type='button'
        onClick={() => store.openIncidentArchiveWorkspace()}
      >
        <AlertOutlined />
        <span>
          <strong>{e('shellpilotIncidentUnresolvedSummary')}</strong>
          <small>{summary.unresolvedCount}</small>
        </span>
      </button>
      {summary.recentUnresolved.map(item => (
        <button
          type='button'
          key={item.id}
          onClick={() => store.openIncidentArchiveWorkspace(item.id)}
        >
          {item.title}
        </button>
      ))}
    </section>
  )
})
```

首页摘要不显示“最近复发”，该指标依赖阶段 3 的相似故障匹配。

- [ ] **Step 6: 运行 UI 测试**

```powershell
node --test test/unit-ci/incident-ui.spec.js
```

Expected: PASS; terminal `Layout` remains mounted.

- [ ] **Step 7: 提交主界面集成**

```powershell
git add src/client/components/incidents/incident-home-summary.jsx src/client/components/main/main.jsx src/client/components/sidebar/index.jsx src/client/components/tabs/no-session.jsx test/unit-ci/incident-ui.spec.js
git commit -m "feat: integrate incident archives into shell workspace"
```

---

### Task 9: 完成中文、帮助文档、主题和窄屏布局

**Files:**
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- Modify: `apps/electerm-agent/src/client/components/incidents/incidents.styl`
- Test: `apps/electerm-agent/test/unit-ci/incident-ui.spec.js`

- [ ] **Step 1: 写中文键、英文回退和布局失败测试**

```js
for (const key of [
  'shellpilotSidebarIncidents',
  'shellpilotIncidentWorkspaceTitle',
  'shellpilotIncidentNew',
  'shellpilotIncidentEmpty',
  'shellpilotIncidentStorage',
  'shellpilotIncidentVerificationRequired',
  'shellpilotIncidentRestoreConfirmation'
]) {
  assertLocaleKeyExists('zh_cn', key)
  assertLocaleKeyExists('en_us', key)
}
assert.match(styles, /@media \(max-width: 1180px\)/)
assert.match(styles, /@media \(max-height: 760px\)/)
assert.doesNotMatch(incidentSources, /\b(?:Loading|Retry|Restore|Storage|Incident)\b/)
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

```powershell
node --test test/unit-ci/incident-ui.spec.js
```

Expected: FAIL on missing locale/help/responsive coverage.

- [ ] **Step 3: 添加中英文文案**

中文必须统一使用：

- 故障档案
- 排查中
- 等待操作
- 验证中
- 已解决
- 未解决
- 已归档
- 误报
- 存储与备份
- 立即备份
- 恢复备份
- 输入 RESTORE 确认恢复

英文只作为语言切换回退，不得出现在中文界面。

- [ ] **Step 4: 更新帮助中心**

新增“故障档案”章节，明确：

1. 如何手动建档。
2. 如何按服务器、服务、状态、严重程度、标签、更新时间、收藏和关键词筛选。
3. 如何从排查中流转到验证、解决和归档。
4. 已解决必须选择人工或自动验证。
5. 如何备份和恢复。
6. 档案不保存 SSH 密码、私钥和 API Key。
7. 一期为本地档案，证据接入、报告和跨设备同步不在当前版本中。

- [ ] **Step 5: 优化 1366 和缩放布局**

```stylus
@media (max-width: 1180px)
  .incident-workspace-grid
    grid-template-columns minmax(240px, 300px) minmax(0, 1fr)

  .incident-workspace-header p
    display none

@media (max-width: 900px)
  .incident-workspace-grid
    grid-template-columns 1fr

  .incident-list-panel.has-active-detail
    display none

  .incident-detail-back
    display inline-flex

@media (max-height: 760px)
  .incident-workspace-header
    min-height 50px
    padding 8px 12px

  .incident-detail
    padding 12px
```

所有禁用文字使用 `var(--text-light)` 并保持与背景可辨识；状态颜色同时有文字，不只依赖红绿颜色。按钮文字不得换成竖排。

- [ ] **Step 6: 运行 UI 测试和 lint**

```powershell
node --test test/unit-ci/incident-ui.spec.js
npx standard src/client/components/incidents/*.js src/client/components/incidents/*.jsx src/client/store/incident-archives.js src/app/lib/incidents/*.js
```

Expected: all tests PASS; Standard exits 0.

- [ ] **Step 7: 提交中文和响应式体验**

```powershell
git add src/client/common/shellpilot-i18n-overrides.js src/client/components/main/help-center-modal.jsx src/client/components/incidents/incidents.styl test/unit-ci/incident-ui.spec.js
git commit -m "feat: polish incident archive localization and layout"
```

---

### Task 10: 建立 E2E、10,000 条门禁和核心回归

**Files:**
- Create: `apps/electerm-agent/test/e2e/034.incident-archive-foundation.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/incident-repository.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/incident-ui.spec.js`

- [ ] **Step 1: 写端到端完整状态流转**

Playwright 流程：

```js
test('creates, resolves, archives and reopens an incident', async ({ page }) => {
  await launchShellPilot(page)
  await page.getByLabel('故障档案').click()
  await page.getByRole('button', { name: '新建档案' }).click()
  await page.getByLabel('标题').fill('Nginx 502 回归验证')
  await page.getByLabel('严重程度').click()
  await page.getByText('高').click()
  await page.getByRole('button', { name: '创建' }).click()

  await page.getByRole('button', { name: '进入验证' }).click()
  await page.getByRole('button', { name: '标记已解决' }).click()
  await page.getByLabel('验证方式').click()
  await page.getByText('人工验证通过').click()
  await page.getByRole('button', { name: '确认' }).click()
  await expect(page.getByText('已解决')).toBeVisible()

  await page.getByRole('button', { name: '归档' }).click()
  await expect(page.getByText('已归档')).toBeVisible()
  await page.getByRole('button', { name: '重新打开' }).click()
  await expect(page.getByText('排查中')).toBeVisible()
})
```

- [ ] **Step 2: 写持久化、筛选和首页摘要 E2E**

覆盖：

- 重启客户端后档案仍存在。
- 搜索标题、摘要和文字记录。
- 服务器、服务标签、状态、严重程度、自定义标签、时间范围和仅收藏筛选。
- 翻页后选择和总数正确。
- 无会话首页显示未解决数量，点击进入对应详情。
- 进入档案工作区时已有 SSH tab 不断开、不丢失。
- 清空或禁用模型 API 配置后，手动建档、编辑、备注、搜索和备份仍可使用，界面不要求连接 AI。

- [ ] **Step 3: 写日间/夜间和尺寸矩阵**

至少验证：

```js
const viewports = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
]
const themes = ['light', 'dark']
```

断言：

- 无水平页面滚动。
- 列表和详情有独立纵向滚动。
- 搜索、状态选择和主按钮文字完整可见。
- 900px 以下详情提供返回列表按钮。
- Error Alert 文字与背景对比清晰。

- [ ] **Step 4: 运行故障档案单元测试**

```powershell
node --test test/unit-ci/incident-*.spec.js
```

Expected: PASS, including 10,000-row test.

- [ ] **Step 5: 运行故障档案 E2E**

```powershell
npx playwright test test/e2e/034.incident-archive-foundation.spec.js --workers=1
```

Expected: PASS.

- [ ] **Step 6: 运行核心回归**

```powershell
node --test test/unit-ci/fleet-status-navigation.spec.js test/unit-ci/ai-artifact-store.spec.js test/unit-ci/operations-toolkit-*.spec.js test/unit-ci/ssh-tunnel-*.spec.js
npx playwright test test/e2e/026.primary-workspace-regression.spec.js test/e2e/027.quality-core-flows.spec.js test/e2e/028.crash-recovery.spec.js test/e2e/032.operations-toolkit.spec.js test/e2e/033.ssh-tunnel-manager.spec.js --workers=1
```

Expected: all selected regressions PASS; no SSH/SFTP/AI workspace regression.

- [ ] **Step 7: 提交测试门禁**

```powershell
git add test/e2e/034.incident-archive-foundation.spec.js test/unit-ci/incident-repository.spec.js test/unit-ci/incident-ui.spec.js
git commit -m "test: gate incident archive foundation"
```

---

### Task 11: 完整自检、构建和发布前验收

**Files:**
- Modify only if verification finds a concrete defect in files already listed above.

- [ ] **Step 1: 运行全部单元测试**

```powershell
npm run test-unit-ci
```

Expected: all tests PASS, no skipped incident tests.

- [ ] **Step 2: 运行 lint**

```powershell
npm run lint
```

Expected: exit 0.

- [ ] **Step 3: 构建前端**

```powershell
npm run compile
```

Expected: build completes; no missing lazy chunk and no circular dependency failure.

- [ ] **Step 4: 验证首次终端性能不回退**

```powershell
npm run test-performance-e2e
```

Expected: existing startup and first-terminal thresholds PASS. 未打开故障档案时，`incident-archives/incidents.db` 不应因应用启动而被创建；只有点击故障档案或无会话首页请求摘要时才初始化。

- [ ] **Step 5: 运行现有质量、崩溃恢复和真实服务器只读回归**

```powershell
npm run test-quality-e2e
npm run test-agent-readonly-real-server
```

Expected: PASS. 真实服务器测试只执行只读命令，不修改服务器。

- [ ] **Step 6: 本地打包并执行包冒烟**

```powershell
npm run b
npm run test-package-smoke
```

Expected: Windows 包可启动；故障档案可创建、关闭后重开仍存在；SSH 连接、SFTP、AI 配置、更新检查和窗口控制保持可用。

- [ ] **Step 7: 检查版本与变更范围**

```powershell
git status --short
git diff --check
git log --oneline --decorate -12
```

Expected:

- 工作树只包含本计划相关变更。
- `git diff --check` 无输出。
- 没有修改 `src/client/components/terminal`、`src/client/components/sftp` 或 SSH 连接核心文件。
- 在线更新发布前保留上一稳定版本资产；本任务不覆盖旧版本。

- [ ] **Step 8: 提交仅由验收发现的修复**

只有 Step 1-7 实际发现问题时才创建此提交：

```powershell
git add src/app/lib/incidents
git add src/app/lib/ipc.js
git add src/client/components/incidents
git add src/client/store/incident-archives.js
git add src/client/store/init-state.js
git add src/client/store/store.js
git add src/client/components/main/main.jsx
git add src/client/components/main/help-center-modal.jsx
git add src/client/components/sidebar/index.jsx
git add src/client/components/tabs/no-session.jsx
git add src/client/common/shellpilot-i18n-overrides.js
git add test/unit-ci/incident-model.spec.js
git add test/unit-ci/incident-database.spec.js
git add test/unit-ci/incident-repository.spec.js
git add test/unit-ci/incident-ipc.spec.js
git add test/unit-ci/incident-store.spec.js
git add test/unit-ci/incident-navigation.spec.js
git add test/unit-ci/incident-ui.spec.js
git add test/e2e/034.incident-archive-foundation.spec.js
git commit -m "fix: close incident archive release blockers"
```

- [ ] **Step 9: 输出验收记录**

在任务结果中记录：

- 单元测试数量和结果。
- E2E 文件和结果。
- 10,000 条分页耗时。
- compile 和 package smoke 结果。
- 1366×768、1920×1080、日间和夜间截图路径。
- SSH/SFTP/AI/更新核心回归结果。
- 数据库备份和恢复验证结果。

只有这些证据齐全后，才进入独立版本发布流程。
