# ShellPilot Multi-Level Server Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-level server groups fully usable from the server sidebar, quick connection wizard, and recent connection history without replacing the existing bookmark database.

**Architecture:** Keep `bookmarks` and `bookmarkGroups` as the only persisted connection data. Add a pure membership module that owns assignment, repair, safe movement, and inline group creation; expose it through Store methods; then reuse those methods from every UI entry. Preserve the existing tree implementation and add management capabilities to the sidebar through explicit props instead of changing normal connection selection behavior.

**Tech Stack:** Electron 41, React 19, Manate Store, Ant Design 6, Stylus, Node test runner, Playwright Electron E2E.

---

## File Map

**Create**

- `apps/electerm-agent/src/client/common/bookmark-membership.js`: pure server-to-group membership, repair, rollback snapshots, and inline group creation.
- `apps/electerm-agent/src/client/components/bookmark-form/common/bookmark-group-picker.jsx`: reusable multi-level group picker with inline group creation.
- `apps/electerm-agent/src/client/components/bookmark-form/common/bookmark-group-picker.styl`: compact day/night-safe picker layout.
- `apps/electerm-agent/test/unit-ci/bookmark-membership.spec.js`: behavior tests for unique membership, repair, movement, and creation.
- `apps/electerm-agent/test/unit-ci/bookmark-group-entry-contract.spec.js`: source contracts that require quick connection, history, and sidebar to use shared Store methods.

**Modify**

- `apps/electerm-agent/src/client/store/bookmark-group.js`: Store adapters for create, assign, move, repair, and last-group preference.
- `apps/electerm-agent/src/client/components/tabs/quick-connect-wizard.jsx`: target-group selection and atomic save.
- `apps/electerm-agent/src/client/components/tabs/quick-connect.styl`: wizard group field spacing and narrow-window layout.
- `apps/electerm-agent/src/client/components/bookmark-form/bookmark-from-history-modal.jsx`: useful save form instead of raw JSON.
- `apps/electerm-agent/src/client/components/sidebar/history-item.jsx`: visible save state and right-click save action.
- `apps/electerm-agent/src/client/components/sidebar/bookmark-select.jsx`: enable management tools while retaining connection-on-click behavior.
- `apps/electerm-agent/src/client/components/tree-list/tree-list.jsx`: explicit `managementEnabled` behavior and shared movement.
- `apps/electerm-agent/src/client/components/tree-list/tree-list-row.jsx`: management-aware context menus.
- `apps/electerm-agent/src/client/components/tree-list/tree-item-op.jsx`: management-aware group and server actions.
- `apps/electerm-agent/src/client/components/tree-list/bookmark-context-menu.js`: full management menu in server sidebar.
- `apps/electerm-agent/src/client/components/bookmark-form/tree-select.jsx`: batch move mode with target group.
- `apps/electerm-agent/src/client/components/tree-list/bookmark-toolbar.jsx`: separate batch move and batch delete commands.
- `apps/electerm-agent/src/client/common/bookmark-deletion.js`: impact summary for non-empty group deletion.
- `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`: Chinese labels and matching English fallback labels.
- `apps/electerm-agent/test/e2e/021.basic.bookmarks-groups.spec.js`: complete group lifecycle and move coverage.
- `apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js`: day/night and viewport visual assertions.

### Task 1: Pure Membership and Repair Rules

**Files:**
- Create: `apps/electerm-agent/src/client/common/bookmark-membership.js`
- Create: `apps/electerm-agent/test/unit-ci/bookmark-membership.spec.js`

- [ ] **Step 1: Write the failing membership tests**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/bookmark-membership.js'
)).href

test('assignBookmarkToGroup keeps exactly one real group membership', async () => {
  const { assignBookmarkToGroup } = await import(moduleUrl)
  const groups = [
    { id: 'default', bookmarkIds: ['server-1'], bookmarkGroupIds: ['prod'] },
    { id: 'prod', bookmarkIds: ['server-1'], bookmarkGroupIds: [] }
  ]

  const result = assignBookmarkToGroup(groups, 'server-1', 'prod', 'default')

  assert.deepEqual(result, { groupId: 'prod', changed: true })
  assert.deepEqual(groups[0].bookmarkIds, [])
  assert.deepEqual(groups[1].bookmarkIds, ['server-1'])
})

test('repairBookmarkMembership removes stale and duplicate references and assigns strays', async () => {
  const { repairBookmarkMembership } = await import(moduleUrl)
  const bookmarks = [{ id: 'server-1' }, { id: 'server-2' }]
  const groups = [
    {
      id: 'default',
      bookmarkIds: ['missing', 'server-1'],
      bookmarkGroupIds: ['prod', 'missing-group']
    },
    { id: 'prod', bookmarkIds: ['server-1'], bookmarkGroupIds: [] }
  ]

  const result = repairBookmarkMembership(bookmarks, groups, 'default')

  assert.deepEqual(groups[0].bookmarkIds, ['server-1', 'server-2'])
  assert.deepEqual(groups[0].bookmarkGroupIds, ['prod'])
  assert.deepEqual(groups[1].bookmarkIds, [])
  assert.deepEqual(result, {
    duplicateMembershipsRemoved: 1,
    staleBookmarkReferencesRemoved: 1,
    staleGroupReferencesRemoved: 1,
    straysAssigned: 1
  })
})

