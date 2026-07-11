const { test: it, expect } = require('@playwright/test')
const { describe } = it
const {
  launchBookmarkApp,
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
  const item = client.locator(`.setting-wrap .tree-item.is-category[data-item-id="${groupId}"]`)
  await expect(item).toBeVisible()
  await item.click({ button: 'right' })
  const menu = client.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu:visible').last()
  await expect(menu).toBeVisible()
  await expect(menu.locator('[role="menuitem"]')).not.toHaveCount(0)
  return menu
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
      await client.locator('.aigshell-topbar-action .anticon-plus-circle').click()
      await client.locator('.setting-wrap .tree-list.item-type-bookmarks').waitFor({
        state: 'visible',
        timeout: 10000
      })

      await client.locator('.setting-wrap .anticon-folder.with-plus').click()
      const editorInput = client.locator('.setting-wrap .tree-list-editor-overlay input.ant-input')
      await editorInput.fill(originalTitle)
      await client.locator('.setting-wrap .tree-list-editor-overlay .anticon-check').click()
      await expect.poll(() => groupIdByTitle(client, originalTitle)).not.toBe('')
      const groupId = await groupIdByTitle(client, originalTitle)
      artifacts.groupIds.push(groupId)

      let menu = await openContextMenu(client, groupId)
      await menu.locator('[role="menuitem"]').nth(1).click()
      await expect(editorInput).toHaveValue(originalTitle)
      await editorInput.fill(editedTitle)
      await client.locator('.setting-wrap .tree-list-editor-overlay .anticon-check').click()
      await expect.poll(() => groupIdByTitle(client, editedTitle)).toBe(groupId)

      await client.locator('.setting-wrap .tree-sort-wrap input').fill(editedTitle)
      const result = client.locator(`.setting-wrap .tree-item.is-category[data-item-id="${groupId}"]`)
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

      await client.locator('.aigshell-topbar-action .anticon-plus-circle').click()
      await client.locator('.setting-wrap .tree-list.item-type-bookmarks').waitFor({
        state: 'visible',
        timeout: 10000
      })
      await client.locator('.setting-wrap .tree-sort-wrap input').fill(editedTitle)
      await expect(client.locator(`.setting-wrap .tree-item.is-category[data-item-id="${groupId}"]`)).toHaveCount(0)
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
})
