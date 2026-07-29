const { test: it, expect } = require('@playwright/test')
const { describe } = it
const {
  launchBookmarkApp,
  openBookmarksSidebar,
  cleanupBookmarkArtifacts,
  closeBookmarkApp,
  cleanupBookmarkProfile
} = require('./common/bookmark-lifecycle')

it.setTimeout(120000)

async function groupIdByTitle (client, title) {
  return client.evaluate((expectedTitle) => {
    return window.store.bookmarkGroups.find(item => item.title === expectedTitle)?.id || ''
  }, title)
}

async function openContextMenu (client, groupId) {
  const item = client.locator(`.sidebar-panel-bookmarks .tree-item.is-category[data-item-id="${groupId}"]`)
  await expect(item).toBeVisible()
  await item.click({ button: 'right' })
  const menu = client.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu:visible').last()
  await expect(menu).toBeVisible()
  await expect(menu.locator('[role="menuitem"]')).not.toHaveCount(0)
  return menu
}

async function openBookmarkContextMenu (client, bookmarkId) {
  const item = client.locator(`.sidebar-panel-bookmarks .tree-item:not(.is-category)[data-item-id="${bookmarkId}"]`)
  await expect(item).toBeVisible()
  await item.click({ button: 'right' })
  const menu = client.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu:visible').last()
  await expect(menu).toBeVisible()
  return menu
}

async function bookmarkMemberships (client, bookmarkId) {
  return client.evaluate(id => (
    window.store.bookmarkGroups
      .filter(group => (group.bookmarkIds || []).includes(id))
      .map(group => group.id)
  ), bookmarkId)
}