test('createBookmarkGroupInParent rejects same-level duplicates and creates nested groups', async () => {
  const { createBookmarkGroupInParent } = await import(moduleUrl)
  const groups = [
    { id: 'default', title: '未分组', bookmarkIds: [], bookmarkGroupIds: [] },
    { id: 'prod', title: '生产环境', bookmarkIds: [], bookmarkGroupIds: [] }
  ]

  assert.throws(
    () => createBookmarkGroupInParent(groups, {
      id: 'duplicate',
      title: ' 生产环境 ',
      parentId: null
    }),
    error => error.code === 'DUPLICATE_GROUP_TITLE'
  )

  const group = createBookmarkGroupInParent(groups, {
    id: 'web',
    title: ' Web服务器 ',
    parentId: 'prod',
    color: '#0088cc'
  })

  assert.equal(group.title, 'Web服务器')
  assert.equal(group.level, 2)
  assert.deepEqual(groups.find(item => item.id === 'prod').bookmarkGroupIds, ['web'])
})
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run:

```powershell
node --test test/unit-ci/bookmark-membership.spec.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `bookmark-membership.js`.

- [ ] **Step 3: Implement the pure membership module**

```js
function unique (items = []) {
  return [...new Set(items.filter(Boolean))]
}

function errorWithCode (message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function requireGroup (groups, groupId, defaultGroupId) {
  return groups.find(group => group.id === groupId) ||
    groups.find(group => group.id === defaultGroupId) ||
    null
}

export function cloneBookmarkMembership (groups = []) {
  return groups.map(group => ({
    id: group.id,
    bookmarkIds: [...(group.bookmarkIds || [])],
    bookmarkGroupIds: [...(group.bookmarkGroupIds || [])]
  }))
}

export function restoreBookmarkMembership (groups = [], snapshot = []) {
  for (const group of groups) {
    const before = snapshot.find(item => item.id === group.id)
    if (!before) continue
    group.bookmarkIds = [...before.bookmarkIds]
    group.bookmarkGroupIds = [...before.bookmarkGroupIds]
  }
}

export function assignBookmarkToGroup (
  groups = [],
  bookmarkId,
  groupId,
  defaultGroupId = 'default'
) {
  if (!bookmarkId) {
    throw errorWithCode('Bookmark id is required', 'BOOKMARK_ID_REQUIRED')
  }
  const target = requireGroup(groups, groupId, defaultGroupId)
  if (!target) {
    throw errorWithCode('Bookmark group does not exist', 'GROUP_NOT_FOUND')
  }
  let changed = false
  for (const group of groups) {
    const before = group.bookmarkIds || []
    const next = before.filter(id => id !== bookmarkId)
    if (next.length !== before.length) changed = true
    group.bookmarkIds = next
  }
  const nextTarget = unique([...(target.bookmarkIds || []), bookmarkId])
  if (!target.bookmarkIds?.includes(bookmarkId)) changed = true
  target.bookmarkIds = nextTarget
  return { groupId: target.id, changed }
}

export function moveBookmarksToGroup (
  groups = [],
  bookmarkIds = [],
  groupId,
  defaultGroupId = 'default'
) {
  const snapshot = cloneBookmarkMembership(groups)
  try {
    const moved = unique(bookmarkIds).map(bookmarkId =>
      assignBookmarkToGroup(groups, bookmarkId, groupId, defaultGroupId)
    )
    return { groupId: moved[0]?.groupId || groupId, moved: moved.length }
  } catch (error) {
    restoreBookmarkMembership(groups, snapshot)
    throw error
  }
}

export function repairBookmarkMembership (
  bookmarks = [],
  groups = [],
  defaultGroupId = 'default'
) {
  const counters = {
    duplicateMembershipsRemoved: 0,
    staleBookmarkReferencesRemoved: 0,
    staleGroupReferencesRemoved: 0,
    straysAssigned: 0
  }
  const bookmarkIds = new Set(bookmarks.map(item => item.id))
  const groupIds = new Set(groups.map(item => item.id))
  const assigned = new Set()

  for (const group of groups) {
    const validBookmarks = []
    for (const id of unique(group.bookmarkIds)) {
      if (!bookmarkIds.has(id)) {
        counters.staleBookmarkReferencesRemoved++
      } else if (assigned.has(id)) {
        counters.duplicateMembershipsRemoved++
      } else {
        assigned.add(id)
        validBookmarks.push(id)
      }
    }
    group.bookmarkIds = validBookmarks
    const beforeChildren = unique(group.bookmarkGroupIds)
    group.bookmarkGroupIds = beforeChildren.filter(id =>
      id !== group.id && groupIds.has(id)
    )
    counters.staleGroupReferencesRemoved +=
      beforeChildren.length - group.bookmarkGroupIds.length
  }

  const target = requireGroup(groups, defaultGroupId, defaultGroupId)
  if (target) {
    for (const id of bookmarkIds) {
      if (!assigned.has(id)) {
        target.bookmarkIds.push(id)
        counters.straysAssigned++
      }
    }
    target.bookmarkIds = unique(target.bookmarkIds)
  }
  return counters
}

export function createBookmarkGroupInParent (groups = [], input = {}) {
  const title = String(input.title || '').trim()
  if (!title) {
    throw errorWithCode('Group title is required', 'GROUP_TITLE_REQUIRED')
  }
  const parent = input.parentId
    ? groups.find(group => group.id === input.parentId)
    : null
  if (input.parentId && !parent) {
    throw errorWithCode('Parent group does not exist', 'PARENT_GROUP_NOT_FOUND')
  }
  const siblingIds = new Set(parent?.bookmarkGroupIds || [])
  const duplicate = groups.some(group =>
    group.title === title &&
    (parent ? siblingIds.has(group.id) : !groups.some(item =>
      (item.bookmarkGroupIds || []).includes(group.id)
    ))
  )
  if (duplicate) {
    throw errorWithCode('Duplicate group title', 'DUPLICATE_GROUP_TITLE')
  }
  const group = {
    id: input.id,
    title,
    bookmarkIds: [],
    bookmarkGroupIds: [],
    color: input.color
  }
  if (parent) {
    group.level = (parent.level || 1) + 1
    parent.bookmarkGroupIds = unique([...(parent.bookmarkGroupIds || []), group.id])
  }
  groups.push(group)
  return group
}
```

- [ ] **Step 4: Run the focused test**

Run:

```powershell
node --test test/unit-ci/bookmark-membership.spec.js
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit the pure data layer**

```powershell
git add apps/electerm-agent/src/client/common/bookmark-membership.js apps/electerm-agent/test/unit-ci/bookmark-membership.spec.js
git commit -m "feat: unify server group membership rules"
```

### Task 2: Store Adapters and Idempotent Data Repair

**Files:**
- Modify: `apps/electerm-agent/src/client/store/bookmark-group.js`
- Create: `apps/electerm-agent/test/unit-ci/bookmark-group-entry-contract.spec.js`

- [ ] **Step 1: Write the failing Store contract**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

test('bookmark group store exposes shared save, move, create and repair entries', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/store/bookmark-group.js'),
    'utf8'
  )

  assert.match(source, /Store\.prototype\.saveBookmarkInGroup/)
  assert.match(source, /Store\.prototype\.moveBookmarksToGroup/)
  assert.match(source, /Store\.prototype\.createBookmarkGroup/)
  assert.match(source, /repairBookmarkMembership/)
  assert.match(source, /cloneBookmarkMembership/)
  assert.match(source, /restoreBookmarkMembership/)
})
```

- [ ] **Step 2: Run the contract and verify it fails**

Run:

```powershell
node --test test/unit-ci/bookmark-group-entry-contract.spec.js
```

Expected: FAIL because the Store methods do not exist.

- [ ] **Step 3: Add Store adapters**

Import the pure helpers and add these methods:

```js
import uid from '../common/uid'
import { getRandomDefaultColor } from '../common/rand-hex-color.js'
import {
  assignBookmarkToGroup,
  cloneBookmarkMembership,
  createBookmarkGroupInParent,
  moveBookmarksToGroup as moveMembership,
  repairBookmarkMembership,
  restoreBookmarkMembership
} from '../common/bookmark-membership'

