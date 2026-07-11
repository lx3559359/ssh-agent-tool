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

async function bookmarkIdByTitle (client, title) {
  return client.evaluate((expectedTitle) => {
    return window.store.bookmarks.find(item => item.title === expectedTitle)?.id || ''
  }, title)
}

async function openContextMenu (client, bookmarkId) {
  const item = client.locator(`.sidebar-panel-bookmarks .tree-item[data-item-id="${bookmarkId}"]`)
  await expect(item).toBeVisible()
  await item.click({ button: 'right' })
  const menu = client.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu:visible').last()
  await expect(menu).toBeVisible()
  await expect(menu.locator('[role="menuitem"]')).not.toHaveCount(0)
  return menu
}

describe('bookmarks', function () {
  it('creates, edits, searches and permanently deletes a local connection', async function () {
    const suffix = `${Date.now()}-${process.pid}`
    const originalTitle = `E2E-Local-${suffix}`
    const editedTitle = `E2E-Edited-${suffix}`
    const artifacts = {
      bookmarkIds: [],
      bookmarkTitles: [originalTitle, editedTitle]
    }
    let electronApp
    let client

    try {
      const launched = await launchBookmarkApp()
      electronApp = launched.electronApp
      client = launched.client

      await client.locator('.aigshell-topbar-action .anticon-plus-circle').click()
      const localType = client.locator('.setting-wrap label').filter({
        has: client.locator('input[type="radio"][value="local"]')
      })
      await localType.waitFor({ state: 'visible', timeout: 10000 })
      await localType.click()
      const titleInput = client.locator('.setting-wrap #local-form_title')
      await titleInput.fill(originalTitle)
      await client.getByTestId('bookmark-save').click()
      await expect.poll(() => bookmarkIdByTitle(client, originalTitle)).not.toBe('')
      const bookmarkId = await bookmarkIdByTitle(client, originalTitle)
      artifacts.bookmarkIds.push(bookmarkId)

      await client.locator('.setting-wrap .close-setting-wrap-icon').click()
      await expect(client.locator('.setting-wrap')).toBeHidden()
      await openBookmarksSidebar(client)
      let menu = await openContextMenu(client, bookmarkId)
      await menu.locator('[role="menuitem"]').nth(2).click()

      await expect(titleInput).toHaveValue(originalTitle)
      await titleInput.fill(editedTitle)
      await client.getByTestId('bookmark-save').click()
      await expect.poll(() => bookmarkIdByTitle(client, editedTitle)).toBe(bookmarkId)

      await client.locator('.setting-wrap .close-setting-wrap-icon').click()
      await expect(client.locator('.setting-wrap')).toBeHidden()
      await openBookmarksSidebar(client)
      await client.locator('.sidebar-panel-bookmarks .tree-sort-wrap input').fill(editedTitle)
      const result = client.locator(`.sidebar-panel-bookmarks .tree-item[data-item-id="${bookmarkId}"]`)
      await expect(result).toBeVisible()
      await expect(result).toContainText(editedTitle)

      menu = await openContextMenu(client, bookmarkId)
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
      await expect.poll(() => bookmarkIdByTitle(client, editedTitle)).toBe('')
      await expect(result).toHaveCount(0)

      await client.waitForTimeout(750)
      await closeBookmarkApp(electronApp, __filename)
      electronApp = null
      client = null

      const restarted = await launchBookmarkApp()
      electronApp = restarted.electronApp
      client = restarted.client
      expect(await bookmarkIdByTitle(client, editedTitle)).toBe('')
      expect(await client.evaluate(id => window.store.bookmarks.some(item => item.id === id), bookmarkId)).toBe(false)
      await openBookmarksSidebar(client)
      await client.locator('.sidebar-panel-bookmarks .tree-sort-wrap input').fill(editedTitle)
      await expect(client.locator(`.sidebar-panel-bookmarks .tree-item[data-item-id="${bookmarkId}"]`)).toHaveCount(0)
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