describe('bookmark groups', function () {
  it('creates, edits, searches and permanently deletes a group', async function () {
    const suffix = `${Date.now()}-${process.pid}`
    const originalTitle = `E2E-G-${suffix}`
    const editedTitle = `E2E-G2-${suffix}`
    const artifacts = {
      groupIds: [],
      groupTitles: [originalTitle, editedTitle]
    }
    let electronApp
    let client

    try {
      const launched = await launchBookmarkApp()
      electronApp = launched.electronApp
      client = launched.client
      await openBookmarksSidebar(client)

      await client.locator('.sidebar-panel-bookmarks .anticon-folder.with-plus').click()
      const editorInput = client.locator('.sidebar-panel-bookmarks .tree-list-editor-overlay input.ant-input')
      await editorInput.fill(originalTitle)
      await client.locator('.sidebar-panel-bookmarks .tree-list-editor-overlay .anticon-check').click()
      await expect.poll(() => groupIdByTitle(client, originalTitle)).not.toBe('')
      const groupId = await groupIdByTitle(client, originalTitle)
      artifacts.groupIds.push(groupId)

      let menu = await openContextMenu(client, groupId)
      await menu.locator('[role="menuitem"]').nth(1).click()
      await expect(editorInput).toHaveValue(originalTitle)
      await editorInput.fill(editedTitle)
      await client.locator('.sidebar-panel-bookmarks .tree-list-editor-overlay .anticon-check').click()
      await expect.poll(() => groupIdByTitle(client, editedTitle)).toBe(groupId)

      await client.locator('.sidebar-panel-bookmarks .tree-sort-wrap input').fill(editedTitle)
      const result = client.locator(`.sidebar-panel-bookmarks .tree-item.is-category[data-item-id="${groupId}"]`)
      await expect(result).toBeVisible()
      await expect(result).toContainText(editedTitle)

      menu = await openContextMenu(client, groupId)
      const deleteItem = menu.locator('.ant-dropdown-menu-item-danger')
      await expect(deleteItem).toBeVisible()
      let deleteConfirmed = false
      await Promise.all([
        client.waitForEvent('dialog').then(async dialog => {
          expect(dialog.type()).toBe('confirm')
          expect(dialog.message()).not.toBe('')
          deleteConfirmed = true
          await dialog.accept()
        }),
        deleteItem.click()
      ])
      expect(deleteConfirmed).toBe(true)
      await expect.poll(() => groupIdByTitle(client, editedTitle)).toBe('')
      await expect(result).toHaveCount(0)

      await client.waitForTimeout(750)
      await closeBookmarkApp(electronApp, __filename)
      electronApp = null
      client = null

      const restarted = await launchBookmarkApp()
      electronApp = restarted.electronApp
      client = restarted.client
      expect(await groupIdByTitle(client, editedTitle)).toBe('')
      expect(await client.evaluate(id => window.store.bookmarkGroups.some(item => item.id === id), groupId)).toBe(false)

      await openBookmarksSidebar(client)
      await client.locator('.sidebar-panel-bookmarks .tree-sort-wrap input').fill(editedTitle)
      await expect(client.locator(`.sidebar-panel-bookmarks .tree-item.is-category[data-item-id="${groupId}"]`)).toHaveCount(0)
    } finally {
      if (!client || client.isClosed()) {
        await closeBookmarkApp(electronApp, __filename).catch(() => {})
        const relaunched = await launchBookmarkApp().catch(() => null)
        electronApp = relaunched?.electronApp
        client = relaunched?.client
      }
      if (client && !client.isClosed()) {
        await cleanupBookmarkArtifacts(client, artifacts).catch(() => {})
      }
      await closeBookmarkApp(electronApp, __filename).catch(() => {})
      await cleanupBookmarkProfile().catch(() => {})
    }
  })

  it('persists grouped quick and history connections and safely migrates deleted groups', async function () {
    const suffix = `${Date.now()}-${process.pid}`
    const parentTitle = `生产环境-${suffix}`
    const childTitle = `Web服务器-${suffix}`
    const deleteTitle = `待删除-${suffix}`
    const quickHost = `quick-${suffix}.example.test`
    const historyHost = `history-${suffix}.example.test`
    const artifacts = {
      bookmarkIds: [],
      bookmarkTitles: [],
      groupIds: [],
      groupTitles: [parentTitle, childTitle, deleteTitle]
    }
    let electronApp
    let client

    try {
      const launched = await launchBookmarkApp()
      electronApp = launched.electronApp
      client = launched.client

      const groups = await client.evaluate(({ parentTitle, childTitle, deleteTitle }) => {
        const parent = window.store.createBookmarkGroup({
          title: parentTitle,
          parentId: 'default'
        })
        const child = window.store.createBookmarkGroup({
          title: childTitle,
          parentId: parent.id
        })
        const disposable = window.store.createBookmarkGroup({
          title: deleteTitle,
          parentId: 'default'
        })
        return {
          parentId: parent.id,
          childId: child.id,
          disposableId: disposable.id
        }
      }, { parentTitle, childTitle, deleteTitle })
      artifacts.groupIds.push(groups.parentId, groups.childId, groups.disposableId)

      await client.evaluate(() => {
        window.__bookmarkE2EAddTab = window.store.addTab
        window.store.addTab = () => {}
        window.dispatchEvent(new CustomEvent('shellpilot-open-connect-wizard'))
      })
      const wizard = client.locator('.quick-connect-wizard')
      await expect(wizard).toBeVisible()
      await wizard.locator('.quick-connect-wizard-body input.ant-input:not(.quick-connect-port)').fill(quickHost)
      await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
      await wizard.locator('.quick-connect-wizard-body input.ant-input').first().fill('root')
      await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
      await wizard.locator('.quick-connect-wizard-advanced .ant-collapse-header').click()
      await wizard.locator('.bookmark-group-picker .ant-select').click()
      await client.locator('.ant-select-dropdown:visible .ant-select-tree-treenode').filter({ hasText: childTitle }).click()
      await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
      await expect(wizard).toBeHidden()
      await client.evaluate(() => {
        window.store.addTab = window.__bookmarkE2EAddTab
        delete window.__bookmarkE2EAddTab
      })

      const quickBookmark = await client.evaluate(host => (
        window.store.bookmarks.find(bookmark => bookmark.host === host)
      ), quickHost)
      expect(quickBookmark?.id).toBeTruthy()
      artifacts.bookmarkIds.push(quickBookmark.id)
      artifacts.bookmarkTitles.push(quickBookmark.title)
      expect(await bookmarkMemberships(client, quickBookmark.id)).toEqual([groups.childId])

      await client.evaluate(({ historyHost }) => {
        window.store.history.unshift({
          id: `history-${Date.now()}`,
          time: Date.now(),
          count: 1,
          tab: {
            type: 'ssh',
            title: historyHost,
            host: historyHost,
            port: '22',
            username: 'root'
          }
        })
        window.store.handleSidebarPanelTab('history')
        window.store.setOpenedSideBar('bookmarks')
      }, { historyHost })
      const historyItem = client.locator('.sidebar-panel-history .item-list-unit').first()
      await expect(historyItem).toBeVisible()
      await historyItem.click({ button: 'right' })
      await client.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menuitem"]').last().click()
      const historyModal = client.locator('.bookmark-from-history-modal')
      await expect(historyModal).toBeVisible()
      await historyModal.locator('.bookmark-group-picker .ant-select').click()
      await client.locator('.ant-select-dropdown:visible .ant-select-tree-treenode').filter({ hasText: parentTitle }).click()
      await client.locator('.custom-modal-wrap:has(.bookmark-from-history-modal) .custom-modal-footer button.ant-btn-primary').click()
      await expect(historyModal).toBeHidden()
      await expect(historyItem.locator('.history-item-saved')).toBeVisible()

      const historyBookmark = await client.evaluate(host => (
        window.store.bookmarks.find(bookmark => bookmark.host === host)
      ), historyHost)
      expect(historyBookmark?.id).toBeTruthy()
      artifacts.bookmarkIds.push(historyBookmark.id)
      artifacts.bookmarkTitles.push(historyBookmark.title)
      expect(await bookmarkMemberships(client, historyBookmark.id)).toEqual([groups.parentId])

      await openBookmarksSidebar(client)
      await client.evaluate(({ parentId, childId }) => {
        const expandedKeys = [
          ...new Set([
            ...(window.store.expandedKeys || []),
            'default',
            parentId,
            childId
          ])
        ]
        window.store.storeAssign({ expandedKeys })
      }, groups)

      const moveLabel = await client.evaluate(() => window.translate('shellpilotBookmarkMoveToGroup'))
      const quickMenu = await openBookmarkContextMenu(client, quickBookmark.id)
      await quickMenu.locator('[role="menuitem"]').filter({ hasText: moveLabel }).click()
      const moveModal = client.locator('.custom-modal-wrap:has(.move-item-tree)')
      await expect(moveModal).toBeVisible()
      await moveModal.locator('.ant-tree-treenode').filter({ hasText: parentTitle }).click()
      await moveModal.locator('.custom-modal-footer button.ant-btn-primary').click()
      await expect(moveModal).toBeHidden()
      await expect.poll(() => bookmarkMemberships(client, quickBookmark.id)).toEqual([groups.parentId])

      const quickItem = client.locator(`.sidebar-panel-bookmarks .tree-item:not(.is-category)[data-item-id="${quickBookmark.id}"]`)
      const childGroupItem = client.locator(`.sidebar-panel-bookmarks .tree-item.is-category[data-item-id="${groups.childId}"]`)
      await quickItem.dragTo(childGroupItem)
      await expect.poll(() => bookmarkMemberships(client, quickBookmark.id)).toEqual([groups.childId])

      await client.evaluate(() => {
        window.store.bookmarkSelectMode = true
      })
      const managePanel = client.locator('.sidebar-panel-bookmarks .tree-select-wrapper')
      await expect(managePanel).toBeVisible()
      const historyNode = managePanel.locator('.ant-tree-treenode').filter({ hasText: historyHost })
      await expect(historyNode).toBeVisible()
      await historyNode.locator('.ant-tree-checkbox').click()
      await managePanel.locator('.bookmark-group-picker .ant-select').click()
      await client.locator('.ant-select-dropdown:visible .ant-select-tree-treenode').filter({ hasText: childTitle }).click()
      const moveSelected = managePanel.locator('.bookmark-tree-manage-actions button.ant-btn-primary')
      await expect(moveSelected).toBeEnabled()
      await moveSelected.click()
      await expect.poll(() => bookmarkMemberships(client, historyBookmark.id)).toEqual([groups.childId])
      await client.evaluate(() => {
        window.store.bookmarkSelectMode = false
      })
      await expect(managePanel).toBeHidden()

      const disposableBookmarkIds = await client.evaluate((groupId) => {
        const first = {
          id: `delete-a-${Date.now()}`,
          type: 'ssh',
          title: 'delete-a',
          host: 'delete-a.example.test',
          port: '22'
        }
        const second = {
          id: `delete-b-${Date.now()}`,
          type: 'ssh',
          title: 'delete-b',
          host: 'delete-b.example.test',
          port: '22'
        }
        window.store.saveBookmarkInGroup(first, groupId)
        window.store.saveBookmarkInGroup(second, groupId)
        return [first.id, second.id]
      }, groups.disposableId)
      artifacts.bookmarkIds.push(...disposableBookmarkIds)

      await openBookmarksSidebar(client)
      const deleteMenu = await openContextMenu(client, groups.disposableId)
      const deleteItem = deleteMenu.locator('.ant-dropdown-menu-item-danger')
      await Promise.all([
        client.waitForEvent('dialog').then(async dialog => {
          expect(dialog.message()).toContain('2')
          expect(dialog.message()).toContain('服务器')
          await dialog.accept()
        }),
        deleteItem.click()
      ])
      await expect.poll(() => groupIdByTitle(client, deleteTitle)).toBe('')
      for (const id of disposableBookmarkIds) {
        expect(await client.evaluate(bookmarkId => (
          window.store.bookmarks.some(bookmark => bookmark.id === bookmarkId)
        ), id)).toBe(true)
        expect(await bookmarkMemberships(client, id)).toEqual(['default'])
      }

      await client.waitForTimeout(750)
      await closeBookmarkApp(electronApp, __filename)
      electronApp = null
      client = null

      const restarted = await launchBookmarkApp()
      electronApp = restarted.electronApp
      client = restarted.client
      expect(await bookmarkMemberships(client, quickBookmark.id)).toEqual([groups.childId])
      expect(await bookmarkMemberships(client, historyBookmark.id)).toEqual([groups.childId])
      expect(await client.evaluate(id => (
        window.store.bookmarkGroups.some(group => group.id === id)
      ), groups.disposableId)).toBe(false)
    } finally {
      if (client && !client.isClosed()) {
        await client.evaluate(() => {
          if (window.__bookmarkE2EAddTab) {
            window.store.addTab = window.__bookmarkE2EAddTab
            delete window.__bookmarkE2EAddTab
          }
        }).catch(() => {})
        await cleanupBookmarkArtifacts(client, artifacts).catch(() => {})
      }
      await closeBookmarkApp(electronApp, __filename).catch(() => {})
      await cleanupBookmarkProfile().catch(() => {})
    }
  })
})