Store.prototype.saveBookmarkInGroup = function (bookmark, groupId) {
  const { store } = window
  const snapshot = cloneBookmarkMembership(store.bookmarkGroups)
  try {
    store.addItem(bookmark, settingMap.bookmarks)
    const result = assignBookmarkToGroup(
      store.bookmarkGroups,
      bookmark.id,
      groupId,
      defaultBookmarkGroupId
    )
    store.rememberLastBookmarkGroup(result.groupId)
    return { bookmark, groupId: result.groupId }
  } catch (error) {
    store.delItem({ id: bookmark.id }, settingMap.bookmarks)
    restoreBookmarkMembership(store.bookmarkGroups, snapshot)
    throw error
  }
}

Store.prototype.moveBookmarksToGroup = function (bookmarkIds, groupId) {
  const { store } = window
  const result = moveMembership(
    store.bookmarkGroups,
    bookmarkIds,
    groupId,
    defaultBookmarkGroupId
  )
  store.rememberLastBookmarkGroup(result.groupId)
  return result
}

Store.prototype.createBookmarkGroup = function ({ title, parentId, color }) {
  return createBookmarkGroupInParent(window.store.bookmarkGroups, {
    id: uid(),
    title,
    parentId,
    color: color || getRandomDefaultColor()
  })
}

Store.prototype.rememberLastBookmarkGroup = function (groupId) {
  const valid = window.store.bookmarkGroups.some(group => group.id === groupId)
    ? groupId
    : defaultBookmarkGroupId
  window.localStorage?.setItem('shellpilot-last-bookmark-group-id', valid)
  return valid
}

Store.prototype.getLastBookmarkGroup = function () {
  const saved = window.localStorage?.getItem('shellpilot-last-bookmark-group-id')
  return window.store.bookmarkGroups.some(group => group.id === saved)
    ? saved
    : defaultBookmarkGroupId
}
```

Replace the hand-written membership portion in `fixBookmarkGroups` with:

```js
const result = repairBookmarkMembership(
  store.bookmarks,
  store.bookmarkGroups,
  defaultBookmarkGroupId
)
removeCyclicBookmarkGroupIds(store.bookmarkGroups)
return result
```

- [ ] **Step 4: Run the membership and Store tests**

Run:

```powershell
node --test test/unit-ci/bookmark-membership.spec.js test/unit-ci/bookmark-group-entry-contract.spec.js test/unit-ci/bookmark-group.spec.js
```

Expected: PASS.

- [ ] **Step 5: Commit the Store integration**

```powershell
git add apps/electerm-agent/src/client/store/bookmark-group.js apps/electerm-agent/test/unit-ci/bookmark-group-entry-contract.spec.js
git commit -m "feat: expose atomic server group operations"
```

### Task 3: Reusable Multi-Level Group Picker

**Files:**
- Create: `apps/electerm-agent/src/client/components/bookmark-form/common/bookmark-group-picker.jsx`
- Create: `apps/electerm-agent/src/client/components/bookmark-form/common/bookmark-group-picker.styl`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/bookmark-group-entry-contract.spec.js`

- [ ] **Step 1: Extend the failing contract for the picker**

```js
test('group picker supports nested selection and inline creation', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/bookmark-form/common/bookmark-group-picker.jsx'),
    'utf8'
  )

  assert.match(source, /formatBookmarkGroups/)
  assert.match(source, /treeDefaultExpandAll/)
  assert.match(source, /store\.createBookmarkGroup/)
  assert.match(source, /shellpilotCreateServerGroup/)
  assert.match(source, /shellpilotParentGroup/)
})
```

- [ ] **Step 2: Run the contract and verify the picker is missing**

Run:

```powershell
node --test test/unit-ci/bookmark-group-entry-contract.spec.js
```

Expected: FAIL with `ENOENT` for `bookmark-group-picker.jsx`.

- [ ] **Step 3: Implement the picker**

```jsx
import { useState } from 'react'
import { Button, Input, Modal, Space, TreeSelect } from 'antd'
import { FolderAddOutlined } from '@ant-design/icons'
import { auto } from 'manate/react'
import formatBookmarkGroups from './bookmark-group-tree-format'
import message from '../../common/message'
import './bookmark-group-picker.styl'

const e = window.translate

export default auto(function BookmarkGroupPicker ({
  value,
  onChange,
  allowCreate = true,
  className = ''
}) {
  const { store } = window
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [parentId, setParentId] = useState(value || 'default')
  const treeData = formatBookmarkGroups(store.bookmarkGroups)

  function createGroup () {
    try {
      const group = store.createBookmarkGroup({ title, parentId })
      onChange?.(group.id)
      setTitle('')
      setCreating(false)
    } catch (error) {
      const key = error.code === 'DUPLICATE_GROUP_TITLE'
        ? 'shellpilotDuplicateServerGroup'
        : 'shellpilotCreateServerGroupFailed'
      message.error(e(key))
    }
  }

  return (
    <div className={`bookmark-group-picker ${className}`}>
      <Space.Compact className='width-100'>
        <TreeSelect
          value={value}
          onChange={onChange}
          treeData={treeData}
          treeDefaultExpandAll
          showSearch
          placeholder={e('shellpilotSelectServerGroup')}
          className='bookmark-group-picker-select'
        />
        {allowCreate
          ? (
            <Button
              icon={<FolderAddOutlined />}
              title={e('shellpilotCreateServerGroup')}
              onClick={() => setCreating(true)}
            />
            )
          : null}
      </Space.Compact>
      <Modal
        open={creating}
        title={e('shellpilotCreateServerGroup')}
        okText={e('create')}
        cancelText={e('cancel')}
        okButtonProps={{ disabled: !title.trim() }}
        onOk={createGroup}
        onCancel={() => setCreating(false)}
      >
        <label>{e('name')}</label>
        <Input value={title} onChange={event => setTitle(event.target.value)} autoFocus />
        <label>{e('shellpilotParentGroup')}</label>
        <TreeSelect
          value={parentId || undefined}
          onChange={setParentId}
          treeData={treeData}
          treeDefaultExpandAll
          showSearch
          className='width-100'
        />
      </Modal>
    </div>
  )
})
```

Add Chinese and English keys:

```js
shellpilotSelectServerGroup: '选择服务器分组',
shellpilotCreateServerGroup: '新建分组',
shellpilotParentGroup: '上级分组',
shellpilotDuplicateServerGroup: '同一级已存在同名分组',
shellpilotCreateServerGroupFailed: '创建分组失败'
```

```js
shellpilotSelectServerGroup: 'Select server group',
shellpilotCreateServerGroup: 'New group',
shellpilotParentGroup: 'Parent group',
shellpilotDuplicateServerGroup: 'A group with this name already exists here',
shellpilotCreateServerGroupFailed: 'Failed to create group'
```

- [ ] **Step 4: Add compact layout styles**

```stylus
.bookmark-group-picker
  width 100%

.bookmark-group-picker-select
  min-width 0
  flex 1

.bookmark-group-picker label
  display block
  margin 12px 0 6px
  color var(--secondary-text-color)
```

- [ ] **Step 5: Run contracts and lint the new component**

Run:

```powershell
node --test test/unit-ci/bookmark-group-entry-contract.spec.js
npx standard src/client/common/bookmark-membership.js src/client/store/bookmark-group.js src/client/components/bookmark-form/common/bookmark-group-picker.jsx test/unit-ci/bookmark-membership.spec.js test/unit-ci/bookmark-group-entry-contract.spec.js
```

Expected: PASS with no StandardJS findings.

- [ ] **Step 6: Commit the picker**

```powershell
git add apps/electerm-agent/src/client/components/bookmark-form/common/bookmark-group-picker.jsx apps/electerm-agent/src/client/components/bookmark-form/common/bookmark-group-picker.styl apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/bookmark-group-entry-contract.spec.js
git commit -m "feat: add reusable multi-level group picker"
```

### Task 4: Quick Connection Saves to a Selected Group

**Files:**
- Modify: `apps/electerm-agent/src/client/components/tabs/quick-connect-wizard.jsx`
- Modify: `apps/electerm-agent/src/client/components/tabs/quick-connect.styl`
- Modify: `apps/electerm-agent/test/unit-ci/connection-wizard-and-layout.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/bookmark-group-entry-contract.spec.js`

- [ ] **Step 1: Write the failing quick connection contract**

```js
test('quick connection saves through the shared group entry', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/tabs/quick-connect-wizard.jsx'),
    'utf8'
  )
  assert.match(source, /BookmarkGroupPicker/)
  assert.match(source, /selectedGroupId/)
  assert.match(source, /store\.saveBookmarkInGroup/)
  assert.doesNotMatch(source, /store\.addItem\(buildQuickConnectBookmark/)
})
```

- [ ] **Step 2: Run the contracts and verify they fail**

Run:

```powershell
node --test test/unit-ci/connection-wizard-and-layout.spec.js test/unit-ci/bookmark-group-entry-contract.spec.js
```

Expected: FAIL because the wizard still writes directly to `bookmarks`.

- [ ] **Step 3: Add selected group state and atomic save**

Add `selectedGroupId` to initial values:

```js
selectedGroupId: window.store.getLastBookmarkGroup?.() || 'default'
```

Replace the direct write:

```js
if (values.saveAsBookmark) {
  const bookmark = buildQuickConnectBookmark(options)
  window.store.saveBookmarkInGroup(bookmark, values.selectedGroupId)
}
```

Render below the save checkbox:

```jsx
{values.saveAsBookmark
  ? (
    <div className='quick-connect-group-field'>
      <label>{e('shellpilotSelectServerGroup')}</label>
      <BookmarkGroupPicker
        value={values.selectedGroupId}
        onChange={value => updateValue('selectedGroupId', value)}
      />
    </div>
    )
  : null}
```

- [ ] **Step 4: Add responsive spacing**

```stylus
.quick-connect-group-field
  margin-top 12px

.quick-connect-group-field > label
  display block
  margin-bottom 6px

@media (max-width: 720px)
  .quick-connect-group-field
    width 100%
```

- [ ] **Step 5: Run focused tests and lint**

Run:

```powershell
node --test test/unit-ci/connection-wizard-and-layout.spec.js test/unit-ci/bookmark-group-entry-contract.spec.js
npx standard src/client/components/tabs/quick-connect-wizard.jsx
```

Expected: PASS.

- [ ] **Step 6: Commit quick connection grouping**

```powershell
git add apps/electerm-agent/src/client/components/tabs/quick-connect-wizard.jsx apps/electerm-agent/src/client/components/tabs/quick-connect.styl apps/electerm-agent/test/unit-ci/connection-wizard-and-layout.spec.js apps/electerm-agent/test/unit-ci/bookmark-group-entry-contract.spec.js
git commit -m "feat: save quick connections into server groups"
```

### Task 5: Recent Connections Save Form and Visible State

**Files:**
- Modify: `apps/electerm-agent/src/client/components/bookmark-form/bookmark-from-history-modal.jsx`
- Modify: `apps/electerm-agent/src/client/components/sidebar/history-item.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/bookmark-group-entry-contract.spec.js`

- [ ] **Step 1: Write failing history entry contracts**

```js
test('history saving uses an editable form and the shared group entry', () => {
  const modal = fs.readFileSync(
    path.join(root, 'src/client/components/bookmark-form/bookmark-from-history-modal.jsx'),
    'utf8'
  )
  const item = fs.readFileSync(
    path.join(root, 'src/client/components/sidebar/history-item.jsx'),
    'utf8'
  )

  assert.match(modal, /BookmarkGroupPicker/)
  assert.match(modal, /store\.saveBookmarkInGroup/)
  assert.match(modal, /shellpilotAuthenticationNeedsCompletion/)
  assert.doesNotMatch(modal, /bookmark-json-preview/)
  assert.match(item, /Dropdown/)
  assert.match(item, /shellpilotSaveHistoryAsServer/)
  assert.match(item, /shellpilotHistoryAlreadySaved/)
})
```

- [ ] **Step 2: Run the contract and verify it fails**

Run:

```powershell
node --test test/unit-ci/bookmark-group-entry-contract.spec.js
```

Expected: FAIL because history still shows raw JSON and direct `addItem`.

- [ ] **Step 3: Replace raw JSON with editable connection fields**

Track:

```js
state = {
  visible: false,
  tab: null,
  selectedCategory: 'default',
  title: '',
  host: '',
  port: '',
  username: ''
}
```

On `show(tab)`, populate those fields. Render `Input` fields for name, host, port, and username plus:

```jsx
<BookmarkGroupPicker
  value={selectedCategory}
  onChange={value => this.setState({ selectedCategory: value })}
/>
{!tab.password && !tab.privateKey && !tab.profile
  ? <Alert type='warning' showIcon message={e('shellpilotAuthenticationNeedsCompletion')} />
  : null}
```

Save through:

```js
const bookmark = {
  ...this.buildBookmark(),
  title,
  host,
  port,
  username
}
store.saveBookmarkInGroup(bookmark, selectedCategory)
```

- [ ] **Step 4: Add history context menu and saved state**

Determine an existing server using protocol, host, port, and username. Wrap the item with `Dropdown trigger={['contextMenu']}` and provide:

```js
const menuItems = [{
  key: 'save',
  label: e('shellpilotSaveHistoryAsServer'),
  disabled: Boolean(existingBookmark)
}]
```

Show an explicit `shellpilotHistoryAlreadySaved` label when `existingBookmark` exists. Keep click-to-reconnect unchanged.

- [ ] **Step 5: Add translations and run tests**

Add:

```js
shellpilotSaveHistoryAsServer: '保存到服务器',
shellpilotHistoryAlreadySaved: '已保存',
shellpilotAuthenticationNeedsCompletion: '认证信息待补充，保存后请编辑服务器凭据'
```

Run:

```powershell
node --test test/unit-ci/bookmark-group-entry-contract.spec.js
npx standard src/client/components/bookmark-form/bookmark-from-history-modal.jsx src/client/components/sidebar/history-item.jsx
```

Expected: PASS.

- [ ] **Step 6: Commit history grouping**

```powershell
git add apps/electerm-agent/src/client/components/bookmark-form/bookmark-from-history-modal.jsx apps/electerm-agent/src/client/components/sidebar/history-item.jsx apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/bookmark-group-entry-contract.spec.js
git commit -m "feat: save recent connections into server groups"
```

### Task 6: Server Sidebar Management and Batch Move

**Files:**
- Modify: `apps/electerm-agent/src/client/components/sidebar/bookmark-select.jsx`
- Modify: `apps/electerm-agent/src/client/components/tree-list/tree-list.jsx`
- Modify: `apps/electerm-agent/src/client/components/tree-list/tree-list-row.jsx`
- Modify: `apps/electerm-agent/src/client/components/tree-list/tree-item-op.jsx`
- Modify: `apps/electerm-agent/src/client/components/tree-list/bookmark-context-menu.js`
- Modify: `apps/electerm-agent/src/client/components/bookmark-form/tree-select.jsx`
- Modify: `apps/electerm-agent/src/client/components/tree-list/bookmark-toolbar.jsx`
- Modify: `apps/electerm-agent/test/unit-ci/bookmark-group-entry-contract.spec.js`

- [ ] **Step 1: Write failing server management contracts**

```js
test('server sidebar exposes group management without changing connection selection', () => {
  const sidebar = fs.readFileSync(
    path.join(root, 'src/client/components/sidebar/bookmark-select.jsx'),
    'utf8'
  )
  const menu = fs.readFileSync(
    path.join(root, 'src/client/components/tree-list/bookmark-context-menu.js'),
    'utf8'
  )
  const selection = fs.readFileSync(
    path.join(root, 'src/client/components/bookmark-form/tree-select.jsx'),
    'utf8'
  )

  assert.match(sidebar, /managementEnabled:\s*true/)
  assert.match(sidebar, /BookmarkTreeSelect/)
  assert.match(menu, /managementEnabled/)
  assert.match(selection, /store\.moveBookmarksToGroup/)
  assert.match(selection, /BookmarkGroupPicker/)
})
```

- [ ] **Step 2: Run the contract and verify it fails**

Run:

```powershell
node --test test/unit-ci/bookmark-group-entry-contract.spec.js
```

Expected: FAIL because the sidebar is read-only management-wise.

- [ ] **Step 3: Add explicit management behavior**

In `bookmark-select.jsx`, keep `staticList: true` so clicking a server still connects, and add:

```js
managementEnabled: true
```

When `store.bookmarkSelectMode` is true, render:

```jsx
<BookmarkTreeSelect
  {...propsTree}
  type='manage'
/>
```

Pass `managementEnabled` from `tree-list.jsx` through `tree-list-row.jsx` to `TreeItemOp` and `buildBookmarkContextMenuItems`.

Use:

```js
const canManage = managementEnabled || !staticList
```

to expose:

- New top-level group toolbar
- New child group
- Rename
- Move
- Duplicate
- Favorite
- Delete

Do not change `onClickItem`; normal server clicks must still call `store.onSelectBookmark`.

- [ ] **Step 4: Route single drag and menu moves through the Store**

For server rows, replace direct `bookmarkIds` edits with:

```js
window.store.moveBookmarksToGroup([moveItem.id], groupId)
```

Keep existing group-to-group movement rules for group rows.

- [ ] **Step 5: Add batch move mode**

For `type === 'manage'`, render:

```jsx
<BookmarkGroupPicker
  value={targetGroupId}
  onChange={setTargetGroupId}
  allowCreate={false}
/>
<Button
  type='primary'
  disabled={!bookmarkIds.length || !targetGroupId}
  onClick={() => {
    store.moveBookmarksToGroup(bookmarkIds, targetGroupId)
    setCheckedKeys([])
  }}
>
  {e('shellpilotMoveSelectedServers')} ({bookmarkIds.length})
</Button>
```

Keep deletion as a separate danger button. Filter checked group IDs out of `bookmarkIds` before moving.

- [ ] **Step 6: Run focused contracts and lint**

Run:

```powershell
node --test test/unit-ci/bookmark-group-entry-contract.spec.js test/unit-ci/bookmark-management-flow.spec.js test/unit-ci/bookmark-management-matrix.spec.js
npx standard src/client/components/sidebar/bookmark-select.jsx src/client/components/tree-list/tree-list.jsx src/client/components/tree-list/tree-list-row.jsx src/client/components/tree-list/tree-item-op.jsx src/client/components/tree-list/bookmark-context-menu.js src/client/components/bookmark-form/tree-select.jsx src/client/components/tree-list/bookmark-toolbar.jsx
```

Expected: PASS.

- [ ] **Step 7: Commit sidebar management**

```powershell
git add apps/electerm-agent/src/client/components/sidebar/bookmark-select.jsx apps/electerm-agent/src/client/components/tree-list/tree-list.jsx apps/electerm-agent/src/client/components/tree-list/tree-list-row.jsx apps/electerm-agent/src/client/components/tree-list/tree-item-op.jsx apps/electerm-agent/src/client/components/tree-list/bookmark-context-menu.js apps/electerm-agent/src/client/components/bookmark-form/tree-select.jsx apps/electerm-agent/src/client/components/tree-list/bookmark-toolbar.jsx apps/electerm-agent/test/unit-ci/bookmark-group-entry-contract.spec.js
git commit -m "feat: manage server groups from the sidebar"
```

### Task 7: Safe Group Deletion and User-Facing Errors

**Files:**
- Modify: `apps/electerm-agent/src/client/common/bookmark-deletion.js`
- Modify: `apps/electerm-agent/src/client/components/tree-list/tree-list-row.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/bookmark-deletion.spec.js`

- [ ] **Step 1: Write a failing impact-summary test**

```js
test('describeBookmarkGroupDeletion reports migrated servers and child groups', async () => {
  const { describeBookmarkGroupDeletion } = await loadDeletionHelper()
  const groups = [
    { id: 'default', bookmarkIds: [], bookmarkGroupIds: ['prod'] },
    { id: 'prod', bookmarkIds: ['server-1', 'server-2'], bookmarkGroupIds: ['web'] },
    { id: 'web', bookmarkIds: ['server-3'], bookmarkGroupIds: [] }
  ]

  assert.deepEqual(describeBookmarkGroupDeletion(groups, 'prod', 'default'), {
    canDelete: true,
    targetGroupId: 'default',
    bookmarkCount: 2,
    childGroupCount: 1
  })
})
```

- [ ] **Step 2: Run the deletion test and verify it fails**

Run:

```powershell
node --test test/unit-ci/bookmark-deletion.spec.js
```

Expected: FAIL because `describeBookmarkGroupDeletion` is undefined.

- [ ] **Step 3: Implement the impact description**

```js
export function describeBookmarkGroupDeletion (
  bookmarkGroups = [],
  groupId,
  defaultGroupId
) {
  if (!groupId || groupId === defaultGroupId) {
    return {
      canDelete: false,
      targetGroupId: null,
      bookmarkCount: 0,
      childGroupCount: 0
    }
  }
  const group = bookmarkGroups.find(item => item.id === groupId)
  if (!group) {
    return {
      canDelete: false,
      targetGroupId: null,
      bookmarkCount: 0,
      childGroupCount: 0
    }
  }
  const parent = bookmarkGroups.find(item =>
    (item.bookmarkGroupIds || []).includes(groupId)
  ) || bookmarkGroups.find(item => item.id === defaultGroupId)
  return {
    canDelete: Boolean(parent),
    targetGroupId: parent?.id || null,
    bookmarkCount: new Set(group.bookmarkIds || []).size,
    childGroupCount: new Set(group.bookmarkGroupIds || []).size
  }
}
```

- [ ] **Step 4: Show the exact migration consequence**

Before deleting a group, build the confirmation text from the impact:

```js
const impact = describeBookmarkGroupDeletion(
  window.store.bookmarkGroups,
  item.id,
  defaultBookmarkGroupId
)
const target = window.store.bookmarkGroups.find(group =>
  group.id === impact.targetGroupId
)
return window.confirm(e('shellpilotBookmarkDeleteGroupImpact')
  .replace('{servers}', String(impact.bookmarkCount))
  .replace('{groups}', String(impact.childGroupCount))
  .replace('{target}', target?.title || e('shellpilotUngrouped')))
```

Chinese copy:

```js
shellpilotBookmarkDeleteGroupImpact: '删除后，{servers} 台服务器和 {groups} 个子分组将移动到“{target}”。不会删除服务器，是否继续？'
```

- [ ] **Step 5: Run deletion and membership tests**

Run:

```powershell
node --test test/unit-ci/bookmark-deletion.spec.js test/unit-ci/bookmark-membership.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit deletion protection**

```powershell
git add apps/electerm-agent/src/client/common/bookmark-deletion.js apps/electerm-agent/src/client/components/tree-list/tree-list-row.jsx apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/bookmark-deletion.spec.js
git commit -m "fix: protect servers when deleting groups"
```

### Task 8: End-to-End and Visual Regression Gates

**Files:**
- Modify: `apps/electerm-agent/test/e2e/021.basic.bookmarks-groups.spec.js`
- Modify: `apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js`

- [ ] **Step 1: Add the quick connection and history group E2E flow**

Add one scenario that:

1. Creates `生产环境` and child `Web服务器`.
2. Opens the quick connection wizard.
3. Enters a deterministic test host.
4. Selects `生产环境 / Web服务器`.
5. Saves without requiring a live connection by invoking the save handler through the rendered wizard state or a test-only Store fixture.
6. Asserts exactly one group contains the bookmark ID.
7. Adds a history fixture and saves it to `生产环境`.
8. Asserts the history item shows “已保存”.
9. Restarts the app and verifies both assignments persist.

Core assertion:

```js
const memberships = await client.evaluate(bookmarkId => {
  return window.store.bookmarkGroups
    .filter(group => (group.bookmarkIds || []).includes(bookmarkId))
    .map(group => group.id)
}, bookmarkId)
expect(memberships).toEqual([expectedGroupId])
```

- [ ] **Step 2: Add drag, right-click, batch move, and safe delete E2E coverage**

Add a scenario that:

1. Drags one server into a nested group.
2. Moves it back through the right-click menu.
3. Selects two servers in manage mode and batch moves them.
4. Deletes the non-empty group.
5. Accepts the impact confirmation.
6. Verifies both servers still exist and moved to the parent/default group.

- [ ] **Step 3: Add day/night and viewport assertions**

For `1366×768` and `1920×1080`, assert:

```js
await expect(client.locator('.bookmark-group-picker')).toBeVisible()
await expect(client.locator('.tree-list-header')).toBeVisible()
await expect(client.locator('.tree-select-wrapper')).toHaveCSS('overflow-x', /auto|visible/)
```

Capture screenshots only after the picker and tree are stable in both themes.

- [ ] **Step 4: Run the complete focused regression**

Run:

```powershell
node --test test/unit-ci/bookmark-membership.spec.js test/unit-ci/bookmark-group-entry-contract.spec.js test/unit-ci/bookmark-group-actions.spec.js test/unit-ci/bookmark-group.spec.js test/unit-ci/bookmark-deletion.spec.js test/unit-ci/bookmark-management-flow.spec.js test/unit-ci/bookmark-management-matrix.spec.js test/unit-ci/connection-wizard-and-layout.spec.js
npx playwright test test/e2e/021.basic.bookmarks-groups.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1
```

Expected: all focused unit and E2E tests PASS.

- [ ] **Step 5: Run full quality and build gates**

Run:

```powershell
npm run test-unit-ci
npm run lint
npm run compile
git diff --check
```

Expected:

- Unit suite passes.
- StandardJS reports zero errors.
- Production compile completes.
- `git diff --check` prints no whitespace errors.

- [ ] **Step 6: Perform manual desktop regression**

Verify:

- SSH connect, reconnect, multiple tabs, Ctrl+C.
- SFTP browse and file transfer.
- AI assistant opens and sends a normal chat request.
- Server sidebar group creation, nesting, drag, right-click, batch move, and deletion.
- Quick connection and recent connection grouping.
- Day/night at 100%, 125%, and 150% Windows scaling.
- No release is published during this task; release remains a separate explicit step after user acceptance.

- [ ] **Step 7: Commit the regression gates**

```powershell
git add apps/electerm-agent/test/e2e/021.basic.bookmarks-groups.spec.js apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js
git commit -m "test: gate multi-level server group workflows"
```

## Final Acceptance Checklist

- [ ] Multi-level groups can be created from the server sidebar and inline pickers.
- [ ] Quick connection saves to the selected group and remembers the last valid group.
- [ ] Recent connections save through an editable form and show saved state.
- [ ] Single drag, right-click move, and batch move all use the shared membership Store entry.
- [ ] Every server belongs to exactly one real group.
- [ ] Invalid and legacy memberships are repaired without deleting servers.
- [ ] Deleting a non-empty group displays impact and migrates content safely.
- [ ] Backup/import behavior remains compatible because the existing data model is unchanged.
- [ ] Focused E2E, full unit, lint, compile, and manual desktop regression pass.
